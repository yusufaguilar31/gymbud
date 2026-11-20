import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, Calendar, CheckCheck, Dumbbell, Flag, Send, ShieldAlert, ShieldCheck, UserMinus } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { ChatMessage, CurrentUser, Gym, MatchSummary, MeetupSession } from '../shared/types.ts';
import { ResilientImage } from './ResilientImage.tsx';

interface MessagesViewProps {
  user: CurrentUser;
  initialConversationId: string | null;
  wsSocket: WebSocket | null;
  onRefreshMatchesCount: () => void;
}

export function MessagesView({ user, initialConversationId, wsSocket, onRefreshMatchesCount }: MessagesViewProps) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meetups, setMeetups] = useState<MeetupSession[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);

  const [draft, setDraft] = useState('');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showRoutineModal, setShowRoutineModal] = useState(false);
  const [showMeetupModal, setShowMeetupModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const [routineName, setRoutineName] = useState('Upper Power & Bench Session');
  const [routineExercises, setRoutineExercises] = useState('Barbell Bench Press 4x6\nWeighted Pull-Ups 4x8\nOverhead Press 3x10');

  const [meetupGymId, setMeetupGymId] = useState(user.gym_id || 'gym_train_reem');
  const [meetupTime, setMeetupTime] = useState('Tomorrow at 7:00 PM');
  const [trustedName, setTrustedName] = useState('');
  const [trustedPhone, setTrustedPhone] = useState('');

  const [reportReason, setReportReason] = useState('Harassment in messages');
  const [reportDetails, setReportDetails] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const loadMatchesAndMeetups = useCallback(async () => {
    try {
      const [mRes, mtRes] = await Promise.all([
        api<{ matches: MatchSummary[] }>('/api/matches'),
        api<{ meetups: MeetupSession[] }>('/api/meetups'),
      ]);
      setMatches(mRes.matches);
      setMeetups(mtRes.meetups);
      if (!activeConvoId && mRes.matches.length > 0) {
        setActiveConvoId(mRes.matches[0].conversation_id);
      }
    } catch {
      // Handled gracefully
    }
  }, [activeConvoId]);

  useEffect(() => {
    loadMatchesAndMeetups();
    api<{ gyms: Gym[] }>('/api/gyms').then((r) => setGyms(r.gyms)).catch(() => {});
  }, [loadMatchesAndMeetups]);

  useEffect(() => {
    if (initialConversationId) setActiveConvoId(initialConversationId);
  }, [initialConversationId]);

  const loadMessages = useCallback(async (convoId: string) => {
    try {
      const res = await api<{ messages: ChatMessage[] }>(`/api/conversations/${convoId}/messages`);
      setMessages(res.messages);
      onRefreshMatchesCount();
    } catch {
      // Handled gracefully
    }
  }, [onRefreshMatchesCount]);

  useEffect(() => {
    if (activeConvoId) {
      loadMessages(activeConvoId);
    }
  }, [activeConvoId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, partnerTyping]);

  // Real-time WebSocket listeners
  useEffect(() => {
    if (!wsSocket) return;
    const handler = (ev: MessageEvent) => {
      try {
        const { event, payload } = JSON.parse(ev.data);
        if (event === 'message:new' && payload) {
          if (payload.conversation_id === activeConvoId) {
            setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
            setPartnerTyping(false);
          }
          loadMatchesAndMeetups();
        } else if (event === 'typing' && payload?.conversation_id === activeConvoId) {
          setPartnerTyping(Boolean(payload.is_typing));
        } else if (event === 'message:read' && payload?.conversation_id === activeConvoId) {
          setMessages((prev) =>
            prev.map((m) => (m.sender_id === user.id && !m.read_at ? { ...m, read_at: payload.read_at } : m))
          );
        } else if (event === 'match:unmatched') {
          loadMatchesAndMeetups();
        }
      } catch {
        // Ignore invalid WS frames
      }
    };
    wsSocket.addEventListener('message', handler);
    return () => wsSocket.removeEventListener('message', handler);
  }, [wsSocket, activeConvoId, user.id, loadMatchesAndMeetups]);

  const activeMatch = matches.find((m) => m.conversation_id === activeConvoId) || null;
  const activeMeetups = meetups.filter((m) => activeMatch && m.match_id === activeMatch.match_id && m.status !== 'cancelled');

  function handleDraftChange(val: string) {
    setDraft(val);
    if (wsSocket && wsSocket.readyState === WebSocket.OPEN && activeConvoId) {
      wsSocket.send(JSON.stringify({ event: 'typing', conversation_id: activeConvoId, is_typing: true }));
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        if (wsSocket.readyState === WebSocket.OPEN) {
          wsSocket.send(JSON.stringify({ event: 'typing', conversation_id: activeConvoId, is_typing: false }));
        }
      }, 1500);
    }
  }

  async function sendTextMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !activeConvoId) return;
    const text = draft.trim();
    setError(null);
    setDraft('');
    try {
      await api(`/api/conversations/${activeConvoId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text, message_type: 'text' }),
      });
    } catch (err: any) {
      setDraft(text);
      setError(err?.message || 'Unable to send message.');
    }
  }

  async function sendRoutine(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvoId) return;
    setError(null);
    try {
      const lines = routineExercises
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      await api(`/api/conversations/${activeConvoId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: `Shared Workout Routine: ${routineName}`,
          message_type: 'routine',
          metadata: { name: routineName, exercises: lines },
        }),
      });
      setShowRoutineModal(false);
    } catch (err: any) {
      setError(err?.message || 'Unable to share routine.');
    }
  }

  async function scheduleMeetup(e: React.FormEvent) {
    e.preventDefault();
    if (!activeMatch || !activeConvoId) return;
    setError(null);
    try {
      const res = await api<{ id: string; gym_name: string; gym_area: string }>('/api/meetups', {
        method: 'POST',
        body: JSON.stringify({
          match_id: activeMatch.match_id,
          gym_id: meetupGymId,
          scheduled_for: meetupTime,
          trusted_contact_name: trustedName || undefined,
          trusted_contact_phone: trustedPhone || undefined,
        }),
      });
      await api(`/api/conversations/${activeConvoId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: `Meet Safely Session Proposed: ${res.gym_name} (${res.gym_area}) — ${meetupTime}`,
          message_type: 'session_invite',
          metadata: { meetup_id: res.id, gym_name: res.gym_name, scheduled_for: meetupTime },
        }),
      });
      setShowMeetupModal(false);
      loadMatchesAndMeetups();
    } catch (err: any) {
      setError(err?.message || 'Unable to schedule session.');
    }
  }

  async function handleMeetupAction(id: string, action: 'check_in' | 'check_out' | 'cancel') {
    setError(null);
    try {
      await api(`/api/meetups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      loadMatchesAndMeetups();
    } catch (err: any) {
      setError(err?.message || 'Unable to update session.');
    }
  }

  async function handleUnmatch() {
    if (!activeMatch) return;
    setError(null);
    try {
      await api(`/api/matches/${activeMatch.match_id}/unmatch`, { method: 'POST' });
      setActiveConvoId(null);
      loadMatchesAndMeetups();
    } catch (err: any) {
      setError(err?.message || 'Unable to unmatch.');
    }
  }

  async function handleBlock() {
    if (!activeMatch) return;
    setError(null);
    try {
      await api('/api/safety/block', {
        method: 'POST',
        body: JSON.stringify({ user_id: activeMatch.partner.user_id }),
      });
      setActiveConvoId(null);
      loadMatchesAndMeetups();
    } catch (err: any) {
      setError(err?.message || 'Unable to block user.');
    }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    if (!activeMatch) return;
    setError(null);
    try {
      await api('/api/safety/report', {
        method: 'POST',
        body: JSON.stringify({
          target_user_id: activeMatch.partner.user_id,
          target_type: 'message',
          target_id: activeMatch.conversation_id,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      setShowReportModal(false);
      setFeedback('Report submitted securely to the GYMBUD Safety Team.');
    } catch (err: any) {
      setError(err?.message || 'Unable to submit report.');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Messages</h1>
        <p className="text-sm text-zinc-400">
          Private real-time chat unlocked after mutual matches · Protected by Meet Safely
        </p>
      </div>

      {matches.length === 0 ? (
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-10 text-center space-y-2">
          <h3 className="text-lg font-semibold text-white">No conversations yet</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Only mutually matched training partners can message each other. Like someone in Discover to start connecting.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-white/10 rounded-2xl overflow-hidden bg-[#101214] min-h-[580px]">
          {/* Conversation List */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/10 divide-y divide-white/5 max-h-60 lg:max-h-[640px] overflow-y-auto">
            {matches.map((m) => (
              <button
                key={m.conversation_id}
                type="button"
                onClick={() => setActiveConvoId(m.conversation_id)}
                className={`w-full text-left p-4 flex items-center gap-3 transition-colors cursor-pointer ${
                  activeConvoId === m.conversation_id ? 'bg-[#A3E635]/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="w-12 h-12 rounded-xl overflow-hidden border border-white/10 shrink-0">
                  <ResilientImage src={m.partner.avatar_url} alt={m.partner.display_name} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white truncate">{m.partner.display_name}</span>
                    <span className="font-mono-num text-[11px] text-[#A3E635] shrink-0">
                      {m.compatibility_score}%
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 truncate mt-0.5">
                    {m.last_message ? m.last_message.content : 'Matched — start the conversation'}
                  </div>
                </div>
                {m.unread_count > 0 && (
                  <span className="font-mono-num text-[11px] font-bold px-2 py-0.5 rounded bg-[#A3E635] text-[#070809]">
                    {m.unread_count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Active Chat Thread */}
          <div className="lg:col-span-8 flex flex-col h-[580px] lg:h-[640px]">
            {activeMatch ? (
              <>
                {/* Thread Header */}
                <div className="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-[#0B0D0F]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 shrink-0">
                      <ResilientImage src={activeMatch.partner.avatar_url} alt={activeMatch.partner.display_name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white truncate">{activeMatch.partner.display_name}</span>
                        {activeMatch.partner.verified && <BadgeCheck className="w-4 h-4 text-[#A3E635] shrink-0" />}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {activeMatch.partner.is_online ? 'Online now' : activeMatch.partner.gym_name || activeMatch.partner.city}
                        {partnerTyping ? ' · Typing...' : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowMeetupModal(true)}
                      className="min-h-[38px] px-3 rounded-lg border border-[#A3E635]/40 text-xs font-medium text-[#A3E635] hover:bg-[#A3E635]/10 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Meet Safely
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReportModal(true)}
                      className="min-h-[38px] px-2.5 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white cursor-pointer"
                      title="Report user"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleBlock}
                      className="min-h-[38px] px-2.5 rounded-lg border border-white/10 text-xs text-red-400 hover:bg-red-500/10 cursor-pointer"
                      title="Block user"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleUnmatch}
                      className="min-h-[38px] px-2.5 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-red-400 cursor-pointer"
                      title="Unmatch"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Meet Safely Active Session Bar */}
                {activeMeetups.length > 0 && (
                  <div className="px-5 py-2.5 bg-[#070809] border-b border-white/10 space-y-2">
                    {activeMeetups.slice(0, 2).map((mt) => (
                      <div key={mt.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="text-zinc-300">
                          <span className="text-[#A3E635] font-semibold">Meet Safely:</span> {mt.gym_name} · {mt.scheduled_for}{' '}
                          <span className="font-mono-num text-zinc-400">({mt.status.replace('_', ' ')})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {mt.status === 'scheduled' && (
                            <button
                              type="button"
                              onClick={() => handleMeetupAction(mt.id, 'check_in')}
                              className="px-2.5 py-1 rounded bg-[#A3E635] text-[#070809] font-semibold cursor-pointer"
                            >
                              Check In
                            </button>
                          )}
                          {mt.status === 'checked_in' && (
                            <button
                              type="button"
                              onClick={() => handleMeetupAction(mt.id, 'check_out')}
                              className="px-2.5 py-1 rounded bg-white text-black font-semibold cursor-pointer"
                            >
                              Check Out Safely
                            </button>
                          )}
                          {(mt.status === 'scheduled' || mt.status === 'checked_in') && (
                            <button
                              type="button"
                              onClick={() => handleMeetupAction(mt.id, 'cancel')}
                              className="px-2.5 py-1 rounded border border-white/15 text-zinc-400 hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {feedback && (
                  <div className="px-5 py-2 bg-[#A3E635]/10 text-xs text-[#bef264] border-b border-[#A3E635]/20">
                    {feedback}
                  </div>
                )}
                {error && (
                  <div className="px-5 py-2 bg-red-500/10 text-xs text-red-300 border-b border-red-500/20">
                    {error}
                  </div>
                )}

                {/* Messages Feed */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {messages.length === 0 && (
                    <div className="border border-white/10 rounded-xl bg-[#070809] p-5 space-y-3 text-center">
                      <div className="text-sm font-semibold text-white">
                        You matched with {activeMatch.partner.display_name} ({activeMatch.compatibility_score}% compatibility)
                      </div>
                      <p className="text-xs text-zinc-400">
                        Pick a quick workout opener below or write your own message:
                      </p>
                      <div className="flex flex-wrap justify-center gap-2 pt-1">
                        {[
                          `Hey ${activeMatch.partner.display_name}! Saw our ${activeMatch.compatibility_score}% match — what split are you running this week?`,
                          `Up for a session at ${activeMatch.partner.gym_name || activeMatch.partner.city} this week?`,
                          `Need a spotter on heavy compound day — what times do you usually train?`,
                        ].map((opener) => (
                          <button
                            key={opener}
                            type="button"
                            onClick={() => handleDraftChange(opener)}
                            className="text-left text-xs px-3 py-2 rounded-lg border border-white/15 bg-[#101214] text-zinc-200 hover:border-[#A3E635]/60 cursor-pointer"
                          >
                            {opener}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((msg) => {
                    const isMine = msg.sender_id === user.id;
                    return (
                      <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm ${
                            isMine
                              ? 'bg-[#A3E635] text-[#070809]'
                              : 'bg-[#171A1F] text-zinc-100 border border-white/10'
                          }`}
                        >
                          {msg.message_type === 'routine' && msg.metadata && (
                            <div className="mb-2 pb-2 border-b border-current/20">
                              <div className="text-xs font-bold flex items-center gap-1.5">
                                <Dumbbell className="w-3.5 h-3.5" />
                                {String(msg.metadata.name || 'Workout Routine')}
                              </div>
                              {Array.isArray(msg.metadata.exercises) && (
                                <ul className="mt-1.5 space-y-0.5 text-xs opacity-90 font-mono-num">
                                  {msg.metadata.exercises.map((ex: unknown, idx: number) => (
                                    <li key={idx}>· {String(ex)}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {msg.message_type === 'session_invite' && (
                            <div className="mb-1 text-xs font-bold flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5" />
                              Public Gym Session Invite
                            </div>
                          )}

                          <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          <div
                            className={`mt-1 flex items-center justify-end gap-1 text-[10px] font-mono-num ${
                              isMine ? 'text-[#070809]/70' : 'text-zinc-500'
                            }`}
                          >
                            <span>
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isMine && msg.read_at && <CheckCheck className="w-3 h-3" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                <form onSubmit={sendTextMessage} className="p-3 sm:p-4 border-t border-white/10 bg-[#0B0D0F] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRoutineModal(true)}
                    title="Share Workout Routine"
                    className="min-w-[44px] min-h-[44px] rounded-xl border border-white/15 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/5 cursor-pointer shrink-0"
                  >
                    <Dumbbell className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    placeholder="Message your training partner..."
                    className="flex-1 h-11 px-4 rounded-xl bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    className="min-w-[44px] min-h-[44px] px-4 rounded-xl bg-[#A3E635] text-[#070809] font-semibold text-xs inline-flex items-center justify-center gap-1.5 hover:bg-[#bef264] disabled:opacity-40 cursor-pointer shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
                Select a conversation
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share Workout Routine Modal */}
      {showRoutineModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={sendRoutine} className="w-full max-w-md border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-4">
            <h3 className="font-display text-2xl font-bold text-white">Share Workout Routine</h3>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Routine Name</label>
              <input
                type="text"
                required
                value={routineName}
                onChange={(e) => setRoutineName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Exercises (one per line)</label>
              <textarea
                rows={4}
                required
                value={routineExercises}
                onChange={(e) => setRoutineExercises(e.target.value)}
                className="w-full p-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white font-mono-num"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowRoutineModal(false)} className="px-4 py-2 text-xs text-zinc-400 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="px-5 py-2.5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer">
                Send Routine
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Meet Safely Modal */}
      {showMeetupModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={scheduleMeetup} className="w-full max-w-md border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-4">
            <div>
              <div className="text-xs font-semibold text-[#A3E635]">Meet Safely</div>
              <h3 className="font-display text-2xl font-bold text-white mt-0.5">Suggest a Public Gym Session</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Always choose public, staffed gyms for first workouts. Location sharing is never forced.
              </p>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Public Gym Location</label>
              <select
                value={meetupGymId}
                onChange={(e) => setMeetupGymId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              >
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} · {g.area}, {g.city}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Proposed Date &amp; Time</label>
              <input
                type="text"
                required
                value={meetupTime}
                onChange={(e) => setMeetupTime(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
              />
            </div>
            <div className="border-t border-white/10 pt-3 space-y-2">
              <div className="text-xs font-medium text-zinc-300">Optional Trusted Contact Check-In</div>
              <input
                type="text"
                value={trustedName}
                onChange={(e) => setTrustedName(e.target.value)}
                placeholder="Trusted friend/family name (optional)"
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              />
              <input
                type="tel"
                value={trustedPhone}
                onChange={(e) => setTrustedPhone(e.target.value)}
                placeholder="Trusted contact phone (optional)"
                className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowMeetupModal(false)} className="px-4 py-2 text-xs text-zinc-400 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="px-5 py-2.5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer">
                Propose Meetup
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleReport} className="w-full max-w-md border border-white/15 rounded-2xl bg-[#101214] p-6 space-y-4">
            <h3 className="font-display text-2xl font-bold text-white">Report Conversation</h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
            >
              <option>Harassment in messages</option>
              <option>Spam or unwanted solicitation</option>
              <option>Safety concern or threatening behavior</option>
              <option>Impersonation</option>
            </select>
            <textarea
              rows={3}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Describe what happened..."
              className="w-full p-3 rounded-lg bg-[#070809] border border-white/15 text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowReportModal(false)} className="px-4 py-2 text-xs text-zinc-400 cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="px-5 py-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer">
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
