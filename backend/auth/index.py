"""Аутентификация: регистрация, вход, OTP-коды (email/SMS), профиль, фото, контакты"""
import json
import os
import re
import random
import hashlib
import secrets
import base64
import uuid
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import psycopg2
import boto3
try:
    import requests as http_requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

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
            SELECT u.id, u.name, u.phone, u.bio, u.status, u.avatar_url, u.email
            FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > NOW()
        """, (token,))
        row = cur.fetchone()
        if row:
            return {"id": row[0], "name": row[1], "phone": row[2], "bio": row[3],
                    "status": row[4], "avatar_url": row[5], "email": row[6]}
    return None

def is_email(contact: str) -> bool:
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', contact))

def normalize_phone(phone: str) -> str:
    p = re.sub(r'[^\d+]', '', phone)
    if p.startswith('8') and len(p) == 11:
        p = '+7' + p[1:]
    elif p.startswith('7') and len(p) == 11:
        p = '+' + p
    return p

def send_email_code(to_email: str, code: str, purpose: str):
    smtp_host = os.environ.get("SMTP_HOST", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "465"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASSWORD", "")
    if not smtp_host or not smtp_user or not smtp_pass:
        return False

    action = "регистрации" if purpose == "register" else "входа"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Каспер: код подтверждения {code}"
    msg["From"] = f"Каспер <{smtp_user}>"
    msg["To"] = to_email

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#071426;color:#e0f2fe;padding:32px;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <img src="https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/files/8f6169f2-71c4-4f34-8ad2-ca3c377792eb.jpg"
             style="width:72px;height:72px;border-radius:50%;object-fit:cover"/>
        <h2 style="color:#38bdf8;margin:12px 0 4px">Каспер</h2>
        <p style="color:#94a3b8;margin:0;font-size:14px">Мессенджер вашего сообщества</p>
      </div>
      <div style="background:#0f2744;border-radius:12px;padding:24px;text-align:center">
        <p style="color:#94a3b8;margin:0 0 16px;font-size:15px">Ваш код для {action}:</p>
        <div style="font-size:40px;font-weight:900;letter-spacing:12px;color:#38bdf8;font-family:monospace;padding:16px 0">{code}</div>
        <p style="color:#64748b;margin:16px 0 0;font-size:13px">Код действителен 10 минут.<br>Никому не сообщайте этот код.</p>
      </div>
      <p style="color:#334155;font-size:12px;text-align:center;margin-top:20px">
        Если вы не запрашивали код — просто проигнорируйте это письмо.
      </p>
    </div>
    """
    msg.attach(MIMEText(html, "html", "utf-8"))

    context = ssl.create_default_context()
    if smtp_port == 465:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, to_email, msg.as_string())
    else:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, to_email, msg.as_string())
    return True

def send_sms_code(phone: str, code: str):
    api_key = os.environ.get("SMS_RU_API_KEY", "")
    if not api_key or not REQUESTS_AVAILABLE:
        return False
    text = f"Каспер: ваш код подтверждения {code}. Действителен 10 минут."
    try:
        resp = http_requests.get(
            "https://sms.ru/sms/send",
            params={"api_id": api_key, "to": phone, "msg": text, "json": 1},
            timeout=10
        )
        data = resp.json()
        return data.get("status") == "OK"
    except Exception:
        return False

