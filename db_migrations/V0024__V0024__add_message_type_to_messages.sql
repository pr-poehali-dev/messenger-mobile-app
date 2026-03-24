ALTER TABLE t_p22534578_messenger_mobile_app.messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(30) NOT NULL DEFAULT 'text';