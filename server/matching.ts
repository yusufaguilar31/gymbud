import { db } from './db.ts';
import type {
  CompatibilityDimension,
  CompatibilityResult,
  CurrentUser,
  FitnessPreferences,
  PublicProfileCard,
  SubscriptionRecord,
  WorkoutDna,
  WorkoutDnaArchetype,
} from '../src/shared/types.ts';

export function classifyWorkoutDna(dna: Omit<WorkoutDna, 'archetype' | 'completed_at'>): WorkoutDnaArchetype {
  if (dna.seriousness === 'starting_out') return 'The Beginner';
  if (dna.strength_vs_aesthetics === 'strength' && dna.weight_vs_reps === 'heavy_weights') {
    return 'The Heavy Lifter';
  }
  if (dna.strength_vs_aesthetics === 'aesthetics' || dna.weight_vs_reps === 'high_reps') {
    return 'The Hypertrophy Addict';
  }
  if (dna.favorite_day === 'Conditioning') {
    return 'The Cardio Machine';
  }
  if (dna.strength_vs_aesthetics === 'performance') {
    return 'The Athlete';
  }
  if (dna.structured_vs_spontaneous === 'structured' && dna.seriousness === 'dedicated') {
    return 'The Consistency King';
  }
  return 'The Fitness Enthusiast';
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function overlapCount(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => setB.has(x.toLowerCase()));
}

function approxKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Round to nearest integer km so exact location is never leaked
  return Math.max(1, Math.round(R * c));
}

