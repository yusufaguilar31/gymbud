export const FITNESS_GOALS = [
  'Muscle building',
  'Weight loss',
  'Strength training',
  'Bodybuilding',
  'Powerlifting',
  'General fitness',
  'Endurance',
  'Athletic performance',
  'Maintaining fitness',
] as const;

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Legs',
  'Glutes',
  'Arms',
  'Core',
  'Full Body',
] as const;

export const FAVORITE_EXERCISES = [
  'Bench Press',
  'Barbell Squat',
  'Deadlift',
  'Overhead Press',
  'Pull-Ups',
  'Romanian Deadlift',
  'Incline Dumbbell Press',
  'Barbell Row',
  'Kettlebell Swings',
  'Sled Push',
  'Box Jumps',
  'Running / Intervals',
  'Cycling',
  'Rowing Ergometer',
] as const;

export const WORKOUT_SPLITS = [
  'Push / Pull / Legs',
  'Upper / Lower',
  'Full Body',
  'Bro Split (Body Part)',
  'Powerlifting (SBD)',
  'Hybrid Functional + Strength',
  'Athletic Conditioning',
] as const;

export const TRAINING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const TRAINING_TIMES = [
  '5:30 AM',
  '7:00 AM',
  '9:00 AM',
  '12:30 PM',
  '4:00 PM',
  '6:00 PM',
  '7:00 PM',
  '8:30 PM',
  '9:30 PM',
] as const;

export const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Competitive'] as const;
export const TIMES_OF_DAY = ['Morning', 'Afternoon', 'Evening', 'Flexible'] as const;
export const GYM_ENVIRONMENTS = [
  'Commercial Gym',
  'Strength & Barbell Club',
  'CrossFit / Functional Box',
  'Boutique Studio',
  'Outdoor & Calisthenics',
] as const;
export const PARTNER_PREFERENCES = ['Training Partner', 'Either Solo or Partner', 'Occasional Spotter'] as const;

export const DISCOVERY_CITIES = [
  { city: 'Abu Dhabi', country: 'UAE' },
  { city: 'Dubai', country: 'UAE' },
  { city: 'Sharjah', country: 'UAE' },
  { city: 'Al Ain', country: 'UAE' },
  { city: 'Riyadh', country: 'Saudi Arabia' },
  { city: 'London', country: 'UK' },
  { city: 'Singapore', country: 'Singapore' },
] as const;

export const SUBSCRIPTION_PLANS = {
  gymbud_plus_monthly: {
    id: 'gymbud_plus_monthly' as const,
    name: 'GYMBUD+ Monthly',
    priceAed: 49,
    intervalLabel: 'month',
    renewalNote: 'Billed 49 AED monthly. Cancel anytime with one click.',
  },
  gymbud_plus_annual: {
    id: 'gymbud_plus_annual' as const,
    name: 'GYMBUD+ Annual',
    priceAed: 390,
    intervalLabel: 'year',
    renewalNote: 'Billed 390 AED annually (32.50 AED/mo equivalent — save 34%). Cancel anytime.',
  },
};

export const WORKOUT_DNA_QUESTIONS = [
  {
    key: 'favorite_day',
    question: "What's your favorite workout day?",
    options: [
      { value: 'Chest & Push', label: 'Chest & Push Day' },
      { value: 'Legs & Squat', label: 'Heavy Leg Day' },
      { value: 'Back & Pull', label: 'Back & Deadlift Day' },
      { value: 'Conditioning', label: 'Conditioning & Metcon' },
      { value: 'Full Body', label: 'Balanced Full Body' },
    ],
  },
  {
    key: 'weight_vs_reps',
    question: 'Do you prefer heavy weights or high repetitions?',
    options: [
      { value: 'heavy_weights', label: 'Heavy low-rep compound lifts (1–6 reps)' },
      { value: 'high_reps', label: 'High-rep hypertrophy & metabolic burn (10–15+ reps)' },
      { value: 'balanced', label: 'Periodized mix of heavy & volume work' },
    ],
  },
  {
    key: 'solo_vs_partner',
    question: 'Do you prefer training alone or with someone?',
    options: [
      { value: 'partner', label: 'Always better with a reliable partner & spotter' },
      { value: 'depends', label: 'Solo on focus days, partner for heavy compounds' },
      { value: 'alone', label: 'Mostly solo, occasional gym friend meetup' },
    ],
  },
  {
    key: 'morning_vs_evening',
    question: 'Are you a morning or evening gym person?',
    options: [
      { value: 'morning', label: 'Early morning crew before work' },
      { value: 'afternoon', label: 'Midday / afternoon session' },
      { value: 'evening', label: 'Evening iron hour after work' },
    ],
  },
  {
    key: 'music_habit',
    question: 'Do you listen to music while training?',
    options: [
      { value: 'always_headphones', label: 'Locked in with headphones between sets' },
      { value: 'gym_playlist', label: 'Open to chatting & gym floor energy' },
      { value: 'no_music', label: 'No music — pure breathing and focus' },
    ],
  },
  {
    key: 'strength_vs_aesthetics',
    question: 'Are you focused on strength or aesthetics?',
    options: [
      { value: 'strength', label: 'Raw strength numbers on the bar' },
      { value: 'aesthetics', label: 'Physique symmetry and muscle definition' },
      { value: 'performance', label: 'Athletic power, stamina, and movement' },
    ],
  },
  {
    key: 'structured_vs_spontaneous',
    question: 'Do you prefer structured programs or spontaneous workouts?',
    options: [
      { value: 'structured', label: 'Tracked spreadsheets & progressive overload' },
      { value: 'hybrid', label: 'Core progression with flexible accessories' },
      { value: 'spontaneous', label: 'Train by feel and daily energy' },
    ],
  },
  {
    key: 'seriousness',
    question: 'How serious are you about fitness?',
    options: [
      { value: 'competitive', label: 'Competitive / prep-level commitment' },
      { value: 'dedicated', label: '4–6x weekly non-negotiable habit' },
      { value: 'lifestyle', label: 'Consistent lifestyle & long-term health' },
      { value: 'starting_out', label: 'Building momentum and learning form' },
    ],
  },
] as const;

export const DEFAULT_COMMUNITY_GUIDELINES = [
  'Respect every member regardless of experience level, body type, or background.',
  'GYMBUD is for fitness connections, training partners, and workout motivation — unsolicited romantic or sexual harassment results in immediate suspension.',
  'Never share another member’s gym schedule, contact info, or photos outside the platform without consent.',
  'Meet in public gym spaces for first sessions and use Meet Safely check-ins when training with someone new.',
  'No impersonation, fake verification attempts, spam coaching pitches, or steroid/supplement solicitation.',
];
