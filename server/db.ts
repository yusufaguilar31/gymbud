import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

let resolvedDataDir: string | null = null;
let usingEphemeralTmp = false;

export function getDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const preferredDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : isServerless
      ? path.join(os.tmpdir(), 'gymbud-data')
      : path.resolve(process.cwd(), 'data');

  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    fs.accessSync(preferredDir, fs.constants.W_OK);
    resolvedDataDir = preferredDir;
    usingEphemeralTmp = isServerless && !process.env.DATA_DIR;
    return resolvedDataDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), 'gymbud-data');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    resolvedDataDir = tmpDir;
    usingEphemeralTmp = true;
    return resolvedDataDir;
  }
}

const dbPath = path.join(getDataDir(), 'gymbud.db');
export const db = new Database(dbPath);

db.pragma(`journal_mode = ${usingEphemeralTmp ? 'DELETE' : 'WAL'}`);
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gyms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      category TEXT NOT NULL,
      latitude_approx REAL NOT NULL,
      longitude_approx REAL NOT NULL,
      verified_partner INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
      account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned', 'deleted')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      selfie_verified INTEGER NOT NULL DEFAULT 0,
      email_code TEXT,
      phone_code TEXT,
      duplicate_fingerprint TEXT,
      suspicious_score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      age INTEGER NOT NULL CHECK (age >= 18 AND age <= 100),
      gender TEXT NOT NULL DEFAULT 'Prefer not to say',
      bio TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT 'Abu Dhabi',
      country TEXT NOT NULL DEFAULT 'UAE',
      gym_id TEXT REFERENCES gyms(id) ON DELETE SET NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      additional_photos_json TEXT NOT NULL DEFAULT '[]',
      experience_level TEXT NOT NULL DEFAULT 'Intermediate',
      privacy_hide_gym INTEGER NOT NULL DEFAULT 0,
      privacy_hide_distance INTEGER NOT NULL DEFAULT 0,
      privacy_hide_schedule INTEGER NOT NULL DEFAULT 0,
      privacy_discoverable INTEGER NOT NULL DEFAULT 1,
      privacy_show_online INTEGER NOT NULL DEFAULT 1,
      privacy_read_receipts INTEGER NOT NULL DEFAULT 1,
      privacy_profile_visits INTEGER NOT NULL DEFAULT 1,
      profile_theme TEXT NOT NULL DEFAULT 'obsidian',
      custom_badge TEXT,
      boost_expires_at TEXT,
      travel_city TEXT,
      travel_country TEXT,
      onboarding_completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fitness_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      goals_json TEXT NOT NULL DEFAULT '[]',
      muscle_groups_json TEXT NOT NULL DEFAULT '[]',
      favorite_exercises_json TEXT NOT NULL DEFAULT '[]',
      workout_split TEXT NOT NULL DEFAULT 'Push / Pull / Legs',
      training_frequency INTEGER NOT NULL DEFAULT 4,
      training_days_json TEXT NOT NULL DEFAULT '["Mon","Wed","Fri","Sat"]',
      training_times_json TEXT NOT NULL DEFAULT '["7:00 PM"]',
      time_of_day TEXT NOT NULL DEFAULT 'Evening',
      gym_environment TEXT NOT NULL DEFAULT 'Strength & Barbell Club',
      partner_preference TEXT NOT NULL DEFAULT 'Training Partner'
    );

    CREATE TABLE IF NOT EXISTS workout_dna (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      favorite_day TEXT NOT NULL,
      weight_vs_reps TEXT NOT NULL,
      solo_vs_partner TEXT NOT NULL,
      morning_vs_evening TEXT NOT NULL,
      music_habit TEXT NOT NULL,
      strength_vs_aesthetics TEXT NOT NULL,
      structured_vs_spontaneous TEXT NOT NULL,
      seriousness TEXT NOT NULL,
      archetype TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      decision TEXT NOT NULL CHECK (decision IN ('like', 'pass')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_user_id, to_user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      compatibility_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unmatched')),
      unmatched_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_a_id, user_b_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
      last_message_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'routine', 'session_invite')),
      metadata_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Milestone',
      routine_json TEXT,
      image_url TEXT,
      moderation_status TEXT NOT NULL DEFAULT 'published' CHECK (moderation_status IN ('published', 'flagged', 'removed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_reactions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL DEFAULT 'respect',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'message', 'post', 'photo')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
      resolution_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS verification_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      verification_type TEXT NOT NULL CHECK (verification_type IN ('email', 'phone', 'selfie')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      artifact_ref TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by TEXT REFERENCES users(id),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL CHECK (plan_id IN ('gymbud_plus_monthly', 'gymbud_plus_annual')),
      status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'expired')),
      provider TEXT NOT NULL DEFAULT 'stripe_tokenized',
      provider_subscription_id TEXT,
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
      amount_aed INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AED',
      status TEXT NOT NULL CHECK (status IN ('succeeded', 'pending', 'refunded', 'failed')),
      provider TEXT NOT NULL,
      provider_payment_intent_id TEXT UNIQUE,
      idempotency_key TEXT UNIQUE,
      receipt_number TEXT NOT NULL UNIQUE,
      card_brand TEXT,
      card_last4 TEXT,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body_safe TEXT NOT NULL,
      link_view TEXT NOT NULL DEFAULT 'discover',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      matches INTEGER NOT NULL DEFAULT 1,
      likes INTEGER NOT NULL DEFAULT 1,
      messages INTEGER NOT NULL DEFAULT 1,
      meetups INTEGER NOT NULL DEFAULT 1,
      billing INTEGER NOT NULL DEFAULT 1,
      security INTEGER NOT NULL DEFAULT 1,
      preview_message_content INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meetups (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gym_id TEXT NOT NULL REFERENCES gyms(id),
      scheduled_for TEXT NOT NULL,
      trusted_contact_name TEXT,
      trusted_contact_phone TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'checked_in', 'checked_out', 'cancelled')),
      checked_in_at TEXT,
      checked_out_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_visits (
      id TEXT PRIMARY KEY,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_roles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role_name TEXT NOT NULL,
      granted_by TEXT,
      granted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plus_waitlist (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferred_plan TEXT NOT NULL DEFAULT 'gymbud_plus_annual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_city ON profiles(city, country);
    CREATE INDEX IF NOT EXISTS idx_profiles_gym ON profiles(gym_id);
    CREATE INDEX IF NOT EXISTS idx_likes_to_user ON likes(to_user_id, decision);
    CREATE INDEX IF NOT EXISTS idx_likes_from_user ON likes(from_user_id, decision);
    CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a_id, user_b_id, status);
    CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);
    CREATE INDEX IF NOT EXISTS idx_blocked_pair ON blocked_users(blocker_id, blocked_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_visits_viewed ON profile_visits(viewed_id, visited_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, used_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token_hash);
  `);
}