export function calculateCompatibility(
  viewer: {
    gym_id: string | null;
    experience_level: string;
    preferences: FitnessPreferences;
    workout_dna: WorkoutDna | null;
  },
  candidate: {
    gym_id: string | null;
    gym_name: string | null;
    privacy_hide_gym: boolean;
    privacy_hide_schedule: boolean;
    experience_level: string;
    preferences: FitnessPreferences;
    workout_dna: WorkoutDna | null;
  },
  includeBreakdown = false
): CompatibilityResult {
  const reasons: string[] = [];

  // 1. Fitness Goals (25 pts)
  const sharedGoals = overlapCount(viewer.preferences.goals, candidate.preferences.goals);
  const goalUnion = new Set([...viewer.preferences.goals, ...candidate.preferences.goals]).size || 1;
  const goalScore = Math.min(25, Math.round((sharedGoals.length / Math.min(3, goalUnion)) * 25));
  if (sharedGoals.length > 0) {
    reasons.push(`Both focus on ${sharedGoals.slice(0, 2).join(' and ').toLowerCase()}`);
  }

  // 2. Muscle Groups & Favorite Exercises (20 pts)
  const sharedMuscles = overlapCount(viewer.preferences.muscle_groups, candidate.preferences.muscle_groups);
  const sharedExercises = overlapCount(viewer.preferences.favorite_exercises, candidate.preferences.favorite_exercises);
  const muscleRatio = sharedMuscles.length / Math.max(1, Math.min(3, viewer.preferences.muscle_groups.length || 1));
  const exerciseRatio = sharedExercises.length / Math.max(1, Math.min(3, viewer.preferences.favorite_exercises.length || 1));
  const trainingFocusScore = Math.min(20, Math.round(muscleRatio * 10 + exerciseRatio * 10));
  if (sharedMuscles.length > 0) {
    reasons.push(`Both enjoy ${sharedMuscles.slice(0, 2).join(' and ').toLowerCase()} workouts`);
  }
  if (sharedExercises.length > 0) {
    reasons.push(`Shared favorite lift: ${sharedExercises[0]}`);
  }

  // 3. Schedule & Training Times (20 pts)
  const sharedDays = overlapCount(viewer.preferences.training_days, candidate.preferences.training_days);
  const sharedTimes = overlapCount(viewer.preferences.training_times, candidate.preferences.training_times);
  const sameTimeOfDay =
    viewer.preferences.time_of_day === candidate.preferences.time_of_day ||
    viewer.preferences.time_of_day === 'Flexible' ||
    candidate.preferences.time_of_day === 'Flexible';
  let scheduleScore = 0;
  scheduleScore += Math.min(8, Math.round((sharedDays.length / Math.max(1, Math.min(4, viewer.preferences.training_days.length || 1))) * 8));
  scheduleScore += sharedTimes.length > 0 ? 7 : sameTimeOfDay ? 5 : 0;
  scheduleScore += Math.abs(viewer.preferences.training_frequency - candidate.preferences.training_frequency) <= 1 ? 5 : 2;
  scheduleScore = Math.min(20, scheduleScore);

  if (!candidate.privacy_hide_schedule) {
    if (sharedTimes.length > 0) {
      reasons.push(`Both train around ${sharedTimes[0]}`);
    } else if (sameTimeOfDay && candidate.preferences.time_of_day !== 'Flexible') {
      reasons.push(`Both prefer ${candidate.preferences.time_of_day.toLowerCase()} sessions`);
    }
  } else if (sameTimeOfDay) {
    reasons.push('Compatible weekly training rhythm');
  }

  // 4. Preferred Gym & Environment (15 pts)
  let gymScore = 0;
  if (viewer.gym_id && candidate.gym_id && viewer.gym_id === candidate.gym_id) {
    gymScore = 15;
    if (!candidate.privacy_hide_gym && candidate.gym_name) {
      reasons.push(`Both attend ${candidate.gym_name}`);
    } else {
      reasons.push('Same preferred training location');
    }
  } else if (viewer.preferences.gym_environment === candidate.preferences.gym_environment) {
    gymScore = 8;
    reasons.push(`Both prefer a ${candidate.preferences.gym_environment.toLowerCase()}`);
  } else {
    gymScore = 3;
  }

  // 5. Experience Level & Split (10 pts)
  const expOrder = ['Beginner', 'Intermediate', 'Advanced', 'Competitive'];
  const expDiff = Math.abs(expOrder.indexOf(viewer.experience_level) - expOrder.indexOf(candidate.experience_level));
  let expScore = expDiff === 0 ? 6 : expDiff === 1 ? 4 : 1;
  if (viewer.preferences.workout_split === candidate.preferences.workout_split) {
    expScore += 4;
    reasons.push(`Same split: ${candidate.preferences.workout_split}`);
  } else if (expDiff === 0) {
    reasons.push(`Matched ${candidate.experience_level.toLowerCase()} experience level`);
  }

  // 6. Workout DNA Alignment (10 pts)
  let dnaScore = 4; // neutral baseline if one hasn't completed DNA yet
  if (viewer.workout_dna && candidate.workout_dna) {
    let matches = 0;
    if (viewer.workout_dna.weight_vs_reps === candidate.workout_dna.weight_vs_reps) matches += 1;
    if (viewer.workout_dna.solo_vs_partner === candidate.workout_dna.solo_vs_partner) matches += 1;
    if (viewer.workout_dna.strength_vs_aesthetics === candidate.workout_dna.strength_vs_aesthetics) matches += 1;
    if (viewer.workout_dna.structured_vs_spontaneous === candidate.workout_dna.structured_vs_spontaneous) matches += 1;
    if (viewer.workout_dna.seriousness === candidate.workout_dna.seriousness) matches += 1;
    dnaScore = Math.min(10, matches * 2);
    if (viewer.workout_dna.archetype === candidate.workout_dna.archetype) {
      reasons.push(`Shared Workout DNA: ${candidate.workout_dna.archetype}`);
    } else if (matches >= 3) {
      reasons.push('Highly aligned training mindset');
    }
  }

  const totalScore = Math.max(12, Math.min(99, goalScore + trainingFocusScore + scheduleScore + gymScore + expScore + dnaScore));

  if (reasons.length === 0) {
    reasons.push('Complementary training styles and availability');
  }

  const dimensions: CompatibilityDimension[] | undefined = includeBreakdown
    ? [
        { key: 'goals', label: 'Fitness Goals', score: goalScore, maxScore: 25, detail: `${sharedGoals.length} shared goal(s)` },
        { key: 'focus', label: 'Exercises & Muscles', score: trainingFocusScore, maxScore: 20, detail: `${sharedMuscles.length} muscle groups · ${sharedExercises.length} lifts` },
        { key: 'schedule', label: 'Schedule & Timing', score: scheduleScore, maxScore: 20, detail: `${sharedDays.length} overlapping days` },
        { key: 'gym', label: 'Gym & Environment', score: gymScore, maxScore: 15, detail: viewer.gym_id === candidate.gym_id ? 'Same gym' : candidate.preferences.gym_environment },
        { key: 'experience', label: 'Experience & Split', score: expScore, maxScore: 10, detail: `${candidate.experience_level} · ${candidate.preferences.workout_split}` },
        { key: 'dna', label: 'Workout DNA', score: dnaScore, maxScore: 10, detail: candidate.workout_dna?.archetype || 'Not completed yet' },
      ]
    : undefined;

  return {
    score: totalScore,
    reasons: reasons.slice(0, 4),
    dimensions,
  };
}

