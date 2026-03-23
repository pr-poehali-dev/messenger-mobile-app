CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.blocked_users (
    id SERIAL PRIMARY KEY,
    blocker_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
    blocked_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON t_p22534578_messenger_mobile_app.blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON t_p22534578_messenger_mobile_app.blocked_users(blocked_id);