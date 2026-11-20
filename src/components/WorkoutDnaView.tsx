import { useState } from 'react';
import { Check, Dna } from 'lucide-react';
import { api } from '../lib/api.ts';
import { WORKOUT_DNA_QUESTIONS } from '../shared/constants.ts';
import type { CurrentUser, WorkoutDnaArchetype } from '../shared/types.ts';

interface WorkoutDnaViewProps {
  user: CurrentUser;
  onUpdated: (user: CurrentUser) => void;
}

const ARCHETYPE_DESCRIPTIONS: Record<WorkoutDnaArchetype, string> = {
  'The Heavy Lifter': 'Driven by barbell progression, compound strength numbers, and focused rest intervals.',
  'The Hypertrophy Addict': 'Committed to mind-muscle connection, controlled reps, and balanced muscular symmetry.',
  'The Cardio Machine': 'Thrives on high-output conditioning, heart-rate zones, and relentless aerobic stamina.',
  'The Athlete': 'Trains for explosive power, agility, and cross-domain functional performance.',
  'The Consistency King': 'Unshakable weekly discipline, structured logs, and zero missed training blocks.',
  'The Beginner': 'Building foundational movement mastery, confidence, and sustainable gym habits.',
  'The Fitness Enthusiast': 'Balanced, adaptable training focused on long-term health, strength, and camaraderie.',
};

export function WorkoutDnaView({ user, onUpdated }: WorkoutDnaViewProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({
    favorite_day: user.workout_dna?.favorite_day || 'Chest & Push',
    weight_vs_reps: user.workout_dna?.weight_vs_reps || 'heavy_weights',
    solo_vs_partner: user.workout_dna?.solo_vs_partner || 'partner',
    morning_vs_evening: user.workout_dna?.morning_vs_evening || 'evening',
    music_habit: user.workout_dna?.music_habit || 'always_headphones',
    strength_vs_aesthetics: user.workout_dna?.strength_vs_aesthetics || 'strength',
    structured_vs_spontaneous: user.workout_dna?.structured_vs_spontaneous || 'structured',
    seriousness: user.workout_dna?.seriousness || 'dedicated',
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultArchetype, setResultArchetype] = useState<WorkoutDnaArchetype | null>(
    user.workout_dna?.archetype || null
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const res = await api<{ user: CurrentUser; archetype: WorkoutDnaArchetype }>('/api/workout-dna', {
        method: 'POST',
        body: JSON.stringify(answers),
      });
      setResultArchetype(res.archetype);
      onUpdated(res.user);
      setSavedMsg(`Workout DNA updated to ${res.archetype}. Compatibility scores refreshed.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to save Workout DNA.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Workout DNA</h1>
        <p className="text-sm text-zinc-400">
          Your training personality directly informs GYMBUD compatibility scores and partner suggestions.
        </p>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-xl bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {savedMsg}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      {resultArchetype && (
        <div className="border border-[#A3E635]/40 rounded-2xl bg-[#101214] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-[#A3E635] inline-flex items-center gap-1.5">
              <Dna className="w-4 h-4" />
              Your Active Workout DNA Category
            </div>
            <h2 className="font-display text-3xl font-bold text-white mt-1">{resultArchetype}</h2>
            <p className="text-sm text-zinc-300 mt-1">{ARCHETYPE_DESCRIPTIONS[resultArchetype]}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {WORKOUT_DNA_QUESTIONS.map((q, idx) => (
          <div key={q.key} className="border border-white/10 rounded-2xl bg-[#101214] p-5 sm:p-6 space-y-3">
            <div className="text-xs font-mono-num text-[#A3E635]">Question 0{idx + 1}</div>
            <h3 className="text-base font-semibold text-white">{q.question}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.key]: opt.value }))}
                    className={`min-h-[46px] p-3.5 rounded-xl border text-left text-sm flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#A3E635] bg-[#A3E635]/10 text-white font-medium'
                        : 'border-white/10 bg-[#070809] text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {selected && <Check className="w-4 h-4 text-[#A3E635] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[48px] px-7 rounded-xl bg-[#A3E635] text-[#070809] font-semibold text-sm hover:bg-[#bef264] disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Calculating DNA...' : 'Save Workout DNA & Update Matches'}
          </button>
        </div>
      </form>
    </div>
  );
}
