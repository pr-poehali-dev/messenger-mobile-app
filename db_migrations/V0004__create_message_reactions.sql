CREATE TABLE t_p22534578_messenger_mobile_app.message_reactions (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.messages(id),
  user_id    INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
  emoji      TEXT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);