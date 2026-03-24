"""Звонки: аудио и видеозвонки через WebRTC (offer/answer/ice), история"""
import json
import os
import psycopg2
import traceback

try:
    from pywebpush import webpush, WebPushException
    WEBPUSH_AVAILABLE = True
    print("[push] pywebpush loaded OK")
except ImportError as e:
    WEBPUSH_AVAILABLE = False
    print(f"[push] pywebpush NOT available: {e}")

SCHEMA = "t_p22534578_messenger_mobile_app"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def auth_user(conn, token: str):
    if not token or len(token) > 128:
        return None
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT u.id, u.name, u.avatar_url
            FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "avatar_url": row[2]}
    return None

def safe_int(val, default=0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default

def _send_missed_call_message(conn, caller_id: int, callee_id: int, is_video: bool):
    """Создаёт системное сообщение о пропущенном звонке в личном чате двух пользователей"""
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT cm1.chat_id FROM {SCHEMA}.chat_members cm1
            JOIN {SCHEMA}.chat_members cm2 ON cm1.chat_id = cm2.chat_id
            JOIN {SCHEMA}.chats c ON c.id = cm1.chat_id
            WHERE cm1.user_id = %s AND cm2.user_id = %s AND c.is_group = FALSE
            LIMIT 1
        """, (caller_id, callee_id))
        row = cur.fetchone()
        if not row:
            return
        chat_id = row[0]
        call_type = "видео" if is_video else "аудио"
        text = f"Пропущенный {call_type}звонок"
        cur.execute(f"""
            INSERT INTO {SCHEMA}.messages (chat_id, sender_id, text, message_type)
            VALUES (%s, %s, %s, 'missed_call')
        """, (chat_id, caller_id, text))


def handler(event: dict, context) -> dict:
    """Сервис звонков: аудио и видео через WebRTC"""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    token = event.get("headers", {}).get("x-auth-token") or event.get("headers", {}).get("X-Auth-Token", "")
    path = event.get("path", "/").rstrip("/") or "/"
    method = event.get("httpMethod", "GET")

    body_raw = event.get("body") or "{}"
    try:
        body_pre = json.loads(body_raw)
    except:
        body_pre = {}
    action = body_pre.get("action", "") or path.strip("/").split("/")[-1]

    conn = get_conn()
    user = auth_user(conn, token)
    if not user:
        conn.close()
        return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Unauthorized"})}

    uid = user["id"]

    try:
        # POST /initiate — начать звонок (аудио или видео)
        if action == "initiate":
            body = body_pre
            callee_id = safe_int(body.get("callee_id"))
            is_video = bool(body.get("is_video", False))
            if not callee_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "callee_id required"})}
            if callee_id == uid:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нельзя позвонить самому себе"})}
            # Проверяем существование callee
            with conn.cursor() as cur:
                cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE id = %s", (callee_id,))
                if not cur.fetchone():
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Пользователь не найден"})}
            # Rate limit: не более 10 звонков в час
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM {SCHEMA}.calls
                    WHERE caller_id = %s AND created_at > NOW() - INTERVAL '1 hour'
                """, (uid,))
                if cur.fetchone()[0] >= 10:
                    return {"statusCode": 429, "headers": cors, "body": json.dumps({"error": "Слишком много звонков. Попробуйте позже"})}

            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='ended', ended_at=NOW()
                    WHERE (caller_id=%s OR callee_id=%s) AND status IN ('ringing','active')
                """, (uid, uid))
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.calls (caller_id, callee_id, status, is_video)
                    VALUES (%s, %s, 'ringing', %s) RETURNING id
                """, (uid, callee_id, is_video))
                call_id = cur.fetchone()[0]
            conn.commit()

            # Push-уведомление о входящем звонке
            print(f"[push] WEBPUSH_AVAILABLE={WEBPUSH_AVAILABLE}")
            if WEBPUSH_AVAILABLE:
                vapid_private = os.environ.get("VAPID_PRIVATE_KEY", "")
                vapid_public = os.environ.get("VAPID_PUBLIC_KEY", "")
                print(f"[push] vapid_private len={len(vapid_private)} vapid_public len={len(vapid_public)}")
                if vapid_private and vapid_public:
                    with conn.cursor() as cur:
                        cur.execute(f"""
                            SELECT endpoint, p256dh, auth
                            FROM {SCHEMA}.push_subscriptions
                            WHERE user_id = %s
                        """, (callee_id,))
                        subs = cur.fetchall()
                    print(f"[push] found {len(subs)} subscriptions for user {callee_id}")
                    call_type = "📹 Видеозвонок" if is_video else "📞 Аудиозвонок"
                    push_data = json.dumps({
                        "title": user["name"],
                        "body": call_type,
                        "tag": f"call-{call_id}",
                        "type": "call",
                        "call_id": call_id,
                        "url": "/",
                    })
                    dead_endpoints = []
                    for endpoint, p256dh, auth_k in subs:
                        try:
                            webpush(
                                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth_k}},
                                data=push_data,
                                vapid_private_key=vapid_private,
                                vapid_claims={"sub": "mailto:push@poehali.dev"},
                            )
                            print(f"[push] sent OK to {endpoint[:50]}")
                        except WebPushException as ex:
                            resp = ex.response
                            status = resp.status_code if resp else 0
                            body_text = resp.text if resp else ""
                            print(f"[push] WebPushException status={status} body={body_text[:200]}: {ex}")
                            if status in (404, 410):
                                dead_endpoints.append(endpoint)
                        except Exception as ex:
                            print(f"[push] error: {traceback.format_exc()}")
                    # Удаляем протухшие подписки
                    for ep in dead_endpoints:
                        with conn.cursor() as cur:
                            cur.execute(f"DELETE FROM {SCHEMA}.push_subscriptions WHERE endpoint = %s", (ep,))
                        conn.commit()
                        print(f"[push] removed dead subscription: {ep[:50]}")
                else:
                    print("[push] VAPID keys missing — push not sent")

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call_id": call_id})}

        # POST /answer — ответить на звонок
        if action == "answer":
            body = body_pre
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='active', answered_at=NOW()
                    WHERE id=%s AND callee_id=%s AND status='ringing'
                """, (call_id, uid))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /decline — отклонить звонок
        if action == "decline":
            body = body_pre
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='declined', ended_at=NOW()
                    WHERE id=%s AND callee_id=%s AND status='ringing'
                    RETURNING caller_id, callee_id, is_video
                """, (call_id, uid))
                row = cur.fetchone()
            if row:
                _send_missed_call_message(conn, row[0], row[1], bool(row[2]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /end — завершить звонок
        if action == "end":
            body = body_pre
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='ended', ended_at=NOW()
                    WHERE id=%s AND (caller_id=%s OR callee_id=%s) AND status IN ('ringing','active')
                    RETURNING caller_id, callee_id, is_video, answered_at
                """, (call_id, uid, uid))
                row = cur.fetchone()
            if row and row[3] is None:
                _send_missed_call_message(conn, row[0], row[1], bool(row[2]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /signal — отправить WebRTC сигнал (offer/answer/ice-candidate)
        if action == "signal":
            body = body_pre
            call_id = safe_int(body.get("call_id"))
            signal_type = body.get("type", "")
            payload = body.get("payload")
            if not call_id or not signal_type or payload is None:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "call_id, type, payload required"})}
            if signal_type not in ("offer", "answer", "ice-candidate"):
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Недопустимый тип сигнала"})}
            # Проверяем что user — участник этого звонка
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT id FROM {SCHEMA}.calls
                    WHERE id = %s AND (caller_id = %s OR callee_id = %s) AND status IN ('ringing','active')
                """, (call_id, uid, uid))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа к этому звонку"})}

            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.call_signals (call_id, from_user_id, signal_type, payload)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (call_id, uid, signal_type, payload if isinstance(payload, str) else json.dumps(payload)))
                sig_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"signal_id": sig_id})}

        # poll — получить новые сигналы и статус
        if action == "poll":
            params = event.get("queryStringParameters") or {}
            call_id = safe_int(body_pre.get("call_id") or params.get("call_id"))
            last_signal_id = safe_int(body_pre.get("last_signal_id") or params.get("last_signal_id"))
            if not call_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "call_id required"})}

            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.status, c.caller_id, c.callee_id, c.is_video,
                           uc.name as caller_name, uu.name as callee_name
                    FROM {SCHEMA}.calls c
                    JOIN {SCHEMA}.users uc ON uc.id = c.caller_id
                    JOIN {SCHEMA}.users uu ON uu.id = c.callee_id
                    WHERE c.id=%s AND (c.caller_id=%s OR c.callee_id=%s)
                """, (call_id, uid, uid))
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Call not found"})}
                call_info = {
                    "id": row[0], "status": row[1],
                    "caller_id": row[2], "callee_id": row[3],
                    "is_video": bool(row[4]),
                    "caller_name": row[5], "callee_name": row[6]
                }

                cur.execute(f"""
                    SELECT id, from_user_id, signal_type, payload
                    FROM {SCHEMA}.call_signals
                    WHERE call_id=%s AND from_user_id != %s AND id > %s
                    ORDER BY id ASC LIMIT 50
                """, (call_id, uid, last_signal_id))
                signals = [{"id": r[0], "from_user_id": r[1], "type": r[2], "payload": r[3]} for r in cur.fetchall()]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call": call_info, "signals": signals})}

        # incoming — проверить входящие звонки
        if action == "incoming":
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.caller_id, u.name, u.avatar_url, c.is_video, c.created_at
                    FROM {SCHEMA}.calls c
                    JOIN {SCHEMA}.users u ON u.id = c.caller_id
                    WHERE c.callee_id=%s AND c.status='ringing'
                      AND c.created_at > NOW() - INTERVAL '60 seconds'
                    ORDER BY c.created_at DESC LIMIT 1
                """, (uid,))
                row = cur.fetchone()
                if row:
                    return {"statusCode": 200, "headers": cors, "body": json.dumps({
                        "call": {
                            "id": row[0],
                            "caller_id": row[1],
                            "caller_name": row[2],
                            "caller_avatar": row[3],
                            "is_video": bool(row[4]),
                        }
                    })}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call": None})}

        # ping-call — повторный push входящего звонка (вызывается звонящим каждые ~4 сек)
        if action == "ping-call":
            body = body_pre
            call_id = safe_int(body.get("call_id"))
            if not call_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "call_id required"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.callee_id, c.status, c.is_video
                    FROM {SCHEMA}.calls c
                    WHERE c.id = %s AND c.caller_id = %s AND c.status = 'ringing'
                      AND c.created_at > NOW() - INTERVAL '75 seconds'
                """, (call_id, uid))
                row = cur.fetchone()
            if not row:
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": False, "reason": "not_ringing"})}

            callee_id = row[1]
            is_video = bool(row[3])

            if WEBPUSH_AVAILABLE:
                vapid_private = os.environ.get("VAPID_PRIVATE_KEY", "")
                vapid_public = os.environ.get("VAPID_PUBLIC_KEY", "")
                if vapid_private and vapid_public:
                    with conn.cursor() as cur:
                        cur.execute(f"""
                            SELECT endpoint, p256dh, auth
                            FROM {SCHEMA}.push_subscriptions
                            WHERE user_id = %s
                        """, (callee_id,))
                        subs = cur.fetchall()
                    call_type = "📹 Видеозвонок" if is_video else "📞 Аудиозвонок"
                    push_data = json.dumps({
                        "title": user["name"],
                        "body": call_type,
                        "tag": f"call-{call_id}",
                        "type": "call",
                        "call_id": call_id,
                        "url": "/",
                    })
                    dead_endpoints = []
                    for endpoint, p256dh, auth_k in subs:
                        try:
                            webpush(
                                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth_k}},
                                data=push_data,
                                vapid_private_key=vapid_private,
                                vapid_claims={"sub": "mailto:push@poehali.dev"},
                            )
                        except WebPushException as ex:
                            resp = ex.response
                            status = resp.status_code if resp else 0
                            if status in (404, 410):
                                dead_endpoints.append(endpoint)
                        except Exception as ex:
                            print(f"[ping-call push] error: {ex}")
                    for ep in dead_endpoints:
                        with conn.cursor() as cur:
                            cur.execute(f"DELETE FROM {SCHEMA}.push_subscriptions WHERE endpoint = %s", (ep,))
                        conn.commit()

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # history — история звонков
        if action == "history":
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.caller_id, c.callee_id, c.status, c.is_video,
                           c.created_at, c.answered_at, c.ended_at,
                           uc.name as caller_name, uu.name as callee_name,
                           uc.avatar_url as caller_avatar, uu.avatar_url as callee_avatar
                    FROM {SCHEMA}.calls c
                    JOIN {SCHEMA}.users uc ON uc.id = c.caller_id
                    JOIN {SCHEMA}.users uu ON uu.id = c.callee_id
                    WHERE c.caller_id=%s OR c.callee_id=%s
                    ORDER BY c.created_at DESC LIMIT 50
                """, (uid, uid))
                rows = cur.fetchall()

            calls = []
            for r in rows:
                call_type = "outgoing" if r[1] == uid else "incoming"
                duration = None
                if r[7] and r[6]:  # ended_at и answered_at
                    from datetime import datetime
                    try:
                        ended = r[7] if hasattr(r[7], 'timestamp') else datetime.fromisoformat(str(r[7]))
                        answered = r[6] if hasattr(r[6], 'timestamp') else datetime.fromisoformat(str(r[6]))
                        secs = int((ended - answered).total_seconds())
                        duration = f"{secs // 60}:{str(secs % 60).zfill(2)}"
                    except Exception:
                        duration = None
                calls.append({
                    "id": r[0], "caller_id": r[1], "callee_id": r[2],
                    "status": r[3], "is_video": bool(r[4]),
                    "created_at": str(r[5]) if r[5] else None,
                    "duration": duration, "type": call_type,
                    "caller_name": r[8], "callee_name": r[9],
                    "caller_avatar": r[10], "callee_avatar": r[11],
                })

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"calls": calls})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    finally:
        conn.close()