export function getFullCurrentUser(userId: string): CurrentUser | null {
  const row = db
    .prepare(
      `SELECT u.*, p.*, g.name AS gym_name,
              fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
              fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
              fp.gym_environment, fp.partner_preference,
              wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
              wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness,
              wd.archetype, wd.completed_at
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN gyms g ON g.id = p.gym_id
       LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
       LEFT JOIN workout_dna wd ON wd.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as Record<string, any> | undefined;

  if (!row) return null;

  const subRow = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'cancelled')
         AND datetime(current_period_end) > datetime('now')
       ORDER BY datetime(created_at) DESC
       LIMIT 1`
    )
    .get(userId) as Record<string, any> | undefined;

  const subscription: SubscriptionRecord | null = subRow
    ? {
        id: subRow.id,
        plan_id: subRow.plan_id,
        status: subRow.status,
        provider: subRow.provider,
        current_period_start: subRow.current_period_start,
        current_period_end: subRow.current_period_end,
        cancel_at_period_end: Boolean(subRow.cancel_at_period_end),
        created_at: subRow.created_at,
      }
    : null;

  const emailVerified = Boolean(row.email_verified);
  const phoneVerified = Boolean(row.phone_verified);
  const selfieVerified = Boolean(row.selfie_verified);

  return {
    id: row.id,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    account_status: row.account_status,
    email_verified: emailVerified,
    phone_verified: phoneVerified,
    selfie_verified: selfieVerified,
    verified: emailVerified && phoneVerified,
    display_name: row.display_name,
    age: row.age,
    gender: row.gender,
    bio: row.bio,
    city: row.city,
    country: row.country,
    gym_id: row.gym_id,
    gym_name: row.gym_name || null,
    avatar_url: row.avatar_url,
    additional_photos: parseJsonArray(row.additional_photos_json),
    experience_level: row.experience_level,
    privacy: {
      hide_gym: Boolean(row.privacy_hide_gym),
      hide_distance: Boolean(row.privacy_hide_distance),
      hide_schedule: Boolean(row.privacy_hide_schedule),
      discoverable: Boolean(row.privacy_discoverable),
      show_online: Boolean(row.privacy_show_online),
      read_receipts: Boolean(row.privacy_read_receipts),
      profile_visits: Boolean(row.privacy_profile_visits),
    },
    profile_theme: row.profile_theme || 'obsidian',
    custom_badge: row.custom_badge || null,
    boost_expires_at: row.boost_expires_at || null,
    travel_city: row.travel_city || null,
    travel_country: row.travel_country || null,
    onboarding_completed: Boolean(row.onboarding_completed),
    is_plus: Boolean(subscription),
    subscription,
    preferences: {
      goals: parseJsonArray(row.goals_json),
      muscle_groups: parseJsonArray(row.muscle_groups_json),
      favorite_exercises: parseJsonArray(row.favorite_exercises_json),
      workout_split: row.workout_split || 'Push / Pull / Legs',
      training_frequency: row.training_frequency || 4,
      training_days: parseJsonArray(row.training_days_json),
      training_times: parseJsonArray(row.training_times_json),
      time_of_day: row.time_of_day || 'Evening',
      gym_environment: row.gym_environment || 'Strength & Barbell Club',
      partner_preference: row.partner_preference || 'Training Partner',
    },
    workout_dna: row.archetype
      ? {
          favorite_day: row.favorite_day,
          weight_vs_reps: row.weight_vs_reps,
          solo_vs_partner: row.solo_vs_partner,
          morning_vs_evening: row.morning_vs_evening,
          music_habit: row.music_habit,
          strength_vs_aesthetics: row.strength_vs_aesthetics,
          structured_vs_spontaneous: row.structured_vs_spontaneous,
          seriousness: row.seriousness,
          archetype: row.archetype,
          completed_at: row.completed_at,
        }
      : null,
  };
}

