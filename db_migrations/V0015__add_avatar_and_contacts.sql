-- Add avatar_url to users
ALTER TABLE t_p22534578_messenger_mobile_app.users
ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

-- Contacts table (user's saved contacts with custom names)
CREATE TABLE IF NOT EXISTS t_p22534578_messenger_mobile_app.contacts (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
    contact_user_id INTEGER NULL REFERENCES t_p22534578_messenger_mobile_app.users(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(owner_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON t_p22534578_messenger_mobile_app.contacts(owner_id);
