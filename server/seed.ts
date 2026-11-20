import { db } from './db.ts';
import { hashPassword } from './auth.ts';
import { classifyWorkoutDna } from './matching.ts';
import { DEFAULT_COMMUNITY_GUIDELINES } from '../src/shared/constants.ts';

const OWNER_ADMIN_EMAIL = (process.env.ADMIN_OWNER_EMAIL || 'yusufaguilar2008@gmail.com').trim().toLowerCase();

const LEGACY_DEMO_USER_IDS = [
  'usr_admin_uae',
  'usr_tariq_ad',
  'usr_layla_ad',
  'usr_omar_corniche',
  'usr_noura_ad',
  'usr_kareem_dubai',
  'usr_maya_yas',
];

const LEGACY_DEMO_POST_IDS = ['post_reem_pr', 'post_yas_cond', 'post_corniche_sunrise'];

function removeDemoAccounts(): void {
  const placeholders = LEGACY_DEMO_USER_IDS.map(() => '?').join(', ');
  const postPlaceholders = LEGACY_DEMO_POST_IDS.map(() => '?').join(', ');

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM community_posts WHERE id IN (${postPlaceholders})`).run(...LEGACY_DEMO_POST_IDS);
    db.prepare(`DELETE FROM audit_logs WHERE actor_id IN (${placeholders})`).run(...LEGACY_DEMO_USER_IDS);
    db.prepare(`UPDATE reports SET resolved_by = NULL WHERE resolved_by IN (${placeholders})`).run(
      ...LEGACY_DEMO_USER_IDS
    );
    db.prepare(`UPDATE verification_records SET reviewed_by = NULL WHERE reviewed_by IN (${placeholders})`).run(
      ...LEGACY_DEMO_USER_IDS
    );
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...LEGACY_DEMO_USER_IDS);
  });
  tx();
}

export function ensureOwnerAdmin(): void {
  const existing = db
    .prepare(`SELECT id, role FROM users WHERE lower(email) = ?`)
    .get(OWNER_ADMIN_EMAIL) as { id: string; role: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE users
       SET role = 'admin', account_status = 'active', email_verified = 1, phone_verified = 1, selfie_verified = 1
       WHERE id = ?`
    ).run(existing.id);

    const hasAdminRole = db.prepare(`SELECT user_id FROM admin_roles WHERE user_id = ?`).get(existing.id);
    if (!hasAdminRole) {
      db.prepare(`INSERT INTO admin_roles (user_id, role_name, granted_by) VALUES (?, 'Owner Admin', 'system')`).run(
        existing.id
      );
    }
    return;
  }

  const userId = 'usr_owner_yusuf';
  const passwordHash = hashPassword('Gymbud2026!');
  const dna = {
    favorite_day: 'Chest & Push',
    weight_vs_reps: 'heavy_weights' as const,
    solo_vs_partner: 'partner' as const,
    morning_vs_evening: 'evening' as const,
    music_habit: 'always_headphones' as const,
    strength_vs_aesthetics: 'strength' as const,
    structured_vs_spontaneous: 'structured' as const,
    seriousness: 'dedicated' as const,
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, phone, password_hash, role, account_status, email_verified, phone_verified, selfie_verified)
       VALUES (?, ?, ?, ?, 'admin', 'active', 1, 1, 1)`
    ).run(userId, OWNER_ADMIN_EMAIL, '+971500000008', passwordHash);

    db.prepare(
      `INSERT INTO profiles (user_id, display_name, age, gender, bio, city, country, gym_id, avatar_url, experience_level, onboarding_completed)
       VALUES (?, 'Yusuf Aguilar', 24, 'Male', ?, 'Abu Dhabi', 'UAE', 'gym_train_reem', ?, 'Intermediate', 1)`
    ).run(
      userId,
      'Founder & Owner Admin of GYMBUD.',
      '/src/assets/images/athlete_portrait_male_1795131256981.jpg'
    );

    db.prepare(
      `INSERT INTO fitness_preferences
       (user_id, goals_json, muscle_groups_json, favorite_exercises_json, workout_split, training_frequency, training_days_json, training_times_json, time_of_day, gym_environment, partner_preference)
       VALUES (?, ?, ?, ?, 'Push / Pull / Legs', 4, ?, ?, 'Evening', 'Strength & Barbell Club', 'Training Partner')`
    ).run(
      userId,
      JSON.stringify(['Strength training', 'Muscle building', 'General fitness']),
      JSON.stringify(['Chest', 'Back', 'Shoulders']),
      JSON.stringify(['Bench Press', 'Deadlift', 'Pull-Ups']),
      JSON.stringify(['Mon', 'Tue', 'Thu', 'Sat']),
      JSON.stringify(['7:00 PM'])
    );

    db.prepare(
      `INSERT INTO workout_dna
       (user_id, favorite_day, weight_vs_reps, solo_vs_partner, morning_vs_evening, music_habit, strength_vs_aesthetics, structured_vs_spontaneous, seriousness, archetype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      dna.favorite_day,
      dna.weight_vs_reps,
      dna.solo_vs_partner,
      dna.morning_vs_evening,
      dna.music_habit,
      dna.strength_vs_aesthetics,
      dna.structured_vs_spontaneous,
      dna.seriousness,
      classifyWorkoutDna(dna)
    );

    db.prepare(`INSERT INTO notification_preferences (user_id) VALUES (?)`).run(userId);
    db.prepare(`INSERT INTO admin_roles (user_id, role_name, granted_by) VALUES (?, 'Owner Admin', 'system')`).run(
      userId
    );
  });
  tx();
}

