"""Чаты: список чатов пользователя, создание чата, получение сообщений, отправка, загрузка файлов"""
import json
import os
import base64
import mimetypes
import uuid
import boto3
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

    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    token = event.get("headers", {}).get("X-Auth-Token") or event.get("headers", {}).get("x-auth-token")

    conn = get_conn()
    try:
        user = auth_user(conn, token)
        if not user:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

        user_id = user["id"]

        # GET /  — список чатов пользователя
        if method == "GET" and (path.endswith("/chats") or path.endswith("/chats/")):
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT
                        c.id,
                        CASE WHEN c.is_group THEN c.name
                             ELSE (SELECT u2.name FROM {SCHEMA}.chat_members cm2
                                   JOIN {SCHEMA}.users u2 ON u2.id = cm2.user_id
                                   WHERE cm2.chat_id = c.id AND cm2.user_id != %s LIMIT 1)
                        END AS display_name,
                        c.is_group,
                        (SELECT m.text FROM {SCHEMA}.messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_msg,
                        (SELECT m.created_at FROM {SCHEMA}.messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_time,
                        (SELECT COUNT(*) FROM {SCHEMA}.messages m WHERE m.chat_id = c.id AND m.is_read = FALSE AND m.sender_id != %s) AS unread,
                        (SELECT COUNT(*) FROM {SCHEMA}.chat_members cm3 WHERE cm3.chat_id = c.id) AS member_count,
                        cm.role
                    FROM {SCHEMA}.chats c
                    JOIN {SCHEMA}.chat_members cm ON cm.chat_id = c.id AND cm.user_id = %s
                    ORDER BY last_time DESC NULLS LAST
                """, (user_id, user_id, user_id))
                rows = cur.fetchall()
                chats = []
                for r in rows:
                    chats.append({
                        "id": r[0],
                        "name": r[1] or "Без названия",
                        "is_group": r[2],
                        "last_msg": r[3] or "",
                        "last_time": r[4].isoformat() if r[4] else None,
                        "unread": int(r[5]),
                        "member_count": int(r[6]),
                        "my_role": r[7],
                    })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"chats": chats})}

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

                cur.execute(f"""
                    SELECT m.id, m.sender_id, u.name, m.text, m.is_read, m.created_at,
                           m.file_url, m.file_name, m.file_size, m.file_type
                    FROM {SCHEMA}.messages m
                    JOIN {SCHEMA}.users u ON u.id = m.sender_id
                    WHERE m.chat_id = %s
                    ORDER BY m.created_at ASC
                    LIMIT 100
                """, (chat_id,))
                rows = cur.fetchall()
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
            } for r in rows]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"messages": messages})}

        # POST /send — отправить сообщение (текст или файл)
        if method == "POST" and "send" in path:
            body = json.loads(event.get("body") or "{}")
            chat_id = body.get("chat_id")
            text = (body.get("text") or "").strip()
            file_url = body.get("file_url") or None
            file_name = body.get("file_name") or None
            file_size = body.get("file_size") or None
            file_type = body.get("file_type") or None

            if not chat_id or (not text and not file_url):
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "chat_id и text или file_url обязательны"})}

            with conn.cursor() as cur:
                cur.execute(f"SELECT 1 FROM {SCHEMA}.chat_members WHERE chat_id = %s AND user_id = %s", (chat_id, user_id))
                if not cur.fetchone():
                    return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
                cur.execute(
                    f"""INSERT INTO {SCHEMA}.messages (chat_id, sender_id, text, file_url, file_name, file_size, file_type)
                        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, created_at""",
                    (chat_id, user_id, text or "", file_url, file_name, file_size, file_type)
                )
                msg_id, created_at = cur.fetchone()
            conn.commit()
            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({
                    "message": {
                        "id": msg_id, "sender_id": user_id, "text": text or "", "is_read": False,
                        "time": created_at.strftime("%H:%M"), "out": True,
                        "file_url": file_url, "file_name": file_name,
                        "file_size": file_size, "file_type": file_type,
                    }
                })
            }

        # POST /upload — загрузить файл в S3
        if method == "POST" and "upload" in path:
            body = json.loads(event.get("body") or "{}")
            file_b64 = body.get("file")
            file_name = body.get("file_name", "file")
            file_type = body.get("file_type", "application/octet-stream")
            if not file_b64:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "file required"})}

            file_data = base64.b64decode(file_b64)
            file_size = len(file_data)
            ext = mimetypes.guess_extension(file_type) or ""
            key = f"chat-files/{uuid.uuid4().hex}{ext}"

            s3 = boto3.client(
                "s3",
                endpoint_url="https://bucket.poehali.dev",
                aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            )
            s3.put_object(Bucket="files", Key=key, Body=file_data, ContentType=file_type)
            cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"

            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({
                    "file_url": cdn_url,
                    "file_name": file_name,
                    "file_size": file_size,
                    "file_type": file_type,
                })
            }

        # POST /create — создать чат
        if method == "POST" and "create" in path:
            body = json.loads(event.get("body") or "{}")
            is_group = body.get("is_group", False)
            name = body.get("name", "").strip()
            members = body.get("members", [])  # list of user_ids

            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.chats (name, is_group, created_by) VALUES (%s, %s, %s) RETURNING id",
                    (name if is_group else None, is_group, user_id)
                )
                chat_id = cur.fetchone()[0]
                # Add creator as admin
                cur.execute(
                    f"INSERT INTO {SCHEMA}.chat_members (chat_id, user_id, role) VALUES (%s, %s, 'admin')",
                    (chat_id, user_id)
                )
                for mid in members:
                    if mid != user_id:
                        cur.execute(
                            f"INSERT INTO {SCHEMA}.chat_members (chat_id, user_id, role) VALUES (%s, %s, 'member') ON CONFLICT DO NOTHING",
                            (chat_id, mid)
                        )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"chat_id": chat_id})}

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

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
    finally:
        conn.close()