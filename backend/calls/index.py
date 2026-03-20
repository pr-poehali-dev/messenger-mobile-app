"""Звонки: сигнализация WebRTC (offer/answer/ice), управление статусом звонка, история"""
import json
import os
import psycopg2

SCHEMA = "t_p22534578_messenger_mobile_app"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def auth_user(conn, token: str):
    if not token:
        return None
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT u.id, u.name, u.phone, u.bio, u.status
            FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3], "status": row[4]}
    return None

def handler(event: dict, context) -> dict:
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

    conn = get_conn()
    user = auth_user(conn, token)
    if not user:
        conn.close()
        return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Unauthorized"})}

    uid = user["id"]

    try:
        # POST /initiate — начать звонок
        if path.endswith("/initiate") and method == "POST":
            body = json.loads(event.get("body") or "{}")
            callee_id = body.get("callee_id")
            if not callee_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "callee_id required"})}

            with conn.cursor() as cur:
                # Завершаем старые активные звонки этого пользователя
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='ended', ended_at=NOW()
                    WHERE (caller_id=%s OR callee_id=%s) AND status IN ('ringing','active')
                """, (uid, uid))
                # Создаём новый звонок
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.calls (caller_id, callee_id, status)
                    VALUES (%s, %s, 'ringing') RETURNING id
                """, (uid, callee_id))
                call_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call_id": call_id})}

        # POST /answer — ответить на звонок
        if path.endswith("/answer") and method == "POST":
            body = json.loads(event.get("body") or "{}")
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='active', answered_at=NOW()
                    WHERE id=%s AND callee_id=%s AND status='ringing'
                """, (call_id, uid))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /decline — отклонить звонок
        if path.endswith("/decline") and method == "POST":
            body = json.loads(event.get("body") or "{}")
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='declined', ended_at=NOW()
                    WHERE id=%s AND callee_id=%s AND status='ringing'
                """, (call_id, uid))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /end — завершить звонок
        if path.endswith("/end") and method == "POST":
            body = json.loads(event.get("body") or "{}")
            call_id = body.get("call_id")
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.calls SET status='ended', ended_at=NOW()
                    WHERE id=%s AND (caller_id=%s OR callee_id=%s) AND status IN ('ringing','active')
                """, (call_id, uid, uid))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /signal — отправить WebRTC сигнал (offer/answer/ice-candidate)
        if path.endswith("/signal") and method == "POST":
            body = json.loads(event.get("body") or "{}")
            call_id = body.get("call_id")
            signal_type = body.get("type")  # offer | answer | ice-candidate
            payload = body.get("payload")
            if not all([call_id, signal_type, payload]):
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "call_id, type, payload required"})}

            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.call_signals (call_id, from_user_id, signal_type, payload)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (call_id, uid, signal_type, payload if isinstance(payload, str) else json.dumps(payload)))
                sig_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"signal_id": sig_id})}

        # GET /poll?call_id=X&last_signal_id=Y — получить новые сигналы и статус звонка
        if path.endswith("/poll") and method == "GET":
            params = event.get("queryStringParameters") or {}
            call_id = int(params.get("call_id", 0))
            last_signal_id = int(params.get("last_signal_id", 0))

            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.status, c.caller_id, c.callee_id,
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
                    "caller_name": row[4], "callee_name": row[5]
                }

                cur.execute(f"""
                    SELECT id, from_user_id, signal_type, payload
                    FROM {SCHEMA}.call_signals
                    WHERE call_id=%s AND from_user_id != %s AND id > %s
                    ORDER BY id ASC LIMIT 50
                """, (call_id, uid, last_signal_id))
                signals = [{"id": r[0], "from_user_id": r[1], "type": r[2], "payload": r[3]} for r in cur.fetchall()]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call": call_info, "signals": signals})}

        # GET /incoming — проверить входящие звонки
        if path.endswith("/incoming") and method == "GET":
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.caller_id, u.name as caller_name, c.created_at
                    FROM {SCHEMA}.calls c
                    JOIN {SCHEMA}.users u ON u.id = c.caller_id
                    WHERE c.callee_id=%s AND c.status='ringing'
                      AND c.created_at > NOW() - INTERVAL '60 seconds'
                    ORDER BY c.created_at DESC LIMIT 1
                """, (uid,))
                row = cur.fetchone()
                if row:
                    return {"statusCode": 200, "headers": cors, "body": json.dumps({
                        "call": {"id": row[0], "caller_id": row[1], "caller_name": row[2]}
                    })}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"call": None})}

        # GET /history — история звонков
        if path.endswith("/history") and method == "GET":
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.caller_id, c.callee_id, c.status,
                           c.created_at, c.answered_at, c.ended_at,
                           uc.name as caller_name, uu.name as callee_name
                    FROM {SCHEMA}.calls c
                    JOIN {SCHEMA}.users uc ON uc.id = c.caller_id
                    JOIN {SCHEMA}.users uu ON uu.id = c.callee_id
                    WHERE c.caller_id=%s OR c.callee_id=%s
                    ORDER BY c.created_at DESC LIMIT 50
                """, (uid, uid))
                rows = cur.fetchall()
                calls = []
                for r in rows:
                    duration = None
                    if r[5] and r[6]:
                        secs = int((r[6] - r[5]).total_seconds())
                        duration = f"{secs // 60}:{secs % 60:02d}"
                    calls.append({
                        "id": r[0],
                        "caller_id": r[1], "callee_id": r[2],
                        "status": r[3],
                        "created_at": r[4].isoformat() if r[4] else None,
                        "duration": duration,
                        "caller_name": r[7], "callee_name": r[8],
                        "type": "outgoing" if r[1] == uid else ("missed" if r[3] == "missed" else "incoming")
                    })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"calls": calls})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    finally:
        conn.close()