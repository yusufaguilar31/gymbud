import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Dumbbell,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ASSETS } from '../lib/assets.ts';
import { api } from '../lib/api.ts';
import {
  EXPERIENCE_LEVELS,
  FITNESS_GOALS,
  TIMES_OF_DAY,
  WORKOUT_SPLITS,
} from '../shared/constants.ts';
import type { Gym, WorkoutDnaArchetype } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';

const LANDING_DNA_ARCHETYPES: {
  name: WorkoutDnaArchetype;
  summary: string;
  idealPartner: string;
  preferredSplit: string;
}[] = [
  {
    name: 'The Heavy Lifter',
    summary: 'Low-rep compound progressions, chalked barbells, and disciplined 3–4 minute rest intervals.',
    idealPartner: 'Needs a reliable, attentive spotter who understands RPE and bar speed.',
    preferredSplit: 'Upper / Lower · Powerlifting',
  },
  {
    name: 'The Hypertrophy Addict',
    summary: 'High-control eccentric tempo, drop sets, and balanced upper/lower muscular symmetry.',
    idealPartner: 'Trains best with someone locked into rep quality and forced negatives.',
    preferredSplit: 'Push / Pull / Legs · Bro Split',
  },
  {
    name: 'The Athlete',
    summary: 'Explosive power work, sled pushes, Olympic lifts, and functional conditioning blocks.',
    idealPartner: 'Thrives alongside competitive partners who push pace on circuits.',
    preferredSplit: 'Hybrid / Functional Conditioning',
  },
  {
    name: 'The Consistency King',
    summary: 'Never misses a scheduled session. Tracks every set, volume load, and recovery day.',
    idealPartner: 'Values punctuality, locked calendar windows, and long-term accountability.',
    preferredSplit: 'Upper / Lower · Push / Pull / Legs',
  },
  {
    name: 'The Cardio Machine',
    summary: 'Zone 2 endurance, Hyrox prep, erg intervals, and relentless aerobic output.',
    idealPartner: 'Pairs well with runners, hybrid athletes, and steady-pace finishers.',
    preferredSplit: 'Hybrid Conditioning · Full Body',
  },
  {
    name: 'The Beginner',
    summary: 'Building rock-solid movement patterns, gym floor confidence, and sustainable habits.',
    idealPartner: 'Benefits from patient, encouraging partners who enjoy teaching form.',
    preferredSplit: 'Full Body · 3x Weekly',
  },
  {
    name: 'The Fitness Enthusiast',
    summary: 'Balanced mix of strength, mobility, and camaraderie without ego lifting.',
    idealPartner: 'Matches easily with positive, adaptable training partners.',
    preferredSplit: 'Flexible · 3–5x Weekly',
  },
];

interface LandingPageProps {
  onGetStarted: (mode: 'register' | 'login') => void;
}

interface PublicPost {
  id: string;
  title: string;
  body: string;
  category: string;
  routine: { name: string; exercises: { name: string; sets: string; reps: string }[] } | null;
  image_url: string | null;
  author_name: string;
  author_city: string;
  author_archetype: string | null;
  reaction_count: number;
  created_at: string;
}

interface CompatibilityPreviewMatch {
  first_name: string;
  city: string;
  experience_level: string;
  verified: boolean;
  archetype: string;
  gym_name: string;
  time_of_day: string;
  goals: string[];
  score: number;
  reasons: string[];
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [stats, setStats] = useState({
    gyms_count: 13,
    active_members_count: 7,
    matches_count: 0,
    posts_count: 3,
  });
  const [guidelines, setGuidelines] = useState<string[]>([]);

  // Gym Explorer state
  const [gymSearch, setGymSearch] = useState('');
  const [gymCity, setGymCity] = useState('All');

