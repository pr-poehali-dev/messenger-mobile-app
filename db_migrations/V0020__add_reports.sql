CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
    reported_user_id INTEGER REFERENCES t_p22534578_messenger_mobile_app.users(id),
    reported_message_id INTEGER REFERENCES t_p22534578_messenger_mobile_app.messages(id),
    reason VARCHAR(64) NOT NULL,
    comment TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON t_p22534578_messenger_mobile_app.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON t_p22534578_messenger_mobile_app.reports(reported_user_id);