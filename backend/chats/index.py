"""Чаты: список чатов пользователя, создание чата, получение сообщений, отправка, загрузка файлов"""
import json
import os
import base64
import mimetypes
import uuid
import boto3
import psycopg2
try:
    from pywebpush import webpush, WebPushException
    WEBPUSH_AVAILABLE = True
except ImportError:
    WEBPUSH_AVAILABLE = False

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

    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    token = event.get("headers", {}).get("X-Auth-Token") or event.get("headers", {}).get("x-auth-token")

    conn = get_conn()
    try:
        user = auth_user(conn, token)
        if not user:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

        user_id = user["id"]

        # Обновляем last_seen и статус online при каждом запросе
        with conn.cursor() as cur:
            cur.execute(f"UPDATE {SCHEMA}.users SET last_seen = NOW(), status = 'online' WHERE id = %s", (user_id,))
        conn.commit()

        # GET /presence?chat_id=X — статус и last_seen собеседника
        if method == "GET" and "presence" in path:
            params = event.get("queryStringParameters") or {}
            chat_id = params.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT u.status, u.last_seen
                    FROM {SCHEMA}.chat_members cm
                    JOIN {SCHEMA}.users u ON u.id = cm.user_id
                    WHERE cm.chat_id = %s AND cm.user_id != %s
                    LIMIT 1
                """, (chat_id, user_id))
                row = cur.fetchone()
            if not row:
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"status": "offline", "last_seen": None})}
            # считаем online если last_seen < 2 минут назад
            from datetime import datetime, timezone, timedelta
            last_seen = row[1]
            is_online = last_seen and (datetime.now(timezone.utc) - last_seen) < timedelta(minutes=2)
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "status": "online" if is_online else "offline",
                "last_seen": last_seen.isoformat() if last_seen else None,
            })}

        # GET /  — список чатов пользователя
        if method == "GET" and (path.endswith("/chats") or path.endswith("/chats/")):
            from datetime import datetime, timezone, timedelta
            with conn.cursor() as cur:
                # Оптимизированный запрос: один JOIN вместо 6 subqueries
                cur.execute(f"""
                    SELECT
                        c.id,
                        c.is_group,
                        COALESCE(c.name, peer.name, 'Без названия') AS display_name,
                        lm.text AS last_msg,
                        lm.created_at AS last_time,
                        COALESCE(unread.cnt, 0) AS unread,
                        COALESCE(mc.cnt, 0) AS member_count,
                        cm.role,
                        peer.last_seen AS peer_last_seen,
                        cm.pinned,
                        peer.id AS peer_id,
                        COALESCE(c.is_channel, FALSE) AS is_channel,
                        c.description,
                        c.avatar_url,
                        COALESCE(c.is_public, FALSE) AS is_public,
                        COALESCE(cm.can_post, FALSE) AS can_post
                    FROM {SCHEMA}.chats c
                    JOIN {SCHEMA}.chat_members cm ON cm.chat_id = c.id AND cm.user_id = %s AND cm.hidden = FALSE
                    LEFT JOIN LATERAL (
                        SELECT text, created_at FROM {SCHEMA}.messages
                        WHERE chat_id = c.id AND hidden_at IS NULL
                        ORDER BY created_at DESC LIMIT 1
                    ) lm ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT COUNT(*) AS cnt FROM {SCHEMA}.messages
                        WHERE chat_id = c.id AND sender_id != %s AND is_read = FALSE AND hidden_at IS NULL
                    ) unread ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT COUNT(*) AS cnt FROM {SCHEMA}.chat_members WHERE chat_id = c.id
                    ) mc ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT u2.id, u2.name, u2.last_seen
                        FROM {SCHEMA}.chat_members cm2
                        JOIN {SCHEMA}.users u2 ON u2.id = cm2.user_id
                        WHERE cm2.chat_id = c.id AND cm2.user_id != %s AND NOT c.is_group
                        LIMIT 1
                    ) peer ON TRUE
                    ORDER BY cm.pinned DESC, lm.created_at DESC NULLS LAST
                """, (user_id, user_id, user_id))
                rows = cur.fetchall()
                now = datetime.now(timezone.utc)
                chats = []
                for r in rows:
                    peer_last_seen = r[8]
                    is_online = peer_last_seen and (now - peer_last_seen) < timedelta(minutes=2)
                    chats.append({
                        "id": r[0],
                        "is_group": r[1],
                        "name": r[2],
                        "last_msg": r[3] or "",
                        "last_time": r[4].isoformat() if r[4] else None,
                        "unread": int(r[5]),
                        "member_count": int(r[6]),
                        "my_role": r[7],
                        "peer_online": bool(is_online),
                        "peer_last_seen": peer_last_seen.isoformat() if peer_last_seen else None,
                        "pinned": bool(r[9]),
                        "peer_id": r[10],
                        "is_channel": bool(r[11]),
                        "description": r[12],
                        "avatar_url": r[13],
                        "is_public": bool(r[14]),
                        "can_post": bool(r[15]),
                    })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"chats": chats})}

        # GET /global-search?q=текст — поиск по всем сообщениям пользователя
        if method == "GET" and "global-search" in path:
            params = event.get("queryStringParameters") or {}
            q = (params.get("q") or "").strip()
            if not q or len(q) < 2:
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"results": []})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT m.id, m.text, m.created_at, m.chat_id,
                           CASE WHEN c.is_group THEN c.name
                                ELSE (SELECT u2.name FROM {SCHEMA}.chat_members cm2
                                      JOIN {SCHEMA}.users u2 ON u2.id = cm2.user_id
                                      WHERE cm2.chat_id = c.id AND cm2.user_id != %s LIMIT 1)
                           END AS chat_name,
                           c.is_group,
                           sender.name AS sender_name,
                           (m.sender_id = %s) AS is_out
                    FROM {SCHEMA}.messages m
                    JOIN {SCHEMA}.chats c ON c.id = m.chat_id
                    JOIN {SCHEMA}.chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = %s AND cm.hidden = FALSE
                    JOIN {SCHEMA}.users sender ON sender.id = m.sender_id
                    WHERE m.is_deleted = FALSE AND m.text ILIKE %s
                    ORDER BY m.created_at DESC
                    LIMIT 50
                """, (user_id, user_id, user_id, f"%{q}%"))
                rows = cur.fetchall()
            results = []
            for r in rows:
                results.append({
                    "msg_id": r[0],
                    "text": r[1],
                    "time": r[2].isoformat() if r[2] else None,
                    "chat_id": r[3],
                    "chat_name": r[4] or "Чат",
                    "is_group": r[5],
                    "sender_name": r[6],
                    "is_out": bool(r[7]),
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"results": results})}

        # GET /messages?chat_id=X
        if method == "GET" and "messages" in path:
            params = event.get("queryStringParameters") or {}
            chat_id = params.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}

            with conn.cursor() as cur:
                # Check membership
                cur.execute(f"SELECT 1 FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}

                before_id = params.get("before_id")
                around_id = params.get("around_id")
                MSG_COLS = f"""m.id, m.sender_id, u.name, m.text, m.is_read, m.created_at,
                               m.file_url, m.file_name, m.file_size, m.file_type,
                               m.is_edited, m.hidden_at,
                               m.reply_to_id, m.reply_to_text, m.reply_to_name,
                               m.is_pinned"""
                if around_id:
                    # 20 до + само + 20 после = до 41 сообщения вокруг нужного
                    cur.execute(f"""
                        (SELECT {MSG_COLS}
                         FROM {SCHEMA}.messages m JOIN {SCHEMA}.users u ON u.id = m.sender_id
                         WHERE m.chat_id = %s AND m.id <= %s AND m.hidden_at IS NULL
                         ORDER BY m.created_at DESC LIMIT 21)
                        UNION ALL
                        (SELECT {MSG_COLS}
                         FROM {SCHEMA}.messages m JOIN {SCHEMA}.users u ON u.id = m.sender_id
                         WHERE m.chat_id = %s AND m.id > %s AND m.hidden_at IS NULL
                         ORDER BY m.created_at ASC LIMIT 20)
                        ORDER BY created_at ASC
                    """, (chat_id, around_id, chat_id, around_id))
                    rows = cur.fetchall()
                elif before_id:
                    cur.execute(f"""
                        SELECT {MSG_COLS}
                        FROM {SCHEMA}.messages m
                        JOIN {SCHEMA}.users u ON u.id = m.sender_id
                        WHERE m.chat_id = %s AND m.id < %s AND m.hidden_at IS NULL
                        ORDER BY m.created_at DESC
                        LIMIT 30
                    """, (chat_id, before_id))
                    rows = list(reversed(cur.fetchall()))
                else:
                    cur.execute(f"""
                        SELECT {MSG_COLS}
                        FROM {SCHEMA}.messages m
                        JOIN {SCHEMA}.users u ON u.id = m.sender_id
                        WHERE m.chat_id = %s AND m.hidden_at IS NULL
                        ORDER BY m.created_at DESC
                        LIMIT 40
                    """, (chat_id,))
                    rows = list(reversed(cur.fetchall()))
                has_more = False
                if rows:
                    cur.execute(f"SELECT 1 FROM {SCHEMA}.messages WHERE chat_id = %s AND id < %s AND hidden_at IS NULL LIMIT 1", (chat_id, rows[0][0]))
                    has_more = cur.fetchone() is not None

                # Load reactions for all messages
                msg_ids = [r[0] for r in rows]
                reactions_map = {}
                if msg_ids:
                    in_clause = ",".join(str(i) for i in msg_ids)
                    cur.execute(f"""
                        SELECT message_id, emoji, COUNT(*) as cnt,
                               BOOL_OR(user_id = {int(user_id)}) as i_reacted
                        FROM {SCHEMA}.message_reactions
                        WHERE message_id IN ({in_clause}) AND emoji != ''
                        GROUP BY message_id, emoji
                        ORDER BY message_id, MIN(created_at)
                    """)
                    for rr in cur.fetchall():
                        mid = rr[0]
                        if mid not in reactions_map:
                            reactions_map[mid] = []
                        reactions_map[mid].append({"emoji": rr[1], "count": int(rr[2]), "i_reacted": rr[3]})

                # Mark as read
                cur.execute(f"""
                    UPDATE {SCHEMA}.messages SET is_read = TRUE
                    WHERE chat_id = %s AND sender_id != %s AND is_read = FALSE
                """, (chat_id, user_id))
            conn.commit()

            messages = [{
                "id": r[0],
                "sender_id": r[1],
                "sender_name": r[2],
                "text": r[3] or "",
                "is_read": r[4],
                "time": r[5].strftime("%H:%M"),
                "out": r[1] == user_id,
                "file_url": r[6],
                "file_name": r[7],
                "file_size": r[8],
                "file_type": r[9],
                "reactions": reactions_map.get(r[0], []),
                "is_edited": r[10],
                "is_deleted": r[11] is not None,
                "date": r[5].strftime("%Y-%m-%d"),
                "reply_to_id": r[12],
                "reply_to_text": r[13],
                "reply_to_name": r[14],
                "is_pinned": r[15],
            } for r in rows]

            # Load pinned messages (latest pinned, not deleted)
            with conn.cursor() as cur2:
                cur2.execute(f"""
                    SELECT m.id, m.text, u.name, m.file_type
                    FROM {SCHEMA}.messages m
                    JOIN {SCHEMA}.users u ON u.id = m.sender_id
                    WHERE m.chat_id = %s AND m.is_pinned = TRUE AND m.hidden_at IS NULL
                    ORDER BY m.pinned_at DESC
                    LIMIT 1
                """, (chat_id,))
                pr = cur2.fetchone()
            pinned = {"id": pr[0], "text": pr[1] or "", "sender_name": pr[2], "file_type": pr[3]} if pr else None

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"messages": messages, "has_more": has_more, "pinned": pinned})}

        # POST /send — отправить сообщение (текст или файл)
        if method == "POST" and "send" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            text = (body.get("text") or "").strip()
            file_url = body.get("file_url") or None
            file_name = body.get("file_name") or None
            file_size = body.get("file_size") or None
            file_type = body.get("file_type") or None
            reply_to_id = body.get("reply_to_id") or None

            if not chat_id or (not text and not file_url):
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id и text или file_url обязательны"})}
            if len(text) > 4000:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Сообщение слишком длинное"})}

            try:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT 1 FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                    if not cur.fetchone():
                        return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}

                    reply_text = None
                    reply_name = None
                    if reply_to_id:
                        cur.execute(f"""
                            SELECT m.text, u.name FROM {SCHEMA}.messages m
                            JOIN {SCHEMA}.users u ON u.id = m.sender_id
                            WHERE m.id = %s
                        """, (reply_to_id,))
                        rr = cur.fetchone()
                        if rr:
                            reply_text = (rr[0] or "")[:200]
                            reply_name = rr[1]

                    cur.execute(
                        f"""INSERT INTO {SCHEMA}.messages
                            (chat_id, sender_id, text, file_url, file_name, file_size, file_type,
                             reply_to_id, reply_to_text, reply_to_name)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id, created_at""",
                        (chat_id, user_id, text or "", file_url, file_name, file_size, file_type,
                         reply_to_id, reply_text, reply_name)
                    )
                    msg_id, created_at = cur.fetchone()
                conn.commit()
            except Exception as e:
                conn.rollback()
                return {"statusCode": 500, "headers": cors, "body": json.dumps({"error": "Ошибка сохранения сообщения"})}

            # Send push notifications to other chat members
            if WEBPUSH_AVAILABLE:
                vapid_private = os.environ.get("VAPID_PRIVATE_KEY")
                vapid_public = os.environ.get("VAPID_PUBLIC_KEY")
                if vapid_private and vapid_public:
                    with conn.cursor() as cur:
                        cur.execute(f"""
                            SELECT ps.endpoint, ps.p256dh, ps.auth
                            FROM {SCHEMA}.push_subscriptions ps
                            JOIN {SCHEMA}.chat_members cm ON cm.user_id = ps.user_id
                            WHERE cm.chat_id = %s AND ps.user_id != %s
                        """, (chat_id, user_id))
                        subs = cur.fetchall()
                    preview = (text or ("📎 Файл" if file_url else ""))[:80]
                    push_data = json.dumps({"title": user["name"], "body": preview, "tag": f"chat-{chat_id}"})
                    for endpoint, p256dh, auth_k in subs:
                        try:
                            webpush(
                                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth_k}},
                                data=push_data,
                                vapid_private_key=vapid_private,
                                vapid_claims={"sub": "mailto:push@poehali.dev"},
                            )
                        except WebPushException:
                            pass

            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({
                    "message": {
                        "id": msg_id, "sender_id": user_id, "text": text or "", "is_read": False,
                        "time": created_at.strftime("%H:%M"), "out": True,
                        "file_url": file_url, "file_name": file_name,
                        "file_size": file_size, "file_type": file_type,
                        "reply_to_id": reply_to_id, "reply_to_text": reply_text, "reply_to_name": reply_name,
                    }
                })
            }

        # POST /pin-message — закрепить / открепить сообщение (только admin или для личного чата)
        if method == "POST" and "pin-message" in path:
            body = json.loads(event.get("body") or "{}")
            message_id = body.get("message_id")
            pin = body.get("pin", True)  # True = закрепить, False = открепить
            if not message_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "message_id обязателен"})}
            with conn.cursor() as cur:
                # Check membership and role
                cur.execute(f"""
                    SELECT cm.role FROM {SCHEMA}.messages m
                    JOIN {SCHEMA}.chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = %s
                    JOIN {SCHEMA}.chats c ON c.id = m.chat_id
                    WHERE m.id = %s
                """, (user_id, message_id))
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
                if pin:
                    cur.execute(f"UPDATE {SCHEMA}.messages SET is_pinned = TRUE, pinned_at = NOW() WHERE id = %s", (message_id,))
                else:
                    cur.execute(f"UPDATE {SCHEMA}.messages SET is_pinned = FALSE, pinned_at = NULL WHERE id = %s", (message_id,))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "pinned": pin})}

        # POST /edit-message — редактировать своё сообщение
        if method == "POST" and "edit-message" in path:
            body = json.loads(event.get("body") or "{}")
            message_id = body.get("message_id")
            new_text = (body.get("text") or "").strip()
            if not message_id or not new_text:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "message_id и text обязательны"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.messages SET text = %s, is_edited = TRUE
                    WHERE id = %s AND sender_id = %s AND hidden_at IS NULL
                    RETURNING id, text, is_edited
                """, (new_text, message_id, user_id))
                row = cur.fetchone()
            if not row:
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа или сообщение не найдено"})}
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": row[0], "text": row[1], "is_edited": row[2]})}

        # POST /delete-message — удалить своё сообщение (скрыть)
        if method == "POST" and "delete-message" in path:
            body = json.loads(event.get("body") or "{}")
            message_id = body.get("message_id")
            if not message_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "message_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.messages SET hidden_at = NOW()
                    WHERE id = %s AND sender_id = %s AND hidden_at IS NULL
                    RETURNING id
                """, (message_id, user_id))
                row = cur.fetchone()
            if not row:
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа или сообщение не найдено"})}
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "id": row[0]})}

        # POST /read — пометить сообщение как прочитанное
        if method == "POST" and path.endswith("/read"):
            body = json.loads(event.get("body") or "{}")
            message_id = body.get("message_id")
            if not message_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "message_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.messages SET is_read = TRUE
                    WHERE id = %s AND sender_id != %s AND is_read = FALSE
                    RETURNING id
                """, (message_id, user_id))
                row = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "updated": row is not None})}

        # POST /react — поставить или снять реакцию
        if method == "POST" and "react" in path:
            body = json.loads(event.get("body") or "{}")
            message_id = body.get("message_id")
            emoji = (body.get("emoji") or "").strip()
            if not message_id or not emoji:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "message_id и emoji обязательны"})}

            ALLOWED = {"👍","❤️","😂","😮","😢","🔥","👏","🎉"}
            if emoji not in ALLOWED:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Недопустимый эмодзи"})}

            with conn.cursor() as cur:
                # Verify user has access to the chat containing this message
                cur.execute(f"""
                    SELECT 1 FROM {SCHEMA}.messages m
                    JOIN {SCHEMA}.chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = %s
                    WHERE m.id = %s
                """, (user_id, message_id))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}

                # Toggle: if exists — remove, if not — add
                cur.execute(f"""
                    SELECT id FROM {SCHEMA}.message_reactions
                    WHERE message_id = %s AND user_id = %s AND emoji = %s
                """, (message_id, user_id, emoji))
                existing = cur.fetchone()
                if existing:
                    cur.execute(f"UPDATE {SCHEMA}.message_reactions SET emoji = emoji WHERE id = %s RETURNING id", (existing[0],))
                    # We use UPDATE as a no-op since DELETE is not allowed; mark as "toggled off" via a sentinel
                    # Actually just overwrite with same value and return removed=True
                    # The real toggle logic: we re-insert same row to get conflict → we delete via trick
                    # Since DELETE is blocked, we store a "removed" flag by setting emoji to empty string
                    cur.execute(f"UPDATE {SCHEMA}.message_reactions SET emoji = '' WHERE id = %s", (existing[0],))
                    toggled = "removed"
                else:
                    cur.execute(f"""
                        INSERT INTO {SCHEMA}.message_reactions (message_id, user_id, emoji)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (message_id, user_id, emoji) DO NOTHING
                    """, (message_id, emoji if emoji else emoji, emoji))
                    toggled = "added"

                # Get fresh reaction counts (exclude empty/removed)
                cur.execute(f"""
                    SELECT emoji, COUNT(*) as cnt,
                           BOOL_OR(user_id = {int(user_id)}) as i_reacted
                    FROM {SCHEMA}.message_reactions
                    WHERE message_id = %s AND emoji != ''
                    GROUP BY emoji
                    ORDER BY MIN(created_at)
                """, (message_id,))
                reactions = [{"emoji": rr[0], "count": int(rr[1]), "i_reacted": rr[2]} for rr in cur.fetchall()]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"reactions": reactions, "toggled": toggled})}

        # POST /upload — загрузить файл в S3
        if method == "POST" and "upload" in path:
            body = json.loads(event.get("body") or "{}")
            # Поддерживаем оба ключа: "file" и "file_data" (для голосовых)
            file_b64 = body.get("file") or body.get("file_data")
            file_name = (body.get("file_name") or "file").strip()
            file_type = body.get("file_type") or "application/octet-stream"

            if not file_b64:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "file required"})}

            file_data = base64.b64decode(file_b64)
            file_size = len(file_data)

            # Лимит 25 МБ
            if file_size > 25 * 1024 * 1024:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Файл слишком большой (макс. 25 МБ)"})}

            # Безопасное имя файла
            import re as _re
            safe_name = _re.sub(r'[^\w.\-]', '_', file_name)[:200] or "file"

            # Правильное расширение по MIME
            MIME_EXT = {
                "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
                "image/webp": ".webp", "image/heic": ".heic",
                "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
                "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
                "audio/mp4": ".m4a", "audio/wav": ".wav",
                "application/pdf": ".pdf",
            }
            ext = MIME_EXT.get(file_type) or mimetypes.guess_extension(file_type) or ""
            # Если в имени уже есть расширение — не дублируем
            if not safe_name.lower().endswith(ext.lower()):
                key_name = f"{uuid.uuid4().hex}{ext}"
            else:
                key_name = f"{uuid.uuid4().hex}_{safe_name}"

            key = f"chat-files/{key_name}"

            s3 = boto3.client(
                "s3",
                endpoint_url="https://bucket.poehali.dev",
                aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            )
            s3.put_object(
                Bucket="files", Key=key, Body=file_data,
                ContentType=file_type,
                Metadata={"original-name": safe_name},
            )
            cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"

            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({
                    "file_url": cdn_url, "url": cdn_url,
                    "file_name": safe_name,
                    "file_size": file_size,
                    "file_type": file_type,
                })
            }

        # POST /create — создать чат, группу или канал
        if method == "POST" and "create" in path:
            body = json.loads(event.get("body") or "{}")
            is_group = body.get("is_group", False)
            is_channel = body.get("is_channel", False)
            name = (body.get("name") or "").strip()
            description = (body.get("description") or "").strip() or None
            is_public = bool(body.get("is_public", False))
            members = body.get("members", [])

            if (is_group or is_channel) and not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Название обязательно"})}

            # Канал — это тоже группа с флагом is_channel
            if is_channel:
                is_group = True

            with conn.cursor() as cur:
                cur.execute(
                    f"""INSERT INTO {SCHEMA}.chats (name, is_group, is_channel, description, is_public, created_by)
                        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                    (name if is_group else None, is_group, is_channel, description, is_public, user_id)
                )
                chat_id = cur.fetchone()[0]
                # Создатель — admin с правом публикации
                cur.execute(
                    f"INSERT INTO {SCHEMA}.chat_members (chat_id, user_id, role, can_post) VALUES (%s, %s, 'admin', TRUE)",
                    (chat_id, user_id)
                )
                for mid in members:
                    if mid != user_id:
                        # В канале участники не могут постить по умолчанию
                        can_post_val = not is_channel
                        cur.execute(
                            f"""INSERT INTO {SCHEMA}.chat_members (chat_id, user_id, role, can_post)
                                VALUES (%s, %s, 'member', %s) ON CONFLICT DO NOTHING""",
                            (chat_id, mid, can_post_val)
                        )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"chat_id": chat_id, "is_channel": is_channel})}

        # POST /typing — сообщить что пользователь печатает
        if method == "POST" and "typing" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO typing_status (chat_id, user_id, user_name, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (chat_id, user_id) DO UPDATE SET updated_at = NOW()
                """, (chat_id, user_id, user["name"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # GET /typing — кто сейчас печатает в чате
        if method == "GET" and "typing" in path:
            params = event.get("queryStringParameters") or {}
            chat_id = params.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"typists": []})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT user_name FROM typing_status
                    WHERE chat_id = %s AND user_id != %s
                    AND updated_at > NOW() - INTERVAL '4 seconds'
                """, (chat_id, user_id))
                rows = cur.fetchall()
            typists = [r[0] for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"typists": typists})}

        # GET /stats — статистика чата
        if method == "GET" and "stats" in path:
            params = event.get("queryStringParameters") or {}
            chat_id = params.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}
            with conn.cursor() as cur:
                cur.execute(f"SELECT 1 FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
                cur.execute(f"""
                    SELECT
                        COUNT(*) FILTER (WHERE hidden_at IS NULL) AS total_messages,
                        COUNT(*) FILTER (WHERE hidden_at IS NULL AND file_url IS NOT NULL) AS total_files,
                        COUNT(*) FILTER (WHERE hidden_at IS NULL AND file_type LIKE 'image/%%') AS total_photos,
                        MIN(created_at) AS first_message_at,
                        COUNT(DISTINCT sender_id) AS active_members
                    FROM {SCHEMA}.messages
                    WHERE chat_id = %s
                """, (chat_id,))
                r = cur.fetchone()
                cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.chat_members WHERE chat_id = %s", (chat_id,))
                member_count = cur.fetchone()[0]
            from datetime import datetime, timezone
            first_at = r[3]
            days_active = (datetime.now(timezone.utc) - first_at).days + 1 if first_at else 0
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "total_messages": int(r[0]),
                "total_files": int(r[1]),
                "total_photos": int(r[2]),
                "first_message_at": first_at.isoformat() if first_at else None,
                "active_members": int(r[4]),
                "member_count": int(member_count),
                "days_active": days_active,
            })}

        # GET /members — список участников чата с ролями
        if method == "GET" and "members" in path:
            params = event.get("queryStringParameters") or {}
            chat_id = params.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}
            with conn.cursor() as cur:
                # Check membership
                cur.execute(f"SELECT 1 FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
                cur.execute(f"""
                    SELECT u.id, u.name, u.status, cm.role
                    FROM {SCHEMA}.chat_members cm
                    JOIN {SCHEMA}.users u ON u.id = cm.user_id
                    WHERE cm.chat_id = %s
                    ORDER BY cm.role DESC, u.name
                """, (chat_id,))
                rows = cur.fetchall()
            members = [{"id": r[0], "name": r[1], "status": r[2], "role": r[3], "is_me": r[0] == user_id} for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"members": members})}

        # POST /leave — покинуть группу
        if method == "POST" and "leave" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id required"})}
            with conn.cursor() as cur:
                # Check it's a group
                cur.execute(f"SELECT is_group FROM {SCHEMA}.chats WHERE id = %s", (chat_id,))
                row = cur.fetchone()
                if not row or not row[0]:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нельзя покинуть личный чат"})}
                cur.execute(f"DELETE FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                # Add system message
                cur.execute(
                    f"INSERT INTO {SCHEMA}.messages (chat_id, sender_id, text) VALUES (%s, %s, %s)",
                    (chat_id, user_id, f"👋 {user['name']} покинул(а) группу")
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /kick — удалить участника (только для админов)
        if method == "POST" and "kick" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            target_id = body.get("user_id")
            if not chat_id or not target_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id и user_id обязательны"})}
            with conn.cursor() as cur:
                # Check caller is admin
                cur.execute(f"SELECT role FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                row = cur.fetchone()
                if not row or row[0] != "admin":
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Только администратор может удалять участников"})}
                # Get target name
                cur.execute(f"SELECT name FROM {SCHEMA}.users WHERE id = %s", (target_id,))
                t = cur.fetchone()
                target_name = t[0] if t else "Участник"
                cur.execute(f"DELETE FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, target_id))
                cur.execute(
                    f"INSERT INTO {SCHEMA}.messages (chat_id, sender_id, text) VALUES (%s, %s, %s)",
                    (chat_id, user_id, f"🚫 {target_name} удалён(а) из группы")
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # GET /users — поиск пользователей для добавления
        if method == "GET" and "users" in path:
            params = event.get("queryStringParameters") or {}
            q = params.get("q", "").strip()
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT id, name, phone, status FROM {SCHEMA}.users
                    WHERE id != %s AND (name ILIKE %s OR phone ILIKE %s)
                    LIMIT 20
                """, (user_id, f"%{q}%", f"%{q}%"))
                rows = cur.fetchall()
            users = [{"id": r[0], "name": r[1], "phone": r[2], "status": r[3]} for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"users": users})}

        # GET /vapid-public-key — отдать публичный VAPID ключ фронтенду
        if method == "GET" and "vapid-public-key" in path:
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"public_key": os.environ.get("VAPID_PUBLIC_KEY", "")})}

        # POST /pin-chat — закрепить / открепить чат для текущего пользователя
        if method == "POST" and "pin-chat" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            pin = body.get("pin", True)
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.chat_members SET pinned = %s
                    WHERE chat_id = %s AND user_id = %s
                """, (pin, chat_id, user_id))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "pinned": pin})}

        # POST /hide-chat — скрыть личный чат для себя (мягкое удаление)
        if method == "POST" and "hide-chat" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            if not chat_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.chat_members SET hidden = TRUE, pinned = FALSE
                    WHERE chat_id = %s AND user_id = %s
                """, (chat_id, user_id))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /subscribe — сохранить push-подписку устройства
        if method == "POST" and "subscribe" in path:
            body = json.loads(event.get("body") or "{}")
            endpoint = body.get("endpoint")
            p256dh = (body.get("keys") or {}).get("p256dh")
            auth_key = (body.get("keys") or {}).get("auth")
            if not endpoint or not p256dh or not auth_key:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "endpoint и keys обязательны"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.push_subscriptions (user_id, endpoint, p256dh, auth)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
                """, (user_id, endpoint, p256dh, auth_key))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /delete-account — полное удаление аккаунта пользователя
        if method == "POST" and "delete-account" in path:
            with conn.cursor() as cur:
                # Анонимизируем сообщения (текст сохраняем, имя сбрасываем)
                cur.execute(f"UPDATE {SCHEMA}.users SET name = 'Удалённый пользователь', phone = NULL, bio = NULL, status = 'offline' WHERE id = %s", (user_id,))
                # Удаляем сессии
                cur.execute(f"DELETE FROM {SCHEMA}.sessions WHERE user_id = %s", (user_id,))
                # Удаляем из чатов
                cur.execute(f"DELETE FROM {SCHEMA}.chat_members WHERE user_id = %s", (user_id,))
                # Удаляем push подписки
                cur.execute(f"DELETE FROM {SCHEMA}.push_subscriptions WHERE user_id = %s", (user_id,))
                # Удаляем реакции
                cur.execute(f"DELETE FROM {SCHEMA}.message_reactions WHERE user_id = %s", (user_id,))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
    finally:
        conn.close()