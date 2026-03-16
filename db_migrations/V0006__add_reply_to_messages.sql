ALTER TABLE t_p22534578_messenger_mobile_app.messages
  ADD COLUMN IF NOT EXISTS reply_to_id INTEGER NULL REFERENCES t_p22534578_messenger_mobile_app.messages(id),
  ADD COLUMN IF NOT EXISTS reply_to_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS reply_to_name TEXT NULL;