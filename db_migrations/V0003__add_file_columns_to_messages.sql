ALTER TABLE t_p22534578_messenger_mobile_app.messages
  ADD COLUMN file_url   TEXT NULL,
  ADD COLUMN file_name  TEXT NULL,
  ADD COLUMN file_size  BIGINT NULL,
  ADD COLUMN file_type  TEXT NULL;

ALTER TABLE t_p22534578_messenger_mobile_app.messages
  ALTER COLUMN text SET DEFAULT '';