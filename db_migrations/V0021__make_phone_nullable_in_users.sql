ALTER TABLE t_p22534578_messenger_mobile_app.users ALTER COLUMN phone SET DEFAULT NULL;
UPDATE t_p22534578_messenger_mobile_app.users SET phone = NULL WHERE phone = '';
ALTER TABLE t_p22534578_messenger_mobile_app.users ALTER COLUMN phone TYPE text USING NULLIF(phone, '');