export function seedInitialData(): void {
  const existingGyms = db.prepare(`SELECT COUNT(*) AS count FROM gyms`).get() as { count: number };
  if (existingGyms.count === 0) {
    const gyms = [
      ['gym_train_reem', 'Train Strength & Fitness', 'Al Reem Island', 'Abu Dhabi', 'UAE', 'Strength & Barbell Club', 24.4988, 54.4036],
      ['gym_ufc_nation', 'UFC Gym Abu Dhabi', 'Nation Towers, Corniche', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4631, 54.3274],
      ['gym_vogue_yas', 'Vogue Fitness / CrossFit Yas', 'Yas Marina', 'Abu Dhabi', 'UAE', 'CrossFit / Functional Box', 24.4672, 54.6091],
      ['gym_ff_admall', 'Fitness First Abu Dhabi Mall', 'Al Zahiyah', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4961, 54.3831],
      ['gym_gymnation_khalidiya', 'GymNation Khalidiya', 'Al Khalidiyah', 'Abu Dhabi', 'UAE', 'Commercial Gym', 24.4712, 54.3492],
      ['gym_corniche_calisthenics', 'Corniche Calisthenics Park', 'Abu Dhabi Corniche', 'Abu Dhabi', 'UAE', 'Outdoor & Calisthenics', 24.4765, 54.3418],
      ['gym_warehouse_alserkal', 'The Warehouse Gym Alserkal', 'Al Quoz', 'Dubai', 'UAE', 'Strength & Barbell Club', 25.1413, 55.2248],
      ['gym_primal_dubai', 'Primal Gym Dubai', 'Al Quoz 3', 'Dubai', 'UAE', 'CrossFit / Functional Box', 25.1345, 55.2192],
      ['gym_alain_athletic', 'Al Ain Athletic Club', 'Al Jimi', 'Al Ain', 'UAE', 'Strength & Barbell Club', 24.2423, 55.7285],
      ['gym_sharjah_iron', 'Sharjah Iron House', 'Al Majaz', 'Sharjah', 'UAE', 'Strength & Barbell Club', 25.3292, 55.3881],
      ['gym_london_thirdspace', 'Third Space Canary Wharf', 'Canary Wharf', 'London', 'UK', 'Boutique Studio', 51.5054, -0.0235],
      ['gym_riyadh_arena', 'Riyadh Strength Arena', 'Olaya District', 'Riyadh', 'Saudi Arabia', 'Strength & Barbell Club', 24.6937, 46.6853],
      ['gym_sg_virgin', 'Virgin Active Tanjong Pagar', 'Tanjong Pagar', 'Singapore', 'Singapore', 'Commercial Gym', 1.2768, 103.8458],
    ];
    const insertGym = db.prepare(
      `INSERT INTO gyms (id, name, area, city, country, category, latitude_approx, longitude_approx, verified_partner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    for (const g of gyms) {
      insertGym.run(...g);
    }
  }

  const existingGuidelines = db.prepare(`SELECT key FROM app_settings WHERE key = 'community_guidelines'`).get();
  if (!existingGuidelines) {
    db.prepare(`INSERT INTO app_settings (key, value_json) VALUES ('community_guidelines', ?)`).run(
      JSON.stringify(DEFAULT_COMMUNITY_GUIDELINES)
    );
  }

  // Remove any previously seeded fake/demo people & fake posts while preserving real accounts
  removeDemoAccounts();

  // Ensure the real Owner Admin account exists and has full admin access
  ensureOwnerAdmin();
}
