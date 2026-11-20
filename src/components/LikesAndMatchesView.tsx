import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Heart, MessageSquare, UserMinus, Zap } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CurrentUser, MatchSummary, PublicProfileCard } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';
import { ProfileDetailModal } from './ProfileDetailModal.tsx';

interface LikesViewProps {
  user: CurrentUser;
  onOpenUpgrade: () => void;
  onMatched: () => void;
}

export function LikesView({ user, onOpenUpgrade, onMatched }: LikesViewProps) {
  const [count, setCount] = useState(0);
  const [profiles, setProfiles] = useState<PublicProfileCard[]>([]);
  const [previews, setPreviews] = useState<{ id: string; city: string; experience_level: string; archetype: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<PublicProfileCard | null>(null);

  const loadIncoming = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        count: number;
        is_plus: boolean;
        profiles: PublicProfileCard[];
        previews: { id: string; city: string; experience_level: string; archetype: string }[];
      }>('/api/likes/incoming');
      setCount(res.count);
      setProfiles(res.profiles);
      setPreviews(res.previews);
    } catch {
      setCount(0);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIncoming();
  }, [loadIncoming]);

  async function handleRespond(targetId: string, decision: 'like' | 'pass') {
    setProfiles((prev) => prev.filter((p) => p.user_id !== targetId));
    const res = await api<{ matched: boolean }>('/api/swipe', {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetId, decision }),
    });
    if (res.matched) {
      onMatched();
    }
    loadIncoming();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Incoming Likes</h1>
        <p className="text-sm text-zinc-400">
          <span className="font-mono-num text-white">{count}</span> gym member{count === 1 ? '' : 's'} liked your profile
        </p>
      </div>

      {loading ? (
        <div className="h-48 rounded-2xl border border-white/10 bg-[#101214] animate-pulse" />
      ) : count === 0 ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-10 text-center space-y-2">
          <h3 className="text-lg font-semibold text-white">No pending likes right now</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Keep discovering training partners and complete your Workout DNA profile so compatible gym-goers find you.
          </p>
        </div>
      ) : !user.is_plus ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-[#A3E635]">GYMBUD+ Feature · Coming Soon</div>
              <h2 className="text-xl font-bold text-white mt-1">
                See everyone who liked you ({count}) when GYMBUD+ launches
              </h2>
              <p className="text-sm text-zinc-400 mt-1">
                Free members always match naturally for free in Discover right now. Instant incoming likes reveal is coming soon with GYMBUD+.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenUpgrade}
              className="min-h-[44px] px-5 rounded-lg border border-[#A3E635]/40 text-[#A3E635] text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#A3E635]/10 cursor-pointer shrink-0"
            >
              <Zap className="w-4 h-4" />
              GYMBUD+ Coming Soon
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {previews.map((pr) => (
              <div key={pr.id} className="border border-white/10 rounded-xl p-4 bg-[#070809] space-y-2">
                <div className="h-28 rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                  Identity Revealed in GYMBUD+
                </div>
                <div className="text-sm font-semibold text-white">{pr.archetype}</div>
                <div className="text-xs text-zinc-400">
                  {pr.city} · {pr.experience_level}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((p) => (
            <div key={p.user_id} className="border border-white/10 rounded-2xl overflow-hidden bg-[#101214]">
              <div className="relative aspect-[4/3]">
                <ResilientImage src={p.avatar_url} alt={p.display_name} className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 font-mono-num text-xs font-bold px-2.5 py-1 rounded bg-black/80 text-[#A3E635]">
                  {p.compatibility.score}% MATCH
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-lg font-bold text-white">
                    {p.display_name}, {p.age}
                  </h3>
                  {p.verified && <BadgeCheck className="w-4 h-4 text-[#A3E635]" />}
                </div>
                <p className="text-xs text-zinc-400">
                  {p.gym_name || p.city} · {p.preferences.workout_split}
                </p>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProfile(p)}
                    className="min-h-[44px] px-3 rounded-lg border border-white/15 text-xs text-zinc-200 hover:bg-white/5 cursor-pointer"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespond(p.user_id, 'pass')}
                    className="min-h-[44px] px-3 rounded-lg border border-white/15 text-xs text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespond(p.user_id, 'like')}
                    className="flex-1 min-h-[44px] rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#bef264] cursor-pointer"
                  >
                    <Heart className="w-4 h-4" />
                    Match Back
                  </button>
                </div>
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
          onSwipe={handleRespond}
        />
      )}
    </div>
  );
}

interface MatchesViewProps {
  user: CurrentUser;
  onOpenChat: (conversationId: string) => void;
}

export function MatchesView({ user, onOpenChat }: MatchesViewProps) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<PublicProfileCard | null>(null);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ matches: MatchSummary[] }>('/api/matches');
      setMatches(res.matches);
    } catch {
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  async function handleUnmatch(matchId: string) {
    await api(`/api/matches/${matchId}/unmatch`, { method: 'POST' });
    setMatches((prev) => prev.filter((m) => m.match_id !== matchId));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Mutual Matches</h1>
        <p className="text-sm text-zinc-400">
          Unlimited matches &amp; messaging · Unmatch or manage safety anytime
        </p>
      </div>

      {loading ? (
        <div className="h-48 rounded-2xl border border-white/10 bg-[#101214] animate-pulse" />
      ) : matches.length === 0 ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-10 text-center space-y-2">
          <h3 className="text-lg font-semibold text-white">No mutual matches yet</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Like training partners in Discover. As soon as someone likes you back, your match and private chat unlock automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {matches.map((m) => (
            <div key={m.match_id} className="border border-white/10 rounded-2xl bg-[#101214] p-5 flex flex-col justify-between gap-4">
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedProfile(m.partner)}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 shrink-0 cursor-pointer"
                >
                  <ResilientImage src={m.partner.avatar_url} alt={m.partner.display_name} className="w-full h-full object-cover" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-lg font-bold text-white truncate">
                        {m.partner.display_name}, {m.partner.age}
                      </h3>
                      {m.partner.verified && <BadgeCheck className="w-4 h-4 text-[#A3E635] shrink-0" />}
                    </div>
                    <span className="font-mono-num text-xs font-bold text-[#A3E635] shrink-0">
                      {m.compatibility_score}%
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">
                    {m.partner.gym_name || m.partner.city} · {m.partner.preferences.workout_split}
                  </p>
                  <p className="text-xs text-zinc-300 mt-2">
                    {m.compatibility_reasons.slice(0, 2).join(' · ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => handleUnmatch(m.match_id)}
                  className="min-h-[40px] px-3 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  Unmatch
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChat(m.conversation_id)}
                  className="min-h-[44px] px-5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#bef264] cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  Message {m.unread_count > 0 ? `(${m.unread_count})` : ''}
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
          onBlocked={() => loadMatches()}
        />
      )}
    </div>
  );
}
