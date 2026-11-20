export type UserRole = 'member' | 'moderator' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'deleted';

export type ExperienceLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Competitive';
export type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Flexible';
export type GymEnvironment = 'Commercial Gym' | 'Strength & Barbell Club' | 'CrossFit / Functional Box' | 'Boutique Studio' | 'Outdoor & Calisthenics';
export type PartnerPreference = 'Training Partner' | 'Either Solo or Partner' | 'Occasional Spotter';

export type WorkoutDnaArchetype =
  | 'The Heavy Lifter'
  | 'The Hypertrophy Addict'
  | 'The Cardio Machine'
  | 'The Athlete'
  | 'The Consistency King'
  | 'The Beginner'
  | 'The Fitness Enthusiast';

export interface Gym {
  id: string;
  name: string;
  area: string;
  city: string;
  country: string;
  category: string;
  latitude_approx: number;
  longitude_approx: number;
  verified_partner: number;
}

export interface FitnessPreferences {
  goals: string[];
  muscle_groups: string[];
  favorite_exercises: string[];
  workout_split: string;
  training_frequency: number;
  training_days: string[];
  training_times: string[];
  time_of_day: TimeOfDay;
  gym_environment: GymEnvironment;
  partner_preference: PartnerPreference;
}

export interface WorkoutDna {
  favorite_day: string;
  weight_vs_reps: 'heavy_weights' | 'high_reps' | 'balanced';
  solo_vs_partner: 'partner' | 'alone' | 'depends';
  morning_vs_evening: 'morning' | 'evening' | 'afternoon';
  music_habit: 'always_headphones' | 'gym_playlist' | 'no_music';
  strength_vs_aesthetics: 'strength' | 'aesthetics' | 'performance';
  structured_vs_spontaneous: 'structured' | 'spontaneous' | 'hybrid';
  seriousness: 'competitive' | 'dedicated' | 'lifestyle' | 'starting_out';
  archetype: WorkoutDnaArchetype;
  completed_at?: string;
}

export interface PrivacySettings {
  hide_gym: boolean;
  hide_distance: boolean;
  hide_schedule: boolean;
  discoverable: boolean;
  show_online: boolean;
  read_receipts: boolean;
  profile_visits: boolean;
}

export interface CompatibilityDimension {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface CompatibilityResult {
  score: number;
  reasons: string[];
  dimensions?: CompatibilityDimension[];
}

export interface PublicProfileCard {
  user_id: string;
  display_name: string;
  age: number;
  gender: string;
  bio: string;
  city: string;
  country: string;
  gym_id: string | null;
  gym_name: string | null;
  gym_area: string | null;
  avatar_url: string;
  additional_photos: string[];
  experience_level: ExperienceLevel;
  verified: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  selfie_verified: boolean;
  is_plus: boolean;
  profile_theme: string;
  custom_badge: string | null;
  is_boosted: boolean;
  is_online?: boolean;
  last_active_at?: string;
  approx_distance_km?: number | null;
  preferences: FitnessPreferences;
  workout_dna: WorkoutDna | null;
  compatibility: CompatibilityResult;
  liked_me?: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  account_status: AccountStatus;
  email_verified: boolean;
  phone_verified: boolean;
  selfie_verified: boolean;
  verified: boolean;
  display_name: string;
  age: number;
  gender: string;
  bio: string;
  city: string;
  country: string;
  gym_id: string | null;
  gym_name: string | null;
  avatar_url: string;
  additional_photos: string[];
  experience_level: ExperienceLevel;
  privacy: PrivacySettings;
  profile_theme: string;
  custom_badge: string | null;
  boost_expires_at: string | null;
  travel_city: string | null;
  travel_country: string | null;
  onboarding_completed: boolean;
  is_plus: boolean;
  subscription: SubscriptionRecord | null;
  preferences: FitnessPreferences;
  workout_dna: WorkoutDna | null;
}

export interface MatchSummary {
  match_id: string;
  conversation_id: string;
  matched_at: string;
  compatibility_score: number;
  compatibility_reasons: string[];
  partner: PublicProfileCard;
  last_message: {
    id: string;
    content: string;
    message_type: string;
    sender_id: string;
    created_at: string;
    read_at: string | null;
  } | null;
  unread_count: number;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'routine' | 'session_invite';
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  user_id: string;
  author_name: string;
  author_avatar: string;
  author_verified: boolean;
  author_archetype: string | null;
  author_city: string;
  title: string;
  body: string;
  category: string;
  routine: {
    name: string;
    exercises: { name: string; sets: string; reps: string }[];
  } | null;
  image_url: string | null;
  reaction_count: number;
  user_reacted: boolean;
  comment_count: number;
  comments: {
    id: string;
    user_id: string;
    author_name: string;
    author_avatar: string;
    content: string;
    created_at: string;
  }[];
  created_at: string;
}

export interface MeetupSession {
  id: string;
  match_id: string;
  creator_id: string;
  partner_id: string;
  partner_name: string;
  gym_id: string;
  gym_name: string;
  gym_area: string;
  scheduled_for: string;
  trusted_contact_name: string | null;
  trusted_contact_phone: string | null;
  status: 'scheduled' | 'checked_in' | 'checked_out' | 'cancelled';
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_at: string;
}

export interface SubscriptionRecord {
  id: string;
  plan_id: 'gymbud_plus_monthly' | 'gymbud_plus_annual';
  status: 'active' | 'cancelled' | 'past_due' | 'expired';
  provider: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  subscription_id: string | null;
  amount_aed: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'refunded' | 'failed';
  provider: string;
  receipt_number: string;
  card_brand: string | null;
  card_last4: string | null;
  description: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body_safe: string;
  link_view: string;
  is_read: boolean;
  created_at: string;
}
