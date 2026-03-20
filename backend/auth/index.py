"""Аутентификация: регистрация, вход, профиль, фото, контакты"""
import json
import os
import hashlib
import secrets
import base64
import uuid
import psycopg2
import boto3

SCHEMA = "t_p22534578_messenger_mobile_app"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )

def get_user_by_token(conn, token: str):
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT u.id, u.name, u.phone, u.bio, u.status, u.avatar_url
            FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3], "status": row[4], "avatar_url": row[5]}
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
        # POST /register
        if method == "POST" and path.endswith("/register"):
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "").strip()
            phone = body.get("phone", "").strip()
            password = body.get("password", "")

            if not name or not phone or not password:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Заполните все поля"})}
            if len(password) < 6:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Пароль минимум 6 символов"})}

            pw_hash = hash_password(password)
            with conn.cursor() as cur:
                cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE phone = %s", (phone,))
                if cur.fetchone():
                    return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Номер уже зарегистрирован"})}
                cur.execute(
                    f"INSERT INTO {SCHEMA}.users (name, phone, password_hash) VALUES (%s, %s, %s) RETURNING id",
                    (name, phone, pw_hash)
                )
                user_id = cur.fetchone()[0]
                token_val = secrets.token_hex(32)
                cur.execute(
                    f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)",
                    (user_id, token_val)
                )
            conn.commit()
            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": phone, "bio": "", "status": "online", "avatar_url": None}})
            }

        # POST /login
        if method == "POST" and path.endswith("/login"):
            body = json.loads(event.get("body") or "{}")
            phone = body.get("phone", "").strip()
            password = body.get("password", "")
            pw_hash = hash_password(password)

            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT id, name, phone, bio, status, avatar_url FROM {SCHEMA}.users WHERE phone = %s AND password_hash = %s",
                    (phone, pw_hash)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный номер или пароль"})}
                user_id, name, ph, bio, status, avatar_url = row
                token_val = secrets.token_hex(32)
                cur.execute(
                    f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)",
                    (user_id, token_val)
                )
                cur.execute(f"UPDATE {SCHEMA}.users SET status = 'online', last_seen = NOW() WHERE id = %s", (user_id,))
            conn.commit()
            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": ph, "bio": bio or "", "status": "online", "avatar_url": avatar_url}})
            }

        # GET /me
        if method == "GET" and path.endswith("/me"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": user})}

        # POST /update-profile
        if method == "POST" and path.endswith("/update-profile"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            new_name = body.get("name", "").strip()
            new_bio = body.get("bio", "").strip()
            if not new_name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Имя не может быть пустым"})}
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {SCHEMA}.users SET name = %s, bio = %s WHERE id = %s RETURNING id, name, phone, bio, status, avatar_url",
                    (new_name, new_bio, user["id"])
                )
                row = cur.fetchone()
            conn.commit()
            updated = {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3] or "", "status": row[4], "avatar_url": row[5]}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": updated})}

        # POST /upload-avatar
        if method == "POST" and path.endswith("/upload-avatar"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            data_url = body.get("image", "")
            if not data_url or "," not in data_url:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет изображения"})}

            header, b64data = data_url.split(",", 1)
            img_bytes = base64.b64decode(b64data)
            ext = "jpg"
            content_type = "image/jpeg"
            if "png" in header:
                ext = "png"
                content_type = "image/png"
            elif "webp" in header:
                ext = "webp"
                content_type = "image/webp"

            key = f"avatars/{user['id']}_{uuid.uuid4().hex[:8]}.{ext}"
            s3 = get_s3()
            s3.put_object(Bucket="files", Key=key, Body=img_bytes, ContentType=content_type)
            cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"

            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {SCHEMA}.users SET avatar_url = %s WHERE id = %s RETURNING id, name, phone, bio, status, avatar_url",
                    (cdn_url, user["id"])
                )
                row = cur.fetchone()
            conn.commit()
            updated = {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3] or "", "status": row[4], "avatar_url": row[5]}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": updated})}

        # POST /change-password
        if method == "POST" and path.endswith("/change-password"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            current_pw = body.get("current_password", "")
            new_pw = body.get("new_password", "")
            if not current_pw or not new_pw:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Заполните все поля"})}
            if len(new_pw) < 6:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Новый пароль минимум 6 символов"})}
            current_hash = hash_password(current_pw)
            new_hash = hash_password(new_pw)
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.users WHERE id = %s AND password_hash = %s",
                    (user["id"], current_hash)
                )
                if not cur.fetchone():
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный текущий пароль"})}
                cur.execute(
                    f"UPDATE {SCHEMA}.users SET password_hash = %s WHERE id = %s",
                    (new_hash, user["id"])
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /logout
        if method == "POST" and path.endswith("/logout"):
            if token:
                with conn.cursor() as cur:
                    cur.execute(f"UPDATE {SCHEMA}.sessions SET expires_at = NOW() WHERE token = %s", (token,))
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # GET /contacts — список контактов пользователя
        if method == "GET" and path.endswith("/contacts"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.name, c.phone, c.contact_user_id,
                           u.status, u.avatar_url
                    FROM {SCHEMA}.contacts c
                    LEFT JOIN {SCHEMA}.users u ON u.id = c.contact_user_id
                    WHERE c.owner_id = %s
                    ORDER BY c.name
                """, (user["id"],))
                rows = cur.fetchall()
            contacts = [
                {"id": r[0], "name": r[1], "phone": r[2], "user_id": r[3], "status": r[4], "avatar_url": r[5]}
                for r in rows
            ]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"contacts": contacts})}

        # POST /contacts/add — добавить контакт (ручной или из телефонной книги)
        if method == "POST" and path.endswith("/contacts/add"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "").strip()
            phone = body.get("phone", "").strip()
            if not name or not phone:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Укажите имя и номер"})}

            with conn.cursor() as cur:
                cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE phone = %s", (phone,))
                found = cur.fetchone()
                contact_user_id = found[0] if found else None

                cur.execute(f"""
                    INSERT INTO {SCHEMA}.contacts (owner_id, contact_user_id, name, phone)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (owner_id, phone) DO UPDATE SET name = EXCLUDED.name, contact_user_id = EXCLUDED.contact_user_id
                    RETURNING id
                """, (user["id"], contact_user_id, name, phone))
                contact_id = cur.fetchone()[0]
            conn.commit()

            status = None
            avatar_url = None
            if contact_user_id:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT status, avatar_url FROM {SCHEMA}.users WHERE id = %s", (contact_user_id,))
                    r = cur.fetchone()
                    if r:
                        status, avatar_url = r

            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "contact": {"id": contact_id, "name": name, "phone": phone, "user_id": contact_user_id, "status": status, "avatar_url": avatar_url}
            })}

        # POST /contacts/sync — синхронизация из телефонной книги (массовое добавление)
        if method == "POST" and path.endswith("/contacts/sync"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            phonebook = body.get("contacts", [])
            if not phonebook:
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"synced": 0, "contacts": []})}

            added = []
            with conn.cursor() as cur:
                for entry in phonebook[:500]:
                    name = str(entry.get("name", "")).strip()
                    phone = str(entry.get("phone", "")).strip()
                    if not name or not phone:
                        continue
                    cur.execute(f"SELECT id, avatar_url, status FROM {SCHEMA}.users WHERE phone = %s", (phone,))
                    found = cur.fetchone()
                    contact_user_id = found[0] if found else None
                    av = found[1] if found else None
                    st = found[2] if found else None
                    cur.execute(f"""
                        INSERT INTO {SCHEMA}.contacts (owner_id, contact_user_id, name, phone)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (owner_id, phone) DO UPDATE SET name = EXCLUDED.name, contact_user_id = EXCLUDED.contact_user_id
                        RETURNING id
                    """, (user["id"], contact_user_id, name, phone))
                    cid = cur.fetchone()[0]
                    added.append({"id": cid, "name": name, "phone": phone, "user_id": contact_user_id, "status": st, "avatar_url": av})
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"synced": len(added), "contacts": added})}

        # POST /contacts/remove — удалить контакт
        if method == "POST" and path.endswith("/contacts/remove"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            contact_id = body.get("contact_id")
            if not contact_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Укажите contact_id"})}
            with conn.cursor() as cur:
                cur.execute(f"UPDATE {SCHEMA}.contacts SET contact_user_id = NULL WHERE id = %s AND owner_id = %s", (contact_id, user["id"]))
                # Mark as removed by setting phone to empty — actually just delete record logically
                cur.execute(f"UPDATE {SCHEMA}.contacts SET name = '[удалён]', phone = '' WHERE id = %s AND owner_id = %s", (contact_id, user["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
    finally:
        conn.close()