  // Interactive Live Compatibility Calculator state
  const [calcGoal, setCalcGoal] = useState<string>('Strength training');
  const [calcGymId, setCalcGymId] = useState<string>('gym_train_reem');
  const [calcTime, setCalcTime] = useState<string>('Evening');
  const [calcExperience, setCalcExperience] = useState<string>('Intermediate');
  const [calcSplit, setCalcSplit] = useState<string>('Push / Pull / Legs');
  const [previewMatches, setPreviewMatches] = useState<CompatibilityPreviewMatch[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [selectedArchetype, setSelectedArchetype] = useState<WorkoutDnaArchetype>('The Heavy Lifter');

  useEffect(() => {
    let active = true;
    api<{
      stats: typeof stats;
      gyms: Gym[];
      posts: PublicPost[];
      safety_guidelines: string[];
    }>('/api/public/website-data')
      .then((res) => {
        if (!active) return;
        setStats(res.stats);
        setGyms(res.gyms);
        setPosts(res.posts);
        setGuidelines(res.safety_guidelines);
        if (res.gyms.length > 0 && !res.gyms.some((g) => g.id === calcGymId)) {
          setCalcGymId(res.gyms[0].id);
        }
      })
      .catch(() => {
        // Silent fallback if backend is restarting
      });
    return () => {
      active = false;
    };
  }, []);

  async function runCompatibilityPreview(
    goal = calcGoal,
    gymId = calcGymId,
    time = calcTime,
    exp = calcExperience,
    split = calcSplit
  ) {
    setCalculating(true);
    try {
      const res = await api<{ matches: CompatibilityPreviewMatch[] }>('/api/public/compatibility-preview', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          gym_id: gymId || null,
          time_of_day: time,
          experience_level: exp,
          workout_split: split,
        }),
      });
      setPreviewMatches(res.matches);
    } catch {
      // ignore transient error
    } finally {
      setCalculating(false);
      setPreviewLoaded(true);
    }
  }

  useEffect(() => {
    runCompatibilityPreview();
  }, []);

  const gymCities = useMemo(() => {
    const unique = Array.from(new Set(gyms.map((g) => g.city)));
    return ['All', ...unique];
  }, [gyms]);

  const filteredGyms = useMemo(() => {
    const q = gymSearch.trim().toLowerCase();
    return gyms.filter((g) => {
      const cityOk = gymCity === 'All' || g.city === gymCity;
      const queryOk =
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.area.toLowerCase().includes(q) ||
        g.city.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q);
      return cityOk && queryOk;
    });
  }, [gyms, gymCity, gymSearch]);

  return (
    <div className="min-h-screen bg-[#070809] text-zinc-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#070809]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            GYMBUD
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
            <a href="#compatibility" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Compatibility
            </a>
            <a href="#gyms" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Gyms
            </a>
            <a href="#community-preview" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Community
            </a>
            <a href="#safety" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Safety
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onGetStarted('register')}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#A3E635] text-[#070809] hover:bg-[#bef264] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Join Free
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="max-w-7xl mx-auto px-6 pt-12 pb-20 lg:pt-20 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-sm font-medium text-[#A3E635] tracking-wide mb-4">
              Abu Dhabi &amp; UAE Training Network
            </p>
            <h1
              className="font-display font-extrabold tracking-tight text-white text-balance leading-[0.98]"
              style={{ fontSize: 'clamp(2.75rem, 5vw, 4.5rem)' }}
            >
              Find your fit. Find your people.
            </h1>
            <p className="mt-6 text-base sm:text-lg text-zinc-400 leading-relaxed max-w-xl">
              Connect with verified gym partners who share your training split, favorite lifts,
              schedule, and home gym across Abu Dhabi, Dubai, and beyond. Unlimited likes,
              unlimited matches, and real compatibility scoring — always free.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onGetStarted('register')}
                className="min-h-[48px] px-6 py-3 rounded-lg bg-[#A3E635] text-[#070809] font-semibold text-sm flex items-center gap-2 hover:bg-[#bef264] transition-colors cursor-pointer whitespace-nowrap"
              >
                Create Free Account
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onGetStarted('login')}
                className="min-h-[48px] px-6 py-3 rounded-lg border border-white/15 text-zinc-100 font-medium text-sm hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
              >
                Sign In
              </button>
            </div>

            <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-3 gap-6 max-w-lg">
              <div>
                <div className="font-mono-num text-2xl font-semibold text-white">{stats.gyms_count}</div>
                <div className="text-xs text-zinc-400 mt-1">Partner gyms listed</div>
              </div>
              <div>
                <div className="font-mono-num text-2xl font-semibold text-white">{stats.active_members_count}</div>
                <div className="text-xs text-zinc-400 mt-1">Active verified profiles</div>
              </div>
              <div>
                <div className="font-mono-num text-2xl font-semibold text-white">Unlimited</div>
                <div className="text-xs text-zinc-400 mt-1">Free likes, swipes &amp; chats</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[340px] lg:min-h-[500px] rounded-2xl overflow-hidden border border-white/10 bg-[#101214]">
              <ResilientImage
                src={ASSETS.heroGym}
                alt="Luxury strength training facility in Abu Dhabi at twilight"
                className="w-full h-full object-cover"
                fallbackLabel="Abu Dhabi Strength Club"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#070809] via-[#070809]/25 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-[#A3E635] font-medium">Real Compatibility Calculation</p>
                  <p className="text-lg font-semibold text-white mt-1">
                    Al Reem Island · Yas Marina · Nation Towers · Dubai Alserkal
                  </p>
                </div>
                <div className="font-mono-num text-right shrink-0">
                  <div className="text-2xl font-bold text-[#A3E635]">6 Factors</div>
                  <div className="text-xs text-zinc-300">Goal, Split &amp; Gym Match</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Live Compatibility Preview */}
      <section id="compatibility" className="border-t border-white/10 bg-[#0B0D0F]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-medium text-[#A3E635] mb-2">Live Matching Engine</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Test your gym compatibility right now.
            </h2>
            <p className="mt-3 text-zinc-400 text-base">
              Pick your goal, preferred gym, and training window below to compute real compatibility
              scores against active discoverable athletes in our database.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Primary Goal</label>
                <select
                  value={calcGoal}
                  onChange={(e) => {
                    setCalcGoal(e.target.value);
                    runCompatibilityPreview(e.target.value, calcGymId, calcTime, calcExperience, calcSplit);
                  }}
                  className="w-full h-11 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                >
                  {FITNESS_GOALS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Preferred Gym</label>
                <select
                  value={calcGymId}
                  onChange={(e) => {
                    setCalcGymId(e.target.value);
                    runCompatibilityPreview(calcGoal, e.target.value, calcTime, calcExperience, calcSplit);
                  }}
                  className="w-full h-11 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                >
                  <option value="">Any Gym / Exploring</option>
                  {gyms.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} · {g.city}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Training Window</label>
                  <select
                    value={calcTime}
                    onChange={(e) => {
                      setCalcTime(e.target.value);
                      runCompatibilityPreview(calcGoal, calcGymId, e.target.value, calcExperience, calcSplit);
                    }}
                    className="w-full h-11 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                  >
                    {TIMES_OF_DAY.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Experience</label>
                  <select
                    value={calcExperience}
                    onChange={(e) => {
                      setCalcExperience(e.target.value);
                      runCompatibilityPreview(calcGoal, calcGymId, calcTime, e.target.value, calcSplit);
                    }}
                    className="w-full h-11 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                  >
                    {EXPERIENCE_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Workout Split</label>
                <select
                  value={calcSplit}
                  onChange={(e) => {
                    setCalcSplit(e.target.value);
                    runCompatibilityPreview(calcGoal, calcGymId, calcTime, calcExperience, e.target.value);
                  }}
                  className="w-full h-11 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                >
                  {WORKOUT_SPLITS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                disabled={calculating}
                onClick={() => runCompatibilityPreview()}
                className="w-full min-h-[44px] rounded-lg bg-[#A3E635] text-[#070809] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#bef264] transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                {calculating ? 'Calculating...' : 'Recalculate Compatibility'}
              </button>
            </div>

            <div className="lg:col-span-7 space-y-4">
              {previewMatches.length === 0 ? (
                <div className="border border-white/10 rounded-2xl bg-[#101214] p-8 space-y-3">
                  <div className="text-base font-semibold text-white">
                    {previewLoaded
                      ? 'Only real registered members appear here'
                      : 'Loading live compatibility calculations...'}
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {previewLoaded
                      ? 'GYMBUD does not display fake or bot profiles. As real athletes verify and join your gym, compatibility scores calculate automatically from their goals, split, and schedule.'
                      : 'Checking active profiles across partner gyms...'}
                  </p>
                  {previewLoaded && (
                    <button
                      type="button"
                      onClick={() => onGetStarted('register')}
                      className="px-4 py-2 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold hover:bg-[#bef264] cursor-pointer"
                    >
                      Be Among the First · Join Free
                    </button>
                  )}
                </div>
              ) : (
                previewMatches.map((m, idx) => (
                  <div
                    key={`${m.first_name}-${idx}`}
                    className="border border-white/10 rounded-2xl bg-[#101214] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-white">
                        <span>{m.first_name}</span>
                        {m.verified && <ShieldCheck className="w-4 h-4 text-[#A3E635]" />}
                        <span className="text-zinc-500 text-sm font-normal">· {m.city}</span>
                        <span className="text-zinc-500 text-sm font-normal">· {m.experience_level}</span>
                      </div>
                      <div className="text-xs text-zinc-400">
                        {m.gym_name} · {m.time_of_day} · {m.archetype}
                      </div>
                      <ul className="space-y-1 pt-1">
                        {m.reasons.map((r) => (
                          <li key={r} className="text-xs text-zinc-300 flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-[#A3E635] shrink-0" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-3">
                      <div>
                        <div className="font-mono-num text-3xl font-bold text-[#A3E635]">{m.score}%</div>
                        <div className="text-[11px] uppercase tracking-wider text-zinc-400">Compatibility</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onGetStarted('register')}
                        className="px-4 py-2 rounded-lg border border-white/15 text-xs font-semibold text-white hover:border-[#A3E635]/60 cursor-pointer whitespace-nowrap"
                      >
                        Connect Free
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Live Gym Directory Explorer */}
      <section id="gyms" className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[#A3E635] mb-2">Live Gym Directory</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Train across Abu Dhabi, Dubai &amp; global hubs.
              </h2>
              <p className="mt-2 text-zinc-400 text-base">
                Search verified barbell clubs, CrossFit boxes, commercial gyms, and outdoor calisthenics parks.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={gymSearch}
                  onChange={(e) => setGymSearch(e.target.value)}
                  placeholder="Search gym or area..."
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg bg-[#101214] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                />
              </div>
              <select
                value={gymCity}
                onChange={(e) => setGymCity(e.target.value)}
                className="h-11 px-3.5 rounded-lg bg-[#101214] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
              >
                {gymCities.map((c) => (
                  <option key={c} value={c}>{c === 'All' ? 'All Cities' : c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGyms.map((g) => (
              <div
                key={g.id}
                className="border border-white/10 rounded-xl p-5 bg-[#101214] flex flex-col justify-between gap-4 hover:border-white/25 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-white">{g.name}</h3>
                    <ShieldCheck className="w-4 h-4 text-[#A3E635] shrink-0 mt-0.5" />
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{g.area} · {g.city}, {g.country}</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-2">{g.category}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onGetStarted('register')}
                  className="text-left text-xs font-semibold text-[#A3E635] hover:underline cursor-pointer"
                >
                  Find partners at {g.name} →
                </button>
              </div>
            ))}
          </div>
          {filteredGyms.length === 0 && (
            <div className="border border-white/10 rounded-xl p-8 text-center text-sm text-zinc-400 bg-[#101214]">
              No gyms matched &ldquo;{gymSearch}&rdquo;. Try clearing your search filter.
            </div>
          )}
        </div>
      </section>

      {/* Workout DNA & Community Highlights */}
      <section id="community-preview" className="border-t border-white/10 bg-[#0B0D0F]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16">
            <div className="lg:col-span-6">
              <div className="aspect-[16/10] rounded-2xl overflow-hidden border border-white/10 bg-[#101214]">
                <ResilientImage
                  src={ASSETS.communitySession}
                  alt="Training partners spotting a heavy barbell squat"
                  className="w-full h-full object-cover"
                  fallbackLabel="Training Partners"
                />
              </div>
            </div>
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-[#A3E635] mb-3">Workout DNA</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight text-balance">
                Know how someone trains before sharing a barbell.
              </h2>
              <p className="mt-4 text-zinc-400 leading-relaxed">
                Complete an 8-question training personality assessment covering heavy compounds vs.
                high-rep volume, headphone discipline, morning vs. evening energy, and structured
                programming.
              </p>
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Workout DNA Archetypes">
                  {LANDING_DNA_ARCHETYPES.map((arch) => {
                    const active = selectedArchetype === arch.name;
                    return (
                      <button
                        key={arch.name}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setSelectedArchetype(arch.name)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#A3E635] text-[#070809] border-[#A3E635] font-semibold'
                            : 'bg-[#101214] text-zinc-300 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {arch.name}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const activeArch =
                    LANDING_DNA_ARCHETYPES.find((a) => a.name === selectedArchetype) || LANDING_DNA_ARCHETYPES[0];
                  return (
                    <div className="border border-white/10 rounded-xl p-5 bg-[#101214] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-display text-2xl font-bold text-white">{activeArch.name}</div>
                        <span className="text-xs font-mono-num text-[#A3E635]">{activeArch.preferredSplit}</span>
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed">{activeArch.summary}</p>
                      <p className="text-xs text-zinc-400 pt-1 border-t border-white/10">
                        <span className="text-zinc-300 font-medium">Partner match insight:</span> {activeArch.idealPartner}
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {posts.length > 0 && (
            <div>
              <div className="flex items-end justify-between gap-4 mb-6">
                <div>
                  <p className="text-sm font-medium text-[#A3E635]">Live Community Feed</p>
                  <h3 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1">
                    Recent sessions across the UAE
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onGetStarted('register')}
                  className="text-xs font-semibold text-[#A3E635] hover:underline cursor-pointer whitespace-nowrap"
                >
                  Join to post &amp; comment →
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {posts.slice(0, 3).map((post) => (
                  <article
                    key={post.id}
                    className="border border-white/10 rounded-xl p-5 bg-[#101214] flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs text-zinc-400">
                        {post.category} · {post.author_city} · {post.author_name}
                      </div>
                      <h4 className="text-base font-semibold text-white mt-2">{post.title}</h4>
                      <p className="text-sm text-zinc-400 mt-2 leading-relaxed line-clamp-3">{post.body}</p>
                      {post.routine && (
                        <div className="mt-3 pt-3 border-t border-white/10 text-xs text-zinc-300">
                          <span className="text-[#A3E635] font-medium">{post.routine.name}</span>
                          <span className="text-zinc-500"> · {post.routine.exercises.length} exercises</span>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 font-mono-num">
                      {post.reaction_count} likes
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Safety Center Section */}
      <section id="safety" className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            <div className="lg:col-span-5">
              <div className="inline-flex items-center gap-2 text-sm font-medium text-[#A3E635] mb-3">
                <ShieldCheck className="w-4 h-4" />
                <span>Safety First Architecture</span>
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Privacy and personal safety are never paywalled.
              </h2>
              <p className="mt-4 text-zinc-400 leading-relaxed">
                Every member receives full access to verification, instant blocking, reporting,
                and privacy controls from day one.
              </p>
              {guidelines.length > 0 && (
                <ul className="mt-6 space-y-2 text-xs text-zinc-400">
                  {guidelines.slice(0, 3).map((g) => (
                    <li key={g} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-[#A3E635] shrink-0 mt-0.5" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  title: 'No Exact Coordinates Shared',
                  desc: 'GYMBUD never exposes home addresses, live GPS, or automatic background tracking.',
                },
                {
                  title: 'Schedule & Gym Masking',
                  desc: 'Hide your preferred gym, approximate distance, or exact training times until you choose to share.',
                },
                {
                  title: 'Meet Safely Check-Ins',
                  desc: 'Propose public verified gyms, share an optional check-in with a trusted contact, and cancel anytime.',
                },
                {
                  title: 'Verified Badges Only',
                  desc: 'Badges appear only after genuine email, phone OTP, or moderator-reviewed selfie verification.',
                },
              ].map((item) => (
                <div key={item.title} className="border border-white/10 rounded-xl p-5 bg-[#101214]">
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Membership Comparison */}
      <section id="membership" className="border-t border-white/10 bg-[#0B0D0F]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Free for everyday training. GYMBUD+ coming soon.
            </h2>
            <p className="mt-3 text-zinc-400">
              Every core feature on GYMBUD is 100% free with unlimited swipes, matches, and messaging.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="border border-white/10 rounded-2xl p-8 bg-[#101214] flex flex-col justify-between">
              <div>
                <div className="text-sm font-medium text-zinc-400">For Every Athlete</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold text-white">0 AED</span>
                  <span className="text-sm text-zinc-400">forever</span>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-zinc-300">
                  {[
                    'Unlimited swipes, likes, and mutual matches',
                    'Unlimited real-time messaging with matches',
                    'Full Workout DNA assessment & compatibility score',
                    'Unlimited gym discovery & community posting',
                    'Complete Safety Center, blocking, and Meet Safely',
                  ].map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-[#A3E635] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => onGetStarted('register')}
                className="mt-8 w-full min-h-[44px] py-2.5 rounded-lg border border-white/15 text-sm font-semibold text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Start Free
              </button>
            </div>

            <div className="border border-[#A3E635]/40 rounded-2xl p-8 bg-[#101214] flex flex-col justify-between">
              <div>
                <div className="text-sm font-medium text-[#A3E635]">GYMBUD+ Membership · Coming Soon</div>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-display text-4xl font-bold text-white font-mono-num">49 AED</span>
                  <span className="text-sm text-zinc-400">/ month planned · or 390 AED / year</span>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-zinc-300">
                  {[
                    'See everyone who liked your profile and match back',
                    'Advanced exercise & schedule discovery filters',
                    '6-dimension compatibility breakdown scores',
                    'Travel Mode for Dubai, Riyadh, London & Singapore',
                    '60-minute Profile Boost, visit analytics & custom themes',
                  ].map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5">
                      <Zap className="w-4 h-4 text-[#A3E635] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-8 w-full min-h-[44px] py-2.5 px-4 rounded-lg border border-white/10 bg-[#070809] text-center text-sm font-medium text-zinc-400">
                Coming Soon
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <Dumbbell className="w-4 h-4 text-[#A3E635]" />
            <span className="font-semibold text-zinc-300">GYMBUD</span>
            <span aria-hidden="true">·</span>
            <span>Abu Dhabi &amp; UAE</span>
          </div>
          <div className="flex items-center gap-6">
            <span>18+ Verified Community</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onGetStarted('login')}
              className="text-zinc-300 hover:text-white cursor-pointer"
            >
              Member &amp; Admin Sign In
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
