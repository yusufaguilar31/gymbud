-- GYMBUD Supabase PostgreSQL Schema
-- Optional: run this in Supabase SQL Editor if you later connect full Postgres tables.

CREATE TABLE IF NOT EXISTS gyms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  category TEXT NOT NULL,
  latitude_approx DOUBLE PRECISION NOT NULL,
  longitude_approx DOUBLE PRECISION NOT NULL,
  verified_partner BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned', 'deleted')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  selfie_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18 AND age <= 99),
  gender TEXT NOT NULL DEFAULT 'Prefer not to say',
  bio TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Abu Dhabi',
  country TEXT NOT NULL DEFAULT 'UAE',
  gym_id TEXT REFERENCES gyms(id) ON DELETE SET NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  additional_photos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  experience_level TEXT NOT NULL DEFAULT 'Intermediate',
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO gyms (id, name, area, city, country, category, latitude_approx, longitude_approx, verified_partner) VALUES
  ('gym_train_reem', 'Train Strength & Fitness', 'Al Reem Island', 'Abu Dhabi', 'UAE', 'Strength & Barbell Club', 24.4988, 54.4036, TRUE),
  ('gym_ufc_nation', 'UFC Gym Abu Dhabi', 'Nation Towers, Corniche', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4631, 54.3274, TRUE),
  ('gym_vogue_yas', 'Vogue Fitness / CrossFit Yas', 'Yas Marina', 'Abu Dhabi', 'UAE', 'CrossFit / Functional Box', 24.4672, 54.6091, TRUE),
  ('gym_ff_admall', 'Fitness First Abu Dhabi Mall', 'Al Zahiyah', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4961, 54.3831, TRUE),
  ('gym_gymnation_khalidiya', 'GymNation Khalidiya', 'Al Khalidiyah', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4712, 54.3492, TRUE),
  ('gym_corniche_calisthenics', 'Corniche Calisthenics Park', 'Abu Dhabi Corniche', 'Abu Dhabi', 'UAE', 'Outdoor & Calisthenics', 24.4765, 54.3418, TRUE),
  ('gym_warehouse_alserkal', 'The Warehouse Gym Alserkal', 'Al Quoz', 'Dubai', 'UAE', 'Strength & Barbell Club', 25.1413, 55.2248, TRUE),
  ('gym_primal_dubai', 'Primal Gym Dubai', 'Al Quoz 3', 'Dubai', 'UAE', 'CrossFit / Functional Box', 25.1345, 55.2192, TRUE),
  ('gym_alain_athletic', 'Al Ain Athletic Club', 'Al Jimi', 'Al Ain', 'UAE', 'Strength & Barbell Club', 24.2423, 55.7285, TRUE),
  ('gym_sharjah_iron', 'Sharjah Iron House', 'Al Majaz', 'Sharjah', 'UAE', 'Strength & Barbell Club', 25.3292, 55.3881, TRUE),
  ('gym_london_thirdspace', 'Third Space Canary Wharf', 'Canary Wharf', 'London', 'UK', 'Boutique Studio', 51.5054, -0.0235, TRUE),
  ('gym_riyadh_arena', 'Riyadh Strength Arena', 'Olaya District', 'Riyadh', 'Saudi Arabia', 'Strength & Barbell Club', 24.6937, 46.6853, TRUE),
  ('gym_sg_virgin', 'Virgin Active Tanjong Pagar', 'Tanjong Pagar', 'Singapore', 'Singapore', 'Commercial Gym', 1.2768, 103.8458, TRUE)
ON CONFLICT (id) DO NOTHING;
