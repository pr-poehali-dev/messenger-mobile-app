CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.calls (
  id SERIAL PRIMARY KEY,
  caller_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
  callee_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'ringing',
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP,
  ended_at TIMESTAMP,
  CONSTRAINT valid_status CHECK (status IN ('ringing','active','ended','declined','missed'))
);

CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.call_signals (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.calls(id),
  from_user_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
  signal_type VARCHAR(20) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_callee ON t_p22534578_messenger_mobile_app.calls(callee_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON t_p22534578_messenger_mobile_app.calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_signals_call ON t_p22534578_messenger_mobile_app.call_signals(call_id, id);
