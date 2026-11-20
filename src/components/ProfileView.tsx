import { useEffect, useState } from 'react';
import { BadgeCheck, Camera, Check, Dna, ImagePlus, MapPin, ShieldCheck, Sparkles, Star, Trash2, TrendingUp, Zap } from 'lucide-react';
import { api, fileToCompressedDataUrl } from '../lib/api.ts';
import {
  DISCOVERY_CITIES,
  EXPERIENCE_LEVELS,
  FAVORITE_EXERCISES,
  FITNESS_GOALS,
  GYM_ENVIRONMENTS,
  MUSCLE_GROUPS,
  PARTNER_PREFERENCES,
  TIMES_OF_DAY,
  TRAINING_DAYS,
  TRAINING_TIMES,
  WORKOUT_SPLITS,
} from '../shared/constants.ts';
import type { CurrentUser, Gym } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';

interface ProfileViewProps {
  user: CurrentUser;
  onUpdated: (user: CurrentUser) => void;
  onNavigate: (view: string) => void;
}

export function ProfileView({ user, onUpdated, onNavigate }: ProfileViewProps) {
  const [editing, setEditing] = useState(false);
  const [gyms, setGyms] = useState<Gym[]>([]);

  const [displayName, setDisplayName] = useState(user.display_name);
  const [age, setAge] = useState(String(Math.min(99, Math.max(18, user.age || 18))));
  const [gender, setGender] = useState(user.gender || 'Prefer not to say');
  const [bio, setBio] = useState(user.bio);
  const [phone, setPhone] = useState(user.phone);
  const [city, setCity] = useState(user.city);
  const [gymId, setGymId] = useState(user.gym_id || '');
  const [expLevel, setExpLevel] = useState(user.experience_level);
  const [goals, setGoals] = useState<string[]>(user.preferences.goals);
  const [muscles, setMuscles] = useState<string[]>(user.preferences.muscle_groups);
  const [exercises, setExercises] = useState<string[]>(user.preferences.favorite_exercises);
  const [split, setSplit] = useState(user.preferences.workout_split);
  const [frequency, setFrequency] = useState(user.preferences.training_frequency);
  const [days, setDays] = useState<string[]>(user.preferences.training_days);
  const [times, setTimes] = useState<string[]>(user.preferences.training_times);
  const [timeOfDay, setTimeOfDay] = useState(user.preferences.time_of_day);
  const [gymEnv, setGymEnv] = useState(user.preferences.gym_environment);
  const [partnerPref, setPartnerPref] = useState(user.preferences.partner_preference);

  const [profileTheme, setProfileTheme] = useState(user.profile_theme);
  const [customBadge, setCustomBadge] = useState(user.custom_badge || '');
  const [travelCity, setTravelCity] = useState(user.travel_city || '');

  // Verification states
  const [emailOtpHint, setEmailOtpHint] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [phoneOtpHint, setPhoneOtpHint] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState('');
  const [selfieStatusMsg, setSelfieStatusMsg] = useState<string | null>(null);

  // Analytics state (GYMBUD+)
  const [analytics, setAnalytics] = useState<{
    total_visits: number;
    likes_received: number;
    likes_sent: number;
    active_matches: number;
    recent_visitors: { display_name: string; city: string; experience_level: string; visited_at: string }[];
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ gyms: Gym[] }>('/api/gyms').then((r) => setGyms(r.gyms)).catch(() => {});
    if (user.is_plus) {
      api<any>('/api/analytics/profile').then(setAnalytics).catch(() => {});
    }
  }, [user.is_plus]);

  function toggle(arr: string[], setArr: (v: string[]) => void, val: string) {
    if (arr.includes(val)) {
      if (arr.length > 1) setArr(arr.filter((x) => x !== val));
    } else {
      setArr([...arr, val]);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await fileToCompressedDataUrl(file);
      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify({ avatar_data: compressed }),
      });
      onUpdated(res.user);
      setMessage('Profile photo updated.');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAddGalleryPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      const compressed = await fileToCompressedDataUrl(file);
      const nextPhotos = [...(user.additional_photos || []), compressed].slice(0, 5);
      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify({ additional_photos: nextPhotos }),
      });
      onUpdated(res.user);
      setMessage('Photo added to your training gallery.');
    } catch (err: any) {
      setError(err?.message || 'Unable to upload gallery photo.');
    }
  }

  async function handleRemoveGalleryPhoto(photoUrl: string) {
    setError(null);
    setMessage(null);
    try {
      const nextPhotos = (user.additional_photos || []).filter((p) => p !== photoUrl);
      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify({ additional_photos: nextPhotos }),
      });
      onUpdated(res.user);
      setMessage('Gallery photo removed.');
    } catch (err: any) {
      setError(err?.message || 'Unable to remove photo.');
    }
  }

  async function handleSetPrimaryPhoto(photoUrl: string) {
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify({ avatar_url: photoUrl }),
      });
      onUpdated(res.user);
      setMessage('Primary profile photo updated.');
    } catch (err: any) {
      setError(err?.message || 'Unable to update primary photo.');
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const cleanAge = age.trim();
    const parsedAge = Number(cleanAge);
    if (!/^\d{2}$/.test(cleanAge) || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      setError('Please enter a 2-digit age between 18 and 99.');
      setSaving(false);
      return;
    }
    try {
      const matchedCity = DISCOVERY_CITIES.find((c) => c.city === travelCity);
      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: displayName,
          age: parsedAge,
          gender,
          bio,
          phone,
          city,
          gym_id: gymId || null,
          experience_level: expLevel,
          profile_theme: profileTheme,
          custom_badge: customBadge || null,
          travel_city: travelCity || null,
          travel_country: matchedCity?.country || null,
          preferences: {
            goals,
            muscle_groups: muscles,
            favorite_exercises: exercises,
            workout_split: split,
            training_frequency: frequency,
            training_days: days,
            training_times: times,
            time_of_day: timeOfDay,
            gym_environment: gymEnv,
            partner_preference: partnerPref,
          },
        }),
      });
      onUpdated(res.user);
      setEditing(false);
      setMessage('Profile and training preferences saved.');
    } catch (err: any) {
      setError(err?.message || 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  }

  async function requestVerification(type: 'email' | 'phone') {
    setError(null);
    try {
      const res = await api<{ sandbox_code: string }>('/api/verification/request-code', {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      if (type === 'email') setEmailOtpHint(res.sandbox_code);
      else setPhoneOtpHint(res.sandbox_code);
    } catch (err: any) {
      setError(err?.message || 'Unable to issue verification code.');
    }
  }

  async function submitVerification(type: 'email' | 'phone') {
    setError(null);
    try {
      const code = type === 'email' ? emailCode : phoneCode;
      const res = await api<{ user: CurrentUser }>('/api/verification/verify-code', {
        method: 'POST',
        body: JSON.stringify({ type, code }),
      });
      onUpdated(res.user);
      if (type === 'email') {
        setEmailOtpHint(null);
        setEmailCode('');
      } else {
        setPhoneOtpHint(null);
        setPhoneCode('');
      }
      setMessage(`${type === 'email' ? 'Email' : 'Phone'} verified successfully.`);
    } catch (err: any) {
      setError(err?.message || 'Invalid verification code.');
    }
  }

  async function handleSelfieUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await fileToCompressedDataUrl(file);
      const res = await api<{ message: string }>('/api/verification/selfie', {
        method: 'POST',
        body: JSON.stringify({ selfie_data: compressed, pose_note: 'Gym floor thumbs-up' }),
      });
      setSelfieStatusMsg(res.message);
    } catch (err: any) {
      setError(err?.message || 'Selfie upload failed.');
    }
  }

  const themeAccent =
    user.is_plus && user.profile_theme === 'emerald_gold'
      ? 'border-amber-400/40'
      : user.is_plus && user.profile_theme === 'carbon_lime'
        ? 'border-[#A3E635]/50'
        : 'border-white/10';

  const readinessItems = [
    { label: 'Profile Photo', done: Boolean(user.avatar_url) },
    { label: 'Personal Bio', done: Boolean(user.bio && user.bio.trim().length >= 12) },
    { label: 'Preferred Gym', done: Boolean(user.gym_id) },
    { label: 'Workout DNA', done: Boolean(user.workout_dna) },
    { label: 'Email Verified', done: Boolean(user.email_verified) },
    { label: 'Phone Verified', done: Boolean(user.phone_verified) },
  ];
  const readinessScore = Math.round(
    (readinessItems.filter((i) => i.done).length / readinessItems.length) * 100
  );

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight">My Fitness Profile</h1>
          <p className="text-sm text-zinc-400">
            Control your training details, verification status, and discovery visibility
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigate('dna')}
            className="min-h-[42px] px-4 rounded-lg border border-white/15 text-xs font-medium text-zinc-200 hover:bg-white/5 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Dna className="w-4 h-4 text-[#A3E635]" />
            {user.workout_dna ? user.workout_dna.archetype : 'Take Workout DNA'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="min-h-[42px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold hover:bg-[#bef264] cursor-pointer"
          >
            {editing ? 'Cancel Edit' : 'Edit Profile & Split'}
          </button>
        </div>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Profile Hero Card */}
      <div className={`border ${themeAccent} rounded-2xl bg-[#101214] p-6 sm:p-8`}>
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="relative w-28 h-28 rounded-2xl overflow-hidden border border-white/15 shrink-0">
            <ResilientImage
              src={user.avatar_url}
              alt={user.display_name}
              className="w-full h-full object-cover"
              fallbackLabel={user.display_name}
            />
            <label
              title="Update profile picture"
              className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-lg bg-black/80 border border-white/20 flex items-center justify-center text-white hover:bg-black cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarChange} className="hidden" />
            </label>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl font-bold text-white">
                {user.display_name}, <span className="font-mono-num">{user.age}</span>
              </h2>
              {user.verified && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#A3E635]">
                  <BadgeCheck className="w-4 h-4" />
                  Verified
                </span>
              )}
              {user.is_plus && (
                <span className="text-xs font-semibold text-amber-300">
                  · GYMBUD+{user.custom_badge ? ` · ${user.custom_badge}` : ''}
                </span>
              )}
            </div>

            <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[#A3E635]" />
                {user.gym_name || `${user.city}, ${user.country}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{user.experience_level}</span>
              <span aria-hidden="true">·</span>
              <span>{user.preferences.workout_split}</span>
              {user.workout_dna && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#A3E635]">{user.workout_dna.archetype}</span>
                </>
              )}
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed pt-1">{user.bio || 'No bio added yet.'}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10 text-xs">
              <div>
                <div className="text-zinc-500">Goals</div>
                <div className="text-zinc-200 mt-0.5">{user.preferences.goals.join(' · ')}</div>
              </div>
              <div>
                <div className="text-zinc-500">Muscle Groups</div>
                <div className="text-zinc-200 mt-0.5">{user.preferences.muscle_groups.join(' · ')}</div>
              </div>
              <div>
                <div className="text-zinc-500">Schedule</div>
                <div className="text-zinc-200 mt-0.5">
                  {user.preferences.training_frequency}x/wk · {user.preferences.training_days.join(', ')} ({user.preferences.training_times.join(', ')})
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Readiness Meter & Training Photo Gallery */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-2xl font-bold text-white">Profile Readiness</h3>
              <p className="text-xs text-zinc-400">Complete profiles rank higher with real training partners</p>
            </div>
            <span className="font-mono-num text-2xl font-bold text-[#A3E635]">{readinessScore}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#070809] border border-white/10 overflow-hidden">
            <div className="h-full bg-[#A3E635] transition-all duration-300" style={{ width: `${readinessScore}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {readinessItems.map((item) => (
              <div
                key={item.label}
                className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                  item.done ? 'border-[#A3E635]/30 bg-[#A3E635]/5 text-zinc-200' : 'border-white/10 bg-[#070809] text-zinc-500'
                }`}
              >
                <span>{item.label}</span>
                {item.done && <Check className="w-3.5 h-3.5 text-[#A3E635] shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl font-bold text-white">Training Photo Gallery</h3>
              <p className="text-xs text-zinc-400">
                Up to 5 additional gym photos ({(user.additional_photos || []).length}/5 uploaded)
              </p>
            </div>
            {(user.additional_photos || []).length < 5 && (
              <label className="min-h-[38px] px-3.5 rounded-lg border border-white/15 text-xs font-medium text-white hover:bg-white/5 inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                <ImagePlus className="w-3.5 h-3.5 text-[#A3E635]" />
                Add Photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAddGalleryPhoto}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {(user.additional_photos || []).length === 0 ? (
            <div className="border border-dashed border-white/15 rounded-xl p-6 text-center text-xs text-zinc-400 bg-[#070809]">
              Add up to 5 training photos to showcase your favorite lifts or home gym environment.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(user.additional_photos || []).map((photoUrl, idx) => (
                <div key={`${photoUrl}-${idx}`} className="relative group aspect-square rounded-xl overflow-hidden border border-white/10 bg-[#070809]">
                  <ResilientImage src={photoUrl} alt={`Training photo ${idx + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSetPrimaryPhoto(photoUrl)}
                      title="Set as primary profile photo"
                      className="px-2 py-1 rounded bg-black/80 border border-white/20 text-[10px] font-medium text-white hover:border-[#A3E635] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Star className="w-3 h-3 text-[#A3E635]" />
                      Set Main
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveGalleryPhoto(photoUrl)}
                      aria-label="Remove photo"
                      className="p-1.5 rounded bg-black/80 border border-white/20 text-zinc-300 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Profile Form */}
      {editing && (
        <form onSubmit={handleSaveProfile} className="border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-6">
          <h3 className="font-display text-2xl font-bold text-white">Edit Fitness Profile &amp; Preferences</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Age (18–99)</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{2}"
                maxLength={2}
                required
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="24"
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm font-mono-num text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+97150..."
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">City</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                {DISCOVERY_CITIES.map((c) => (
                  <option key={c.city} value={c.city}>{c.city}, {c.country}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Preferred Home Gym</label>
              <select
                value={gymId}
                onChange={(e) => setGymId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                <option value="">No fixed gym</option>
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} ({g.city})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full p-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Experience</label>
              <select
                value={expLevel}
                onChange={(e) => setExpLevel(e.target.value as any)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Workout Split</label>
              <select
                value={split}
                onChange={(e) => setSplit(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                {WORKOUT_SPLITS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Time of Day</label>
              <select
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value as any)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                {TIMES_OF_DAY.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Fitness Goals</label>
              <div className="flex flex-wrap gap-1.5">
                {FITNESS_GOALS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggle(goals, setGoals, g)}
                    className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                      goals.includes(g) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Muscle Groups</label>
              <div className="flex flex-wrap gap-1.5">
                {MUSCLE_GROUPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggle(muscles, setMuscles, m)}
                    className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                      muscles.includes(m) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Favorite Exercises</label>
              <div className="flex flex-wrap gap-1.5">
                {FAVORITE_EXERCISES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => toggle(exercises, setExercises, ex)}
                    className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                      exercises.includes(ex) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                    }`}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Training Days</label>
                <div className="flex flex-wrap gap-1.5">
                  {TRAINING_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggle(days, setDays, d)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs border cursor-pointer ${
                        days.includes(d) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Preferred Times</label>
                <div className="flex flex-wrap gap-1.5">
                  {TRAINING_TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(times, setTimes, t)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono-num border cursor-pointer ${
                        times.includes(t) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Weekly Sessions ({frequency}x)</label>
                <input type="range" min={1} max={7} value={frequency} onChange={(e) => setFrequency(Number(e.target.value))} className="w-full accent-[#A3E635]" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Gym Environment</label>
                <select value={gymEnv} onChange={(e) => setGymEnv(e.target.value as any)} className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white">
                  {GYM_ENVIRONMENTS.map((ge) => <option key={ge} value={ge}>{ge}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Partner Style</label>
                <select value={partnerPref} onChange={(e) => setPartnerPref(e.target.value as any)} className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white">
                  {PARTNER_PREFERENCES.map((pp) => <option key={pp} value={pp}>{pp}</option>)}
                </select>
              </div>
            </div>
          </div>

          {user.is_plus && (
            <div className="border-t border-white/10 pt-4 space-y-3">
              <div className="text-xs font-semibold text-[#A3E635] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                GYMBUD+ Customization &amp; Travel Mode
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Profile Theme</label>
                  <select value={profileTheme} onChange={(e) => setProfileTheme(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white">
                    <option value="obsidian">Obsidian Standard</option>
                    <option value="carbon_lime">Carbon &amp; Lime</option>
                    <option value="emerald_gold">Emerald &amp; Gold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Special Profile Badge</label>
                  <select value={customBadge} onChange={(e) => setCustomBadge(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white">
                    <option value="">None</option>
                    <option value="Morning Crew">Morning Crew</option>
                    <option value="PR Chaser">PR Chaser</option>
                    <option value="Spotter Ready">Spotter Ready</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Travel Mode City</label>
                  <select value={travelCity} onChange={(e) => setTravelCity(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white">
                    <option value="">Home City ({user.city})</option>
                    {DISCOVERY_CITIES.map((c) => <option key={c.city} value={c.city}>{c.city}, {c.country}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] px-4 text-xs text-zinc-400 cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="min-h-[44px] px-6 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Account Verification Section (Genuine Checks Only) */}
      <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#A3E635]" />
              Account Verification
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Verification badges only appear after real email, phone OTP, or moderator-reviewed selfie checks succeed.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Email Verification */}
          <div className="border border-white/10 rounded-xl p-4 bg-[#070809] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Email Verification</span>
              {user.email_verified ? (
                <span className="text-xs text-[#A3E635] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Verified</span>
              ) : (
                <span className="text-xs text-zinc-500">Unverified</span>
              )}
            </div>
            <p className="text-xs text-zinc-400 truncate">{user.email}</p>
            {!user.email_verified && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => requestVerification('email')}
                  className="w-full min-h-[38px] rounded-lg border border-white/15 text-xs font-medium text-white hover:bg-white/5 cursor-pointer"
                >
                  Send Email Code
                </button>
                {emailOtpHint && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-mono-num text-[#A3E635]">Sandbox OTP: {emailOtpHint}</div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value)}
                        placeholder="6-digit code"
                        className="flex-1 h-9 px-2.5 rounded bg-[#101214] border border-white/15 text-xs font-mono-num text-white"
                      />
                      <button
                        type="button"
                        onClick={() => submitVerification('email')}
                        className="px-3 h-9 rounded bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer"
                      >
                        Verify
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phone Verification */}
          <div className="border border-white/10 rounded-xl p-4 bg-[#070809] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Phone Verification</span>
              {user.phone_verified ? (
                <span className="text-xs text-[#A3E635] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Verified</span>
              ) : (
                <span className="text-xs text-zinc-500">Unverified</span>
              )}
            </div>
            <p className="text-xs text-zinc-400">{user.phone || 'Add phone in Edit Profile'}</p>
            {!user.phone_verified && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => requestVerification('phone')}
                  className="w-full min-h-[38px] rounded-lg border border-white/15 text-xs font-medium text-white hover:bg-white/5 cursor-pointer"
                >
                  Send SMS Code
                </button>
                {phoneOtpHint && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-mono-num text-[#A3E635]">Sandbox SMS: {phoneOtpHint}</div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value)}
                        placeholder="6-digit code"
                        className="flex-1 h-9 px-2.5 rounded bg-[#101214] border border-white/15 text-xs font-mono-num text-white"
                      />
                      <button
                        type="button"
                        onClick={() => submitVerification('phone')}
                        className="px-3 h-9 rounded bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer"
                      >
                        Verify
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selfie Verification */}
          <div className="border border-white/10 rounded-xl p-4 bg-[#070809] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Selfie Check (Optional)</span>
              {user.selfie_verified ? (
                <span className="text-xs text-[#A3E635] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Approved</span>
              ) : (
                <span className="text-xs text-zinc-500">Moderator Review</span>
              )}
            </div>
            <p className="text-xs text-zinc-400">Upload a quick gym pose photo for human moderator verification.</p>
            {!user.selfie_verified && (
              <label className="w-full min-h-[38px] rounded-lg border border-white/15 text-xs font-medium text-white hover:bg-white/5 flex items-center justify-center cursor-pointer">
                Upload Selfie Photo
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSelfieUpload} className="hidden" />
              </label>
            )}
            {selfieStatusMsg && <p className="text-[11px] text-[#A3E635]">{selfieStatusMsg}</p>}
          </div>
        </div>
      </div>

      {/* GYMBUD+ Profile Analytics */}
      <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#A3E635]" />
              Profile Analytics
            </h3>
            <p className="text-xs text-zinc-400">Engagement statistics respecting member visit privacy settings</p>
          </div>
          {!user.is_plus && (
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="min-h-[40px] px-4 rounded-lg border border-[#A3E635]/40 text-[#A3E635] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#A3E635]/10 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              GYMBUD+ Coming Soon
            </button>
          )}
        </div>

        {user.is_plus && analytics ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Profile Views', value: analytics.total_visits },
                { label: 'Likes Received', value: analytics.likes_received },
                { label: 'Likes Sent', value: analytics.likes_sent },
                { label: 'Active Matches', value: analytics.active_matches },
              ].map((stat) => (
                <div key={stat.label} className="border border-white/10 rounded-xl p-4 bg-[#070809]">
                  <div className="text-xs text-zinc-400">{stat.label}</div>
                  <div className="font-mono-num text-2xl font-bold text-white mt-1">{stat.value}</div>
                </div>
              ))}
            </div>
            {analytics.recent_visitors.length > 0 && (
              <div className="text-xs text-zinc-400 space-y-1">
                <div className="font-medium text-zinc-300">Recent Visitors (with visit sharing enabled):</div>
                {analytics.recent_visitors.map((v, idx) => (
                  <div key={idx}>
                    · {v.display_name} ({v.city} · {v.experience_level})
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            Detailed profile visits, engagement ratios, Travel Mode, and custom themes are launching soon with GYMBUD+.
          </p>
        )}
      </div>
    </div>
  );
}