def generate_code() -> str:
    return str(random.randint(100000, 999999))

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

        # POST /send-code — отправить OTP на email или телефон
        if method == "POST" and path.endswith("/send-code"):
            body = json.loads(event.get("body") or "{}")
            contact = body.get("contact", "").strip()
            purpose = body.get("purpose", "register")

            if not contact:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Укажите email или телефон"})}

            contact_type = "email" if is_email(contact) else "phone"
            if contact_type == "phone":
                contact = normalize_phone(contact)

            # Проверяем существование при регистрации
            if purpose == "register":
                with conn.cursor() as cur:
                    if contact_type == "email":
                        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email = %s", (contact,))
                    else:
                        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE phone = %s", (contact,))
                    if cur.fetchone():
                        field = "Email" if contact_type == "email" else "Номер"
                        return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": f"{field} уже зарегистрирован"})}
            elif purpose == "login":
                with conn.cursor() as cur:
                    if contact_type == "email":
                        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email = %s", (contact,))
                    else:
                        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE phone = %s", (contact,))
                    if not cur.fetchone():
                        field = "Email" if contact_type == "email" else "Номер"
                        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": f"{field} не зарегистрирован"})}

            # Лимит: не более 3 кодов за 10 минут
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM {SCHEMA}.verification_codes
                    WHERE contact = %s AND contact_type = %s AND created_at > NOW() - INTERVAL '10 minutes'
                """, (contact, contact_type))
                cnt = cur.fetchone()[0]
                if cnt >= 3:
                    return {"statusCode": 429, "headers": cors, "body": json.dumps({"error": "Слишком много попыток. Подождите 10 минут"})}

            code = generate_code()
            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.verification_codes (contact, contact_type, code, purpose)
                    VALUES (%s, %s, %s, %s)
                """, (contact, contact_type, code, purpose))
            conn.commit()

            sent = False
            if contact_type == "email":
                sent = send_email_code(contact, code, purpose)
            else:
                sent = send_sms_code(contact, code)
                if not sent:
                    # Fallback: вернуть код в ответе только в dev (убрать в продакшене)
                    pass

            # В dev-режиме всегда возвращаем код для тестирования
            dev_mode = not os.environ.get("SMTP_HOST") and not os.environ.get("SMS_RU_API_KEY")

            resp_body = {"ok": True, "contact_type": contact_type, "sent": sent}
            if dev_mode:
                resp_body["dev_code"] = code  # Убрать в продакшене после настройки SMTP/SMS
            return {"statusCode": 200, "headers": cors, "body": json.dumps(resp_body)}

        # POST /verify-code — проверить OTP и зарегистрировать/войти
        if method == "POST" and path.endswith("/verify-code"):
            body = json.loads(event.get("body") or "{}")
            contact = body.get("contact", "").strip()
            code = body.get("code", "").strip()
            purpose = body.get("purpose", "register")
            name = body.get("name", "").strip()

            if not contact or not code:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Укажите контакт и код"})}
            if purpose == "register" and not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Укажите имя"})}

            contact_type = "email" if is_email(contact) else "phone"
            if contact_type == "phone":
                contact = normalize_phone(contact)

            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT id, code, attempts, used FROM {SCHEMA}.verification_codes
                    WHERE contact = %s AND contact_type = %s AND purpose = %s
                      AND expires_at > NOW() AND used = FALSE
                    ORDER BY created_at DESC LIMIT 1
                """, (contact, contact_type, purpose))
                row = cur.fetchone()

            if not row:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Код недействителен или истёк. Запросите новый"})}

            vc_id, saved_code, attempts, used = row

            if attempts >= 5:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Превышено число попыток. Запросите новый код"})}

            if code != saved_code:
                with conn.cursor() as cur:
                    cur.execute(f"UPDATE {SCHEMA}.verification_codes SET attempts = attempts + 1 WHERE id = %s", (vc_id,))
                conn.commit()
                left = 4 - attempts
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Неверный код. Осталось попыток: {left}"})}

            # Помечаем код как использованный
            with conn.cursor() as cur:
                cur.execute(f"UPDATE {SCHEMA}.verification_codes SET used = TRUE WHERE id = %s", (vc_id,))
            conn.commit()

            if purpose == "register":
                # Регистрация нового пользователя
                phone_val = contact if contact_type == "phone" else None
                email_val = contact if contact_type == "email" else None

                with conn.cursor() as cur:
                    cur.execute(f"""
                        INSERT INTO {SCHEMA}.users (name, phone, email, phone_verified, email_verified, password_hash)
                        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
                    """, (name, phone_val, email_val,
                          contact_type == "phone", contact_type == "email",
                          hash_password(secrets.token_hex(16))))
                    user_id = cur.fetchone()[0]
                    token_val = secrets.token_hex(32)
                    cur.execute(f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)", (user_id, token_val))
                conn.commit()
                user = {"id": user_id, "name": name, "phone": phone_val, "email": email_val,
                        "bio": "", "status": "online", "avatar_url": None}
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"token": token_val, "user": user, "is_new": True})}

            else:
                # Вход по OTP
                with conn.cursor() as cur:
                    if contact_type == "email":
                        cur.execute(f"SELECT id, name, phone, bio, status, avatar_url, email FROM {SCHEMA}.users WHERE email = %s", (contact,))
                    else:
                        cur.execute(f"SELECT id, name, phone, bio, status, avatar_url, email FROM {SCHEMA}.users WHERE phone = %s", (contact,))
                    row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Пользователь не найден"})}
                user_id, uname, uphone, ubio, ustatus, uavatar, uemail = row
                token_val = secrets.token_hex(32)
                with conn.cursor() as cur:
                    cur.execute(f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)", (user_id, token_val))
                    cur.execute(f"UPDATE {SCHEMA}.users SET status = 'online', last_seen = NOW() WHERE id = %s", (user_id,))
                conn.commit()
                user = {"id": user_id, "name": uname, "phone": uphone, "email": uemail,
                        "bio": ubio or "", "status": "online", "avatar_url": uavatar}
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"token": token_val, "user": user, "is_new": False})}

        # POST /register (оставляем для обратной совместимости)
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
                cur.execute(f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)", (user_id, token_val))
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": phone, "bio": "", "status": "online", "avatar_url": None}})}

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
                cur.execute(f"INSERT INTO {SCHEMA}.sessions (user_id, token) VALUES (%s, %s)", (user_id, token_val))
                cur.execute(f"UPDATE {SCHEMA}.users SET status = 'online', last_seen = NOW() WHERE id = %s", (user_id,))
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"token": token_val, "user": {"id": user_id, "name": name, "phone": ph, "bio": bio or "", "status": "online", "avatar_url": avatar_url}})}

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
            ext = "jpg"; content_type = "image/jpeg"
            if "png" in header: ext = "png"; content_type = "image/png"
            elif "webp" in header: ext = "webp"; content_type = "image/webp"
            key = f"avatars/{user['id']}_{uuid.uuid4().hex[:8]}.{ext}"
            s3 = get_s3()
            s3.put_object(Bucket="files", Key=key, Body=img_bytes, ContentType=content_type)
            cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
            with conn.cursor() as cur:
                cur.execute(f"UPDATE {SCHEMA}.users SET avatar_url = %s WHERE id = %s RETURNING id, name, phone, bio, status, avatar_url", (cdn_url, user["id"]))
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
                cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE id = %s AND password_hash = %s", (user["id"], current_hash))
                if not cur.fetchone():
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный текущий пароль"})}
                cur.execute(f"UPDATE {SCHEMA}.users SET password_hash = %s WHERE id = %s", (new_hash, user["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /logout
        if method == "POST" and path.endswith("/logout"):
            if token:
                with conn.cursor() as cur:
                    cur.execute(f"UPDATE {SCHEMA}.sessions SET expires_at = NOW() WHERE token = %s", (token,))
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # GET /contacts
        if method == "GET" and path.endswith("/contacts"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT c.id, c.name, c.phone, c.contact_user_id, u.status, u.avatar_url
                    FROM {SCHEMA}.contacts c
                    LEFT JOIN {SCHEMA}.users u ON u.id = c.contact_user_id
                    WHERE c.owner_id = %s
                    ORDER BY c.name
                """, (user["id"],))
                rows = cur.fetchall()
            contacts = [{"id": r[0], "name": r[1], "phone": r[2], "user_id": r[3], "status": r[4], "avatar_url": r[5]} for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"contacts": contacts})}

        # POST /contacts/add
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
            status = None; avatar_url = None
            if contact_user_id:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT status, avatar_url FROM {SCHEMA}.users WHERE id = %s", (contact_user_id,))
                    r = cur.fetchone()
                    if r: status, avatar_url = r
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"contact": {"id": contact_id, "name": name, "phone": phone, "user_id": contact_user_id, "status": status, "avatar_url": avatar_url}})}

        # POST /contacts/sync
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
                    if not name or not phone: continue
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

        # POST /contacts/remove
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
                cur.execute(f"UPDATE {SCHEMA}.contacts SET name = '[удалён]', phone = '' WHERE id = %s AND owner_id = %s", (contact_id, user["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # POST /block — заблокировать пользователя
        if method == "POST" and path.endswith("/block"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            target_id = body.get("user_id")
            if not target_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "user_id обязателен"})}
            if target_id == user["id"]:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нельзя заблокировать себя"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.blocked_users (blocker_id, blocked_id)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                """, (user["id"], target_id))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "blocked": True})}

        # POST /unblock — разблокировать пользователя
        if method == "POST" and path.endswith("/unblock"):
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            body = json.loads(event.get("body") or "{}")
            target_id = body.get("user_id")
            if not target_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "user_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE {SCHEMA}.blocked_users SET is_active = FALSE
                    WHERE blocker_id = %s AND blocked_id = %s
                """, (user["id"], target_id))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "blocked": False})}

        # GET /blocked-list — список заблокированных
        if method == "GET" and "blocked-list" in path:
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT u.id, u.name, u.phone, u.avatar_url, bu.created_at
                    FROM {SCHEMA}.blocked_users bu
                    JOIN {SCHEMA}.users u ON u.id = bu.blocked_id
                    WHERE bu.blocker_id = %s AND bu.is_active = TRUE
                    ORDER BY bu.created_at DESC
                """, (user["id"],))
                rows = cur.fetchall()
            blocked = [{"id": r[0], "name": r[1], "phone": r[2], "avatar_url": r[3],
                        "blocked_at": str(r[4]) if r[4] else None} for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"blocked": blocked})}

        # GET /block-status?user_id=X — проверить статус блокировки
        if method == "GET" and "block-status" in path:
            if not token:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            user = get_user_by_token(conn, token)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия истекла"})}
            params = event.get("queryStringParameters") or {}
            target_id = params.get("user_id")
            if not target_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "user_id обязателен"})}
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM {SCHEMA}.blocked_users
                    WHERE blocker_id = %s AND blocked_id = %s AND is_active = TRUE
                """, (user["id"], int(target_id)))
                i_blocked = cur.fetchone()[0] > 0
                cur.execute(f"""
                    SELECT COUNT(*) FROM {SCHEMA}.blocked_users
                    WHERE blocker_id = %s AND blocked_id = %s AND is_active = TRUE
                """, (int(target_id), user["id"]))
                blocked_me = cur.fetchone()[0] > 0
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "i_blocked": i_blocked,
                "blocked_me": blocked_me,
            })}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
    finally:
        conn.close()