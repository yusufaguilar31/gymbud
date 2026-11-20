import { useEffect, useState } from 'react';
import { BadgeCheck, Flag, Heart, MapPin, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { PublicProfileCard } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';

interface ProfileDetailModalProps {
  profile: PublicProfileCard;
  isPlus: boolean;
  onClose: () => void;
  onSwipe?: (userId: string, decision: 'like' | 'pass') => void;
  onBlocked?: (userId: string) => void;
}

export function ProfileDetailModal({
  profile,
  isPlus,
  onClose,
  onSwipe,
  onBlocked,
}: ProfileDetailModalProps) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('Harassment or inappropriate behavior');
  const [details, setDetails] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const photos = [profile.avatar_url, ...profile.additional_photos].filter(Boolean);

  useEffect(() => {
    api(`/api/profile/${profile.user_id}/visit`, { method: 'POST' }).catch(() => {});
  }, [profile.user_id]);

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/safety/report', {
        method: 'POST',
        body: JSON.stringify({
          target_user_id: profile.user_id,
          target_type: 'profile',
          target_id: profile.user_id,
          reason,
          details,
        }),
      });
      setReporting(false);
      setFeedback('Report submitted to the GYMBUD Safety Team.');
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to submit report.');
    }
  }

  async function handleBlock() {
    try {
      await api('/api/safety/block', {
        method: 'POST',
        body: JSON.stringify({ user_id: profile.user_id }),
      });
      if (onBlocked) onBlocked(profile.user_id);
      onClose();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to block user.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-white/15 bg-[#101214] text-zinc-100">
        <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-[#101214]/95 backdrop-blur-md border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl font-bold text-white">
                {profile.display_name}, <span className="font-mono-num">{profile.age}</span>
              </h2>
              {profile.verified && <BadgeCheck className="w-5 h-5 text-[#A3E635]" aria-label="Verified member" />}
            </div>
            <p className="text-xs text-zinc-400">
              {profile.city}, {profile.country}
              {profile.approx_distance_km ? ` · ~${profile.approx_distance_km} km away` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Photo Gallery */}
          <div className="space-y-2">
            <div className="aspect-[16/10] rounded-xl overflow-hidden border border-white/10 bg-[#070809]">
              <ResilientImage
                src={photos[activePhotoIdx]}
                alt={profile.display_name}
                className="w-full h-full object-cover"
                fallbackLabel={profile.display_name}
              />
            </div>
            {photos.length > 1 && (
              <div className="flex gap-2">
                {photos.map((photo, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActivePhotoIdx(idx)}
                    className={`w-16 h-16 rounded-lg overflow-hidden border cursor-pointer ${
                      activePhotoIdx === idx ? 'border-[#A3E635]' : 'border-white/10 opacity-60'
                    }`}
                  >
                    <ResilientImage src={photo} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compatibility Block */}
          <div className="border border-[#A3E635]/30 rounded-xl p-5 bg-[#070809]">
            <div className="flex items-baseline justify-between gap-4">
              <div className="font-mono-num text-2xl font-bold text-[#A3E635]">
                {profile.compatibility.score}% COMPATIBILITY
              </div>
              {profile.workout_dna && (
                <span className="text-xs font-medium text-zinc-300">
                  Workout DNA: {profile.workout_dna.archetype}
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">
              {profile.compatibility.reasons.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>

            {isPlus && profile.compatibility.dimensions && (
              <div className="mt-5 pt-4 border-t border-white/10 space-y-2.5">
                <div className="text-xs font-semibold text-[#A3E635]">GYMBUD+ Compatibility Breakdown</div>
                {profile.compatibility.dimensions.map((dim) => (
                  <div key={dim.key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300">{dim.label} ({dim.detail})</span>
                      <span className="font-mono-num text-white">
                        {dim.score}/{dim.maxScore}
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#A3E635]"
                        style={{ width: `${Math.round((dim.score / dim.maxScore) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bio & Training Details */}
          <div className="space-y-4">
            <p className="text-sm text-zinc-200 leading-relaxed">{profile.bio}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Preferred Gym</div>
                <div className="text-zinc-200 font-medium mt-0.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#A3E635]" />
                  {profile.gym_name ? `${profile.gym_name} (${profile.gym_area})` : 'Hidden by member privacy'}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Experience &amp; Split</div>
                <div className="text-zinc-200 font-medium mt-0.5">
                  {profile.experience_level} · {profile.preferences.workout_split}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Fitness Goals</div>
                <div className="text-zinc-200 mt-0.5">{profile.preferences.goals.join(' · ')}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Favorite Muscle Groups</div>
                <div className="text-zinc-200 mt-0.5">{profile.preferences.muscle_groups.join(' · ')}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Favorite Exercises</div>
                <div className="text-zinc-200 mt-0.5">{profile.preferences.favorite_exercises.join(' · ')}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Schedule &amp; Frequency</div>
                <div className="text-zinc-200 mt-0.5">
                  {profile.preferences.training_frequency}x/week
                  {profile.preferences.training_days.length > 0
                    ? ` · ${profile.preferences.training_days.join(', ')} (${profile.preferences.training_times.join(', ')})`
                    : ' · Schedule hidden by privacy'}
                </div>
              </div>
            </div>
          </div>

          {feedback && (
            <div className="p-3 rounded-lg bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
              {feedback}
            </div>
          )}

          {reporting && (
            <form onSubmit={handleReport} className="border border-red-500/30 rounded-xl p-4 bg-[#070809] space-y-3">
              <div className="text-sm font-semibold text-white">Report Profile</div>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-sm text-white"
              >
                <option>Harassment or inappropriate behavior</option>
                <option>Fake profile or impersonation</option>
                <option>Spam or commercial solicitation</option>
                <option>Inappropriate photo</option>
                <option>Safety concern</option>
              </select>
              <textarea
                rows={2}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide helpful context for our safety team..."
                className="w-full p-2.5 rounded-lg bg-[#101214] border border-white/15 text-sm text-white"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setReporting(false)}
                  className="px-4 py-2 text-xs text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 cursor-pointer"
                >
                  Submit Report
                </button>
              </div>
            </form>
          )}

          {/* Action Row */}
          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setReporting(!reporting)}
                className="min-h-[40px] px-3 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Flag className="w-3.5 h-3.5" />
                Report
              </button>
              <button
                type="button"
                onClick={handleBlock}
                className="min-h-[40px] px-3 rounded-lg border border-white/10 text-xs text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                Block
              </button>
            </div>

            {onSwipe && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onSwipe(profile.user_id, 'pass');
                    onClose();
                  }}
                  className="min-h-[44px] px-5 rounded-lg border border-white/15 text-sm font-medium text-zinc-200 hover:bg-white/5 cursor-pointer"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSwipe(profile.user_id, 'like');
                    onClose();
                  }}
                  className="min-h-[44px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#bef264] cursor-pointer"
                >
                  <Heart className="w-4 h-4" />
                  Like Partner
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
