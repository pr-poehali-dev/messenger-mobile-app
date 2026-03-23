ALTER TABLE t_p22534578_messenger_mobile_app.blocked_users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;