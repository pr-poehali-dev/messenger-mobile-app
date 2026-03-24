"""Загрузка файлов в S3 через base64"""
import json
import os
import base64
import uuid
import re
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
            SELECT u.id FROM {SCHEMA}.sessions s
            JOIN {SCHEMA}.users u ON u.id = s.user_id
            WHERE s.token = '{token.replace("'", "")}' AND s.expires_at > NOW()
        """)
        row = cur.fetchone()
        return {"id": row[0]} if row else None

def handler(event: dict, context) -> dict:
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    headers = event.get("headers") or {}
    token = (headers.get("X-Auth-Token") or headers.get("x-auth-token") or "").strip()

    body_raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body_raw = base64.b64decode(body_raw).decode("utf-8", errors="replace")

    print(f"[UPLOAD] body_len={len(body_raw)} isB64={event.get('isBase64Encoded')} token={'ok' if token else 'MISSING'}")

    try:
        body = json.loads(body_raw)
    except Exception as e:
        print(f"[UPLOAD] JSON parse error: {e}")
        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Некорректный JSON"})}

    conn = get_conn()
    try:
        user = auth_user(conn, token)
        if not user:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

        file_b64 = body.get("file") or body.get("file_data") or ""
        file_name = (body.get("file_name") or "file").strip()[:255]
        file_type = (body.get("file_type") or "application/octet-stream").strip()[:100]

        print(f"[UPLOAD] file_name={file_name} file_type={file_type} b64_len={len(file_b64)}")

        if not file_b64:
            return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "file required"})}

        if "," in file_b64:
            file_b64 = file_b64.split(",", 1)[1]

        try:
            file_data = base64.b64decode(file_b64)
        except Exception as e:
            print(f"[UPLOAD] base64 decode error: {e}")
            return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Некорректный файл: {e}"})}

        ALLOWED_MIME = {
            "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
            "image/webp": ".webp", "image/heic": ".heic", "image/jpg": ".jpg",
            "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
            "video/x-msvideo": ".avi", "video/mpeg": ".mpeg",
            "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
            "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/aac": ".aac",
            "audio/webm;codecs=opus": ".webm", "audio/x-m4a": ".m4a",
            "application/pdf": ".pdf",
            "application/zip": ".zip", "application/x-zip-compressed": ".zip",
            "application/msword": ".doc",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            "application/vnd.ms-excel": ".xls",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
            "text/plain": ".txt",
        }
        file_type_base = file_type.split(";")[0].strip()
        resolved_type = file_type if file_type in ALLOWED_MIME else file_type_base
        if resolved_type not in ALLOWED_MIME:
            print(f"[UPLOAD] MIME not allowed: {file_type}")
            return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Тип файла не разрешён: {file_type}"})}

        file_size = len(file_data)
        if file_size > 50 * 1024 * 1024:
            return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Файл слишком большой (макс. 50 МБ)"})}

        ext = ALLOWED_MIME.get(resolved_type, ".bin")
        key = f"chat-files/{uuid.uuid4().hex}{ext}"
        safe_display = re.sub(r'[^\w.\-\s]', '_', file_name)[:100] or "file"

        print(f"[UPLOAD] uploading to S3: key={key} size={file_size} type={resolved_type}")
        s3 = boto3.client(
            "s3",
            endpoint_url="https://bucket.poehali.dev",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        )
        s3.put_object(Bucket="files", Key=key, Body=file_data, ContentType=resolved_type)

        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
        print(f"[UPLOAD] OK cdn_url={cdn_url}")

        return {
            "statusCode": 200, "headers": cors,
            "body": json.dumps({
                "file_url": cdn_url,
                "file_name": safe_display,
                "file_size": file_size,
                "file_type": resolved_type,
            })
        }
    finally:
        conn.close()
