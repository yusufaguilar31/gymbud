import { useCallback, useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { BadgeCheck, Eye, Globe, Heart, LayoutGrid, Layers, MapPin, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { DISCOVERY_CITIES, EXPERIENCE_LEVELS, FAVORITE_EXERCISES, FITNESS_GOALS, TIMES_OF_DAY } from '../shared/constants.ts';
import type { CurrentUser, Gym, PublicProfileCard } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';
import { ProfileDetailModal } from './ProfileDetailModal.tsx';

interface DiscoverViewProps {
  user: CurrentUser;
  onOpenMessages: () => void;
  onOpenUpgrade: () => void;
}

export function DiscoverView({ user, onOpenMessages, onOpenUpgrade }: DiscoverViewProps) {
  const [profiles, setProfiles] = useState<PublicProfileCard[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'swipe' | 'grid'>('swipe');
  const [showFilters, setShowFilters] = useState(false);

  const [goalFilter, setGoalFilter] = useState('');
  const [gymFilter, setGymFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState('');
  const [expFilter, setExpFilter] = useState('');
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [cityFilter, setCityFilter] = useState(user.is_plus && user.travel_city ? user.travel_city : 'All');
  const [sortMode, setSortMode] = useState('compatibility');
  const [includeSwiped, setIncludeSwiped] = useState(false);

  const [selectedProfile, setSelectedProfile] = useState<PublicProfileCard | null>(null);
  const [matchBanner, setMatchBanner] = useState<{ partnerName: string; score: number } | null>(null);
  const [lastSkipped, setLastSkipped] = useState<PublicProfileCard | null>(null);
  const [swipeError, setSwipeError] = useState<string | null>(null);

  const dragX = useMotionValue(0);
  const cardRotate = useTransform(dragX, [-200, 200], [-10, 10]);
  const likeOpacity = useTransform(dragX, [24, 110], [0, 1]);
  const skipOpacity = useTransform(dragX, [-110, -24], [1, 0]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (goalFilter) params.set('goal', goalFilter);
      if (gymFilter) params.set('gym_id', gymFilter);
      if (timeFilter) params.set('time_of_day', timeFilter);
      if (expFilter) params.set('experience_level', expFilter);
      if (exerciseFilter) params.set('exercise', exerciseFilter);
      if (cityFilter && cityFilter !== 'All') params.set('city', cityFilter);
      params.set('sort', sortMode);
      if (includeSwiped) params.set('include_swiped', 'true');

      const res = await api<{ profiles: PublicProfileCard[] }>(`/api/discover?${params.toString()}`);
      setProfiles(res.profiles);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [goalFilter, gymFilter, timeFilter, expFilter, exerciseFilter, cityFilter, sortMode, includeSwiped]);

  useEffect(() => {
    api<{ gyms: Gym[] }>('/api/gyms').then((res) => setGyms(res.gyms)).catch(() => {});
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleSwipe = useCallback(async (targetUserId: string, decision: 'like' | 'pass') => {
    setSwipeError(null);
    const target = profiles.find((p) => p.user_id === targetUserId) || null;
    if (decision === 'pass' && target) {
      setLastSkipped(target);
    } else if (decision === 'like') {
      setLastSkipped(null);
    }
    setProfiles((prev) => prev.filter((p) => p.user_id !== targetUserId));
    dragX.set(0);

    try {
      const res = await api<{ matched: boolean }>('/api/swipe', {
        method: 'POST',
        body: JSON.stringify({ target_user_id: targetUserId, decision }),
      });
      if (res.matched && target) {
        setMatchBanner({ partnerName: target.display_name, score: target.compatibility.score });
      }
    } catch (err: any) {
      setSwipeError(err?.message || 'Unable to record decision. Refreshing profiles.');
      loadProfiles();
    }
  }, [profiles, dragX, loadProfiles]);

  async function handleUndoSkip() {
    if (!lastSkipped) return;
    const restored = lastSkipped;
    setSwipeError(null);
    try {
      await api('/api/swipe/undo', {
        method: 'POST',
        body: JSON.stringify({ target_user_id: restored.user_id }),
      });
      setProfiles((prev) => [restored, ...prev.filter((p) => p.user_id !== restored.user_id)]);
      setLastSkipped(null);
    } catch (err: any) {
      setSwipeError(err?.message || 'Could not undo last skip.');
    }
  }

  const topCard = profiles[0];

  useEffect(() => {
    if (viewMode !== 'swipe' || !topCard || selectedProfile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSwipe(topCard.user_id, 'pass');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSwipe(topCard.user_id, 'like');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedProfile(topCard);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, topCard, selectedProfile, handleSwipe]);

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight">Discover Training Partners</h1>
          <p className="text-sm text-zinc-400">
            Unlimited swipes &amp; browsing · Ranked by real fitness compatibility
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-1 rounded-lg bg-[#101214] border border-white/10">
            <button
              type="button"
              onClick={() => setViewMode('swipe')}
              className={`min-h-[38px] px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'swipe' ? 'bg-[#A3E635] text-[#070809]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Swipe Deck
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`min-h-[38px] px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'grid' ? 'bg-[#A3E635] text-[#070809]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Browse All
            </button>
          </div>

          {lastSkipped && (
            <button
              type="button"
              onClick={handleUndoSkip}
              className="min-h-[44px] px-3.5 rounded-lg border border-white/15 text-xs font-medium text-zinc-200 hover:border-[#A3E635]/60 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#A3E635]" />
              Undo Skip
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`min-h-[44px] px-4 rounded-lg border text-xs font-medium inline-flex items-center gap-2 cursor-pointer ${
              showFilters ? 'border-[#A3E635] text-[#A3E635] bg-[#A3E635]/10' : 'border-white/15 text-zinc-200 hover:bg-white/5'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters &amp; Sort
          </button>
        </div>
      </div>

      {swipeError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {swipeError}
        </div>
      )}

      {/* Filters Drawer */}
      {showFilters && (
        <div className="border border-white/10 rounded-xl bg-[#101214] p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Sort By</label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="compatibility">Highest Compatibility</option>
                <option value="same_gym">Same Home Gym First</option>
                <option value="active">Recently Active</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Fitness Goal</label>
              <select
                value={goalFilter}
                onChange={(e) => setGoalFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="">All Goals</option>
                {FITNESS_GOALS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Gym</label>
              <select
                value={gymFilter}
                onChange={(e) => setGymFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="">All Gyms</option>
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} ({g.city})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Training Time</label>
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="">Any Time</option>
                {TIMES_OF_DAY.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/10">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Experience Level</label>
              <select
                value={expFilter}
                onChange={(e) => setExpFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="">Any Experience</option>
                {EXPERIENCE_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-400">Favorite Exercise</label>
                {!user.is_plus && (
                  <button type="button" onClick={onOpenUpgrade} className="text-[11px] text-[#A3E635] hover:underline cursor-pointer">
                    GYMBUD+ · Coming Soon
                  </button>
                )}
              </div>
              <select
                disabled={!user.is_plus}
                value={exerciseFilter}
                onChange={(e) => setExerciseFilter(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white disabled:opacity-50"
              >
                <option value="">Any Exercise</option>
                {FAVORITE_EXERCISES.map((ex) => (
                  <option key={ex} value={ex}>{ex}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-400 inline-flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  City / Travel Mode
                </label>
                {!user.is_plus && (
                  <button type="button" onClick={onOpenUpgrade} className="text-[11px] text-[#A3E635] hover:underline cursor-pointer">
                    GYMBUD+ · Coming Soon
                  </button>
                )}
              </div>
              <select
                value={cityFilter}
                onChange={(e) => {
                  if (!user.is_plus && e.target.value !== 'All' && e.target.value !== user.city) {
                    onOpenUpgrade();
                    return;
                  }
                  setCityFilter(e.target.value);
                }}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              >
                <option value="All">All Cities</option>
                {DISCOVERY_CITIES.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city}, {c.country}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 text-xs">
            <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSwiped}
                onChange={(e) => setIncludeSwiped(e.target.checked)}
                className="w-4 h-4 accent-[#A3E635]"
              />
              Include previously skipped/liked profiles in browse
            </label>
            <button
              type="button"
              onClick={() => {
                setGoalFilter('');
                setGymFilter('');
                setTimeFilter('');
                setExpFilter('');
                setExerciseFilter('');
                setCityFilter('All');
                setSortMode('compatibility');
              }}
              className="text-zinc-400 hover:text-white cursor-pointer"
            >
              Reset all filters
            </button>
          </div>
        </div>
      )}

      {/* Match Banner */}
      {matchBanner && (
        <div className="border border-[#A3E635] rounded-2xl bg-[#101214] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-mono-num text-[#A3E635] font-semibold">
              MUTUAL MATCH · {matchBanner.score}% COMPATIBILITY
            </div>
            <h3 className="text-xl font-bold text-white mt-0.5">
              You and {matchBanner.partnerName} both liked each other!
            </h3>
            <p className="text-sm text-zinc-400">
              Messaging is unlocked. Suggest a gym session or share your workout split.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMatchBanner(null)}
              className="min-h-[44px] px-4 rounded-lg border border-white/15 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
            >
              Keep Discovering
            </button>
            <button
              type="button"
              onClick={() => {
                setMatchBanner(null);
                onOpenMessages();
              }}
              className="min-h-[44px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold hover:bg-[#bef264] cursor-pointer"
            >
              Send Message
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {loading ? (
        <div className="h-[480px] rounded-2xl border border-white/10 bg-[#101214] animate-pulse" />
      ) : profiles.length === 0 ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-10 text-center space-y-4">
          <h3 className="font-display text-2xl font-bold text-white">No more profiles match your current view</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            You have browsed all active members matching these filters. Reset your filters or include previously viewed profiles to revisit anyone.
          </p>
          <button
            type="button"
            onClick={() => setIncludeSwiped(true)}
            className="min-h-[44px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#bef264] cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            Browse All Members
          </button>
        </div>
      ) : viewMode === 'swipe' && topCard ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Interactive Swipe Card */}
          <div className="lg:col-span-7 flex flex-col items-center">
            <motion.div
              key={topCard.user_id}
              style={{ x: dragX, rotate: cardRotate }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDragEnd={(_e, info) => {
                if (info.offset.x > 110) handleSwipe(topCard.user_id, 'like');
                else if (info.offset.x < -110) handleSwipe(topCard.user_id, 'pass');
              }}
              className="w-full border border-white/15 rounded-2xl overflow-hidden bg-[#101214] cursor-grab active:cursor-grabbing select-none"
            >
              <div className="relative aspect-[4/3] sm:aspect-[16/10] bg-[#070809]">
                <ResilientImage
                  src={topCard.avatar_url}
                  alt={topCard.display_name}
                  className="w-full h-full object-cover pointer-events-none"
                  fallbackLabel={topCard.display_name}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#101214] via-black/30 to-transparent" />

                <motion.div
                  style={{ opacity: likeOpacity }}
                  className="pointer-events-none absolute top-16 left-6 px-4 py-1.5 rounded-lg border-2 border-[#A3E635] bg-black/70 font-display text-2xl font-extrabold tracking-widest text-[#A3E635] -rotate-6"
                >
                  LIKE
                </motion.div>
                <motion.div
                  style={{ opacity: skipOpacity }}
                  className="pointer-events-none absolute top-16 right-6 px-4 py-1.5 rounded-lg border-2 border-zinc-400 bg-black/70 font-display text-2xl font-extrabold tracking-widest text-zinc-200 rotate-6"
                >
                  SKIP
                </motion.div>

                <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-2">
                  <div className="font-mono-num text-sm font-bold px-3 py-1.5 rounded-lg bg-black/75 backdrop-blur-md text-[#A3E635] border border-[#A3E635]/40">
                    {topCard.compatibility.score}% COMPATIBILITY
                  </div>
                  {topCard.is_boosted && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-black/75 text-white border border-white/20">
                      Boosted
                    </span>
                  )}
                </div>

                <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-3xl font-bold text-white">
                        {topCard.display_name}, <span className="font-mono-num">{topCard.age}</span>
                      </h2>
                      {topCard.verified && <BadgeCheck className="w-5 h-5 text-[#A3E635]" />}
                    </div>
                    <p className="text-xs text-zinc-300 mt-0.5 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#A3E635]" />
                      <span>
                        {topCard.gym_name || `${topCard.city}, ${topCard.country}`}
                        {topCard.approx_distance_km ? ` · ~${topCard.approx_distance_km} km` : ''}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedProfile(topCard)}
                    className="min-h-[40px] px-3.5 rounded-lg bg-black/70 border border-white/20 text-xs font-medium text-white hover:bg-black cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Full Profile
                  </button>
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-4">
                <p className="text-sm text-zinc-300 leading-relaxed">{topCard.bio}</p>

                <div className="text-xs text-zinc-400 space-y-1 border-t border-white/10 pt-3">
                  <div>
                    <span className="text-zinc-500">Split &amp; Level:</span>{' '}
                    <span className="text-zinc-200 font-medium">
                      {topCard.experience_level} · {topCard.preferences.workout_split}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Focus:</span>{' '}
                    <span className="text-zinc-200">{topCard.preferences.goals.join(' · ')}</span>
                  </div>
                  {topCard.workout_dna && (
                    <div>
                      <span className="text-zinc-500">Workout DNA:</span>{' '}
                      <span className="text-[#A3E635] font-medium">{topCard.workout_dna.archetype}</span>
                    </div>
                  )}
                </div>

                {/* Swipe Controls */}
                <div className="pt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSwipe(topCard.user_id, 'pass')}
                    className="flex-1 min-h-[48px] rounded-xl border border-white/15 bg-[#070809] text-zinc-200 font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-white/5 cursor-pointer"
                  >
                    <X className="w-5 h-5 text-zinc-400" />
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwipe(topCard.user_id, 'like')}
                    className="flex-1 min-h-[48px] rounded-xl bg-[#A3E635] text-[#070809] font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-[#bef264] cursor-pointer"
                  >
                    <Heart className="w-5 h-5" />
                    Like Partner
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Real Compatibility Explanation Panel */}
          <div className="lg:col-span-5 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-5">
            <div>
              <div className="font-mono-num text-xs text-[#A3E635]">Calculated Compatibility</div>
              <div className="font-mono-num text-3xl font-bold text-white mt-1">
                {topCard.compatibility.score}% Match with {topCard.display_name}
              </div>
            </div>
            <ul className="space-y-2.5 text-sm text-zinc-300">
              {topCard.compatibility.reasons.map((reason) => (
                <li key={reason} className="pb-2 border-b border-white/5 last:border-0">
                  · {reason}
                </li>
              ))}
            </ul>
            <div className="pt-2 text-xs text-zinc-500 space-y-1">
              <div>{profiles.length - 1} more athlete{profiles.length - 1 === 1 ? '' : 's'} queued in your current filter.</div>
              <div className="hidden lg:block text-zinc-500">Keyboard: Left Arrow Skip · Right Arrow Like · Up Arrow Full Profile</div>
            </div>
          </div>
        </div>
      ) : (
        /* Grid Browse Mode */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((p) => (
            <div key={p.user_id} className="border border-white/10 rounded-2xl overflow-hidden bg-[#101214] flex flex-col justify-between">
              <div>
                <div className="relative aspect-[4/3] bg-[#070809]">
                  <ResilientImage
                    src={p.avatar_url}
                    alt={p.display_name}
                    className="w-full h-full object-cover"
                    fallbackLabel={p.display_name}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#101214] via-transparent to-transparent" />
                  <div className="absolute top-3 left-3 font-mono-num text-xs font-bold px-2.5 py-1 rounded bg-black/80 text-[#A3E635]">
                    {p.compatibility.score}% MATCH
                  </div>
                </div>
                <div className="p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-lg font-bold text-white truncate">
                        {p.display_name}, {p.age}
                      </h3>
                      {p.verified && <BadgeCheck className="w-4 h-4 text-[#A3E635] shrink-0" />}
                    </div>
                    <span className="text-xs text-zinc-400 shrink-0">{p.experience_level}</span>
                  </div>
                  <p className="text-xs text-zinc-400 truncate">
                    {p.gym_name || `${p.city}, ${p.country}`} · {p.preferences.workout_split}
                  </p>
                  <p className="text-sm text-zinc-300 line-clamp-2">{p.bio}</p>
                  <div className="text-xs text-zinc-400 pt-1">
                    {p.compatibility.reasons[0]}
                  </div>
                </div>
              </div>

              <div className="px-5 pb-5 pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProfile(p)}
                  className="min-h-[44px] px-3.5 rounded-lg border border-white/15 text-xs font-medium text-zinc-200 hover:bg-white/5 cursor-pointer"
                >
                  Profile
                </button>
                <button
                  type="button"
                  onClick={() => handleSwipe(p.user_id, 'pass')}
                  className="min-h-[44px] px-3.5 rounded-lg border border-white/15 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => handleSwipe(p.user_id, 'like')}
                  className="flex-1 min-h-[44px] rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold hover:bg-[#bef264] cursor-pointer"
                >
                  Like
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedProfile && (
        <ProfileDetailModal
          profile={selectedProfile}
          isPlus={user.is_plus}
          onClose={() => setSelectedProfile(null)}
          onSwipe={handleSwipe}
          onBlocked={(uid) => setProfiles((prev) => prev.filter((p) => p.user_id !== uid))}
        />
      )}
    </div>
  );
}
