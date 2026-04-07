ALTER TABLE t_p22534578_messenger_mobile_app.push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();