export function buildPublicProfileCard(
  viewer: CurrentUser,
  candidateRow: Record<string, any>,
  viewerGymCoords: { lat: number; lon: number } | null,
  likedMeSet?: Set<string>
): PublicProfileCard {
  const hideGym = Boolean(candidateRow.privacy_hide_gym);
  const hideDistance = Boolean(candidateRow.privacy_hide_distance);
  const hideSchedule = Boolean(candidateRow.privacy_hide_schedule);
  const showOnline = Boolean(candidateRow.privacy_show_online);

  const preferences: FitnessPreferences = {
    goals: parseJsonArray(candidateRow.goals_json),
    muscle_groups: parseJsonArray(candidateRow.muscle_groups_json),
    favorite_exercises: parseJsonArray(candidateRow.favorite_exercises_json),
    workout_split: candidateRow.workout_split || 'Push / Pull / Legs',
    training_frequency: candidateRow.training_frequency || 4,
    training_days: hideSchedule ? [] : parseJsonArray(candidateRow.training_days_json),
    training_times: hideSchedule ? [] : parseJsonArray(candidateRow.training_times_json),
    time_of_day: hideSchedule ? 'Flexible' : candidateRow.time_of_day || 'Evening',
    gym_environment: candidateRow.gym_environment || 'Strength & Barbell Club',
    partner_preference: candidateRow.partner_preference || 'Training Partner',
  };

  const workoutDna: WorkoutDna | null = candidateRow.archetype
    ? {
        favorite_day: candidateRow.favorite_day,
        weight_vs_reps: candidateRow.weight_vs_reps,
        solo_vs_partner: candidateRow.solo_vs_partner,
        morning_vs_evening: candidateRow.morning_vs_evening,
        music_habit: candidateRow.music_habit,
        strength_vs_aesthetics: candidateRow.strength_vs_aesthetics,
        structured_vs_spontaneous: candidateRow.structured_vs_spontaneous,
        seriousness: candidateRow.seriousness,
        archetype: candidateRow.archetype,
      }
    : null;

  // Use real full schedule for server-side compatibility calculation, even if exact times are masked in output
  const realPrefsForCalc: FitnessPreferences = {
    ...preferences,
    training_days: parseJsonArray(candidateRow.training_days_json),
    training_times: parseJsonArray(candidateRow.training_times_json),
    time_of_day: candidateRow.time_of_day || 'Evening',
  };

  const compatibility = calculateCompatibility(
    viewer,
    {
      gym_id: candidateRow.gym_id,
      gym_name: candidateRow.gym_name || null,
      privacy_hide_gym: hideGym,
      privacy_hide_schedule: hideSchedule,
      experience_level: candidateRow.experience_level,
      preferences: realPrefsForCalc,
      workout_dna: workoutDna,
    },
    viewer.is_plus
  );

  let distanceKm: number | null = null;
  if (!hideDistance && viewerGymCoords && candidateRow.latitude_approx && candidateRow.longitude_approx) {
    distanceKm = approxKm(
      viewerGymCoords.lat,
      viewerGymCoords.lon,
      candidateRow.latitude_approx,
      candidateRow.longitude_approx
    );
  }

  const lastActiveMs = candidateRow.last_active_at ? Date.parse(candidateRow.last_active_at + 'Z') : 0;
  const isRecentlyOnline = showOnline && Date.now() - lastActiveMs < 1000 * 60 * 15;
  const isBoosted = Boolean(
    candidateRow.boost_expires_at && Date.parse(candidateRow.boost_expires_at) > Date.now()
  );
  const emailVerified = Boolean(candidateRow.email_verified);
  const phoneVerified = Boolean(candidateRow.phone_verified);
  const selfieVerified = Boolean(candidateRow.selfie_verified);

  return {
    user_id: candidateRow.user_id,
    display_name: candidateRow.display_name,
    age: candidateRow.age,
    gender: candidateRow.gender,
    bio: candidateRow.bio,
    city: candidateRow.city,
    country: candidateRow.country,
    gym_id: hideGym ? null : candidateRow.gym_id,
    gym_name: hideGym ? null : candidateRow.gym_name || null,
    gym_area: hideGym ? null : candidateRow.gym_area || null,
    avatar_url: candidateRow.avatar_url,
    additional_photos: parseJsonArray(candidateRow.additional_photos_json),
    experience_level: candidateRow.experience_level,
    verified: emailVerified && phoneVerified,
    email_verified: emailVerified,
    phone_verified: phoneVerified,
    selfie_verified: selfieVerified,
    is_plus: Boolean(candidateRow.has_plus),
    profile_theme: candidateRow.profile_theme || 'obsidian',
    custom_badge: candidateRow.custom_badge || null,
    is_boosted: isBoosted,
    is_online: isRecentlyOnline,
    last_active_at: showOnline ? candidateRow.last_active_at : undefined,
    approx_distance_km: distanceKm,
    preferences,
    workout_dna: workoutDna,
    compatibility,
    liked_me: viewer.is_plus && likedMeSet ? likedMeSet.has(candidateRow.user_id) : undefined,
  };
}
