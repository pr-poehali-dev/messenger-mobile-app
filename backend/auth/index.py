"""Аутентификация: регистрация, вход, получение профиля, выход"""
import json
import os
import hashlib
import secrets
import psycopg2

SCHEMA = "t_p22534578_messenger_mobile_app"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_user_by_token(conn, token: str):
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
                "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": phone, "bio": "", "status": "online"}})
            }

        # POST /login
        if method == "POST" and path.endswith("/login"):
            body = json.loads(event.get("body") or "{}")
            phone = body.get("phone", "").strip()
            password = body.get("password", "")
            pw_hash = hash_password(password)

            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT id, name, phone, bio, status FROM {SCHEMA}.users WHERE phone = %s AND password_hash = %s",
                    (phone, pw_hash)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный номер или пароль"})}
                user_id, name, ph, bio, status = row
                token_val = secrets.token_hex(32)
                cur.execute(
                    f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)",
                    (user_id, token_val)
                )
                cur.execute(f"UPDATE {SCHEMA}.users SET status = 'online', last_seen = NOW() WHERE id = %s", (user_id,))
            conn.commit()
            return {
                "statusCode": 200, "headers": cors,
                "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": ph, "bio": bio or "", "status": "online"}})
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
                    f"UPDATE {SCHEMA}.users SET name = %s, bio = %s WHERE id = %s RETURNING id, name, phone, bio, status",
                    (new_name, new_bio, user["id"])
                )
                row = cur.fetchone()
            conn.commit()
            updated = {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3] or "", "status": row[4]}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": updated})}

        # POST /logout
        if method == "POST" and path.endswith("/logout"):
            if token:
                with conn.cursor() as cur:
                    cur.execute(f"UPDATE {SCHEMA}.sessions SET expires_at = NOW() WHERE token = %s", (token,))
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
    finally:
        conn.close()