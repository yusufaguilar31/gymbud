import { useEffect, useState } from 'react';
import { Camera, Check, ChevronRight, MapPin, Search, Shield } from 'lucide-react';
import { api, fileToCompressedDataUrl } from '../lib/api.ts';
import { ASSETS } from '../lib/assets.ts';
import {
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

interface OnboardingFlowProps {
  user: CurrentUser;
  onComplete: (user: CurrentUser) => void;
}

export function OnboardingFlow({ user, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(1);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymSearch, setGymSearch] = useState('');

  const [avatarData, setAvatarData] = useState(user.avatar_url || '');
  const [additionalPhotos, setAdditionalPhotos] = useState<string[]>(user.additional_photos || []);
  const [bio, setBio] = useState(user.bio || '');
  const [experienceLevel, setExperienceLevel] = useState(user.experience_level || 'Intermediate');
  const [gymId, setGymId] = useState<string | null>(user.gym_id || 'gym_train_reem');

  const [goals, setGoals] = useState<string[]>(user.preferences.goals.length ? user.preferences.goals : ['Strength training', 'Muscle building']);
  const [muscleGroups, setMuscleGroups] = useState<string[]>(user.preferences.muscle_groups.length ? user.preferences.muscle_groups : ['Chest', 'Back', 'Legs']);
  const [favoriteExercises, setFavoriteExercises] = useState<string[]>(user.preferences.favorite_exercises.length ? user.preferences.favorite_exercises : ['Bench Press', 'Barbell Squat']);
  const [workoutSplit, setWorkoutSplit] = useState(user.preferences.workout_split || 'Push / Pull / Legs');
  const [frequency, setFrequency] = useState(user.preferences.training_frequency || 4);
  const [trainingDays, setTrainingDays] = useState<string[]>(user.preferences.training_days.length ? user.preferences.training_days : ['Mon', 'Wed', 'Fri', 'Sat']);
  const [trainingTimes, setTrainingTimes] = useState<string[]>(user.preferences.training_times.length ? user.preferences.training_times : ['7:00 PM']);
  const [timeOfDay, setTimeOfDay] = useState(user.preferences.time_of_day || 'Evening');
  const [gymEnv, setGymEnv] = useState(user.preferences.gym_environment || 'Strength & Barbell Club');
  const [partnerPref, setPartnerPref] = useState(user.preferences.partner_preference || 'Training Partner');

  const [hideGym, setHideGym] = useState(user.privacy.hide_gym);
  const [hideDistance, setHideDistance] = useState(user.privacy.hide_distance);
  const [hideSchedule, setHideSchedule] = useState(user.privacy.hide_schedule);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ gyms: Gym[] }>('/api/gyms').then((res) => setGyms(res.gyms)).catch(() => {});
  }, []);

  function toggleItem(list: string[], setList: (v: string[]) => void, item: string) {
    if (list.includes(item)) {
      if (list.length > 1) setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await fileToCompressedDataUrl(file);
      setAvatarData(compressed);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAdditionalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || additionalPhotos.length >= 4) return;
    try {
      const compressed = await fileToCompressedDataUrl(file);
      setAdditionalPhotos([...additionalPhotos, compressed]);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        bio: bio.trim() || `Training in ${user.city} with focus on ${goals.slice(0, 2).join(' and ')}.`,
        gym_id: gymId,
        experience_level: experienceLevel,
        additional_photos: additionalPhotos,
        onboarding_completed: true,
        privacy: {
          ...user.privacy,
          hide_gym: hideGym,
          hide_distance: hideDistance,
          hide_schedule: hideSchedule,
        },
        preferences: {
          goals,
          muscle_groups: muscleGroups,
          favorite_exercises: favoriteExercises,
          workout_split: workoutSplit,
          training_frequency: frequency,
          training_days: trainingDays,
          training_times: trainingTimes,
          time_of_day: timeOfDay,
          gym_environment: gymEnv,
          partner_preference: partnerPref,
        },
      };
      if (avatarData.startsWith('data:image/')) {
        payload.avatar_data = avatarData;
      } else {
        payload.avatar_url = avatarData || (user.gender === 'Female' ? ASSETS.portraitFemale : ASSETS.portraitMale);
      }

      const res = await api<{ user: CurrentUser }>('/api/profile/me', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      onComplete(res.user);
    } catch (err: any) {
      setError(err?.message || 'Unable to save onboarding preferences.');
    } finally {
      setSaving(false);
    }
  }

  const filteredGyms = gyms.filter(
    (g) =>
      !gymSearch ||
      g.name.toLowerCase().includes(gymSearch.toLowerCase()) ||
      g.area.toLowerCase().includes(gymSearch.toLowerCase()) ||
      g.city.toLowerCase().includes(gymSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#070809] text-zinc-100 py-8 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <span className="font-display text-2xl font-bold text-white">GYMBUD Onboarding</span>
            <p className="text-sm text-zinc-400">Step {step} of 4 · Build your real fitness profile</p>
          </div>
          <div className="font-mono-num text-sm text-[#A3E635]">{step * 25}%</div>
        </div>

        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-8">
          <div className="h-full bg-[#A3E635] transition-all duration-300" style={{ width: `${step * 25}%` }} />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 sm:p-8">
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-white">Photos, Bio &amp; Experience</h2>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                <div className="w-24 h-24 rounded-xl overflow-hidden border border-white/15 shrink-0">
                  <ResilientImage
                    src={avatarData || (user.gender === 'Female' ? ASSETS.portraitFemale : ASSETS.portraitMale)}
                    alt="Profile preview"
                    className="w-full h-full object-cover"
                    fallbackLabel={user.display_name}
                  />
                </div>
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-white cursor-pointer min-h-[44px]">
                    <Camera className="w-4 h-4 text-[#A3E635]" />
                    Upload Profile Picture
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                  <p className="text-xs text-zinc-400">JPG, PNG, or WebP up to 2MB. You can also add up to 4 extra training photos.</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-zinc-300">Additional Profile Photos ({additionalPhotos.length}/4)</span>
                  <label className="text-xs text-[#A3E635] hover:underline cursor-pointer">
                    + Add photo
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAdditionalUpload} className="hidden" />
                  </label>
                </div>
                {additionalPhotos.length > 0 && (
                  <div className="grid grid-cols-4 gap-3">
                    {additionalPhotos.map((p, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-white/10">
                        <img src={p} alt={`Extra ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setAdditionalPhotos(additionalPhotos.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/80 text-white rounded cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Fitness Experience Level</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {EXPERIENCE_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setExperienceLevel(lvl)}
                      className={`min-h-[44px] px-3 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                        experienceLevel === lvl
                          ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]'
                          : 'bg-[#070809] text-zinc-300 border-white/15 hover:border-white/30'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Personal Fitness Bio</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Share what you're training for, your favorite lifts, and what makes a great gym partner..."
                  className="w-full p-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Select Your Home Gym</h2>
                <p className="text-sm text-zinc-400 mt-1">Find gyms across Abu Dhabi, Dubai, UAE, and global hubs.</p>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={gymSearch}
                  onChange={(e) => setGymSearch(e.target.value)}
                  placeholder="Search Train, UFC Gym, Vogue Yas, Warehouse..."
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {filteredGyms.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGymId(g.id)}
                    className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                      gymId === g.id
                        ? 'border-[#A3E635] bg-[#A3E635]/10'
                        : 'border-white/10 bg-[#070809] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{g.name}</span>
                      {gymId === g.id && <Check className="w-4 h-4 text-[#A3E635] shrink-0" />}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
                      <MapPin className="w-3 h-3" />
                      <span>{g.area} · {g.city}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Preferred Gym Environment</label>
                <div className="flex flex-wrap gap-2">
                  {GYM_ENVIRONMENTS.map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setGymEnv(env)}
                      className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        gymEnv === env
                          ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]'
                          : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-white">Fitness Goals &amp; Favorite Lifts</h2>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Select Multiple Fitness Goals</label>
                <div className="flex flex-wrap gap-2">
                  {FITNESS_GOALS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleItem(goals, setGoals, g)}
                      className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        goals.includes(g)
                          ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]'
                          : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Favorite Muscle Groups</label>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleItem(muscleGroups, setMuscleGroups, m)}
                      className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        muscleGroups.includes(m)
                          ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]'
                          : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Favorite Exercises</label>
                <div className="flex flex-wrap gap-2">
                  {FAVORITE_EXERCISES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => toggleItem(favoriteExercises, setFavoriteExercises, ex)}
                      className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        favoriteExercises.includes(ex)
                          ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]'
                          : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Primary Workout Split</label>
                <select
                  value={workoutSplit}
                  onChange={(e) => setWorkoutSplit(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
                >
                  {WORKOUT_SPLITS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-bold text-white">Schedule, Partner Style &amp; Privacy</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Weekly Training Frequency (<span className="font-mono-num text-[#A3E635]">{frequency} days/wk</span>)
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={7}
                    value={frequency}
                    onChange={(e) => setFrequency(Number(e.target.value))}
                    className="w-full accent-[#A3E635]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Preferred Time of Day</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TIMES_OF_DAY.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTimeOfDay(t)}
                        className={`min-h-[40px] rounded-lg text-xs font-medium border cursor-pointer ${
                          timeOfDay === t ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Preferred Training Days</label>
                <div className="flex flex-wrap gap-2">
                  {TRAINING_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleItem(trainingDays, setTrainingDays, d)}
                      className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        trainingDays.includes(d) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Typical Session Times</label>
                <div className="flex flex-wrap gap-2">
                  {TRAINING_TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(trainingTimes, setTrainingTimes, t)}
                      className={`min-h-[40px] px-3 rounded-lg text-xs font-mono-num border cursor-pointer ${
                        trainingTimes.includes(t) ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">Partner Preference</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PARTNER_PREFERENCES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPartnerPref(p)}
                      className={`min-h-[44px] px-3 rounded-lg text-xs font-medium border cursor-pointer ${
                        partnerPref === p ? 'bg-[#A3E635] text-[#070809] border-[#A3E635]' : 'bg-[#070809] text-zinc-300 border-white/15'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/10 pt-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Shield className="w-4 h-4 text-[#A3E635]" />
                  Privacy Controls (Editable Anytime)
                </div>
                {[
                  { label: 'Hide my preferred gym name from discovery cards', checked: hideGym, set: setHideGym },
                  { label: 'Hide approximate distance in km', checked: hideDistance, set: setHideDistance },
                  { label: 'Hide exact training times from strangers', checked: hideSchedule, set: setHideSchedule },
                ].map((opt) => (
                  <label key={opt.label} className="flex items-center justify-between gap-3 text-sm text-zinc-300 cursor-pointer py-1">
                    <span>{opt.label}</span>
                    <input
                      type="checkbox"
                      checked={opt.checked}
                      onChange={(e) => opt.set(e.target.checked)}
                      className="w-5 h-5 accent-[#A3E635]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between gap-4">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="min-h-[44px] px-5 rounded-lg border border-white/15 text-sm font-medium text-zinc-200 hover:bg-white/5 cursor-pointer"
              >
                Previous
              </button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="min-h-[44px] px-6 rounded-lg bg-[#A3E635] text-[#070809] text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#bef264] cursor-pointer"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="min-h-[44px] px-6 rounded-lg bg-[#A3E635] text-[#070809] text-sm font-semibold hover:bg-[#bef264] disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving Profile...' : 'Complete Onboarding'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
