CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.verification_codes (
    id SERIAL PRIMARY KEY,
    contact TEXT NOT NULL,
    contact_type TEXT NOT NULL CHECK (contact_type IN ('phone', 'email')),
    code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'register' CHECK (purpose IN ('register', 'login')),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_contact ON t_p22534578_messenger_mobile_app.verification_codes(contact, contact_type);

ALTER TABLE t_p22534578_messenger_mobile_app.users
ADD COLUMN IF NOT EXISTS email TEXT NULL,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON t_p22534578_messenger_mobile_app.users(email) WHERE email IS NOT NULL;
