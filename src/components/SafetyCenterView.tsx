import { useCallback, useEffect, useState } from 'react';
import { Bell, Lock, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CurrentUser } from '../shared/types.ts';

interface SafetyCenterViewProps {
  user: CurrentUser;
  onUpdated: (user: CurrentUser) => void;
  onAccountDeleted: () => void;
}

export function SafetyCenterView({ user, onUpdated, onAccountDeleted }: SafetyCenterViewProps) {
  const [blockedUsers, setBlockedUsers] = useState<{ blocked_id: string; display_name: string; city: string; created_at: string }[]>([]);
  const [reports, setReports] = useState<{ id: string; target_type: string; reason: string; status: string; target_name: string; created_at: string }[]>([]);
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    matches: true,
    likes: true,
    messages: true,
    meetups: true,
    billing: true,
    security: true,
    preview_message_content: false,
  });

  const [privacy, setPrivacy] = useState(user.privacy);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadSafety = useCallback(async () => {
    try {
      const [sRes, nRes] = await Promise.all([
        api<any>('/api/safety/overview'),
        api<any>('/api/notifications'),
      ]);
      setBlockedUsers(sRes.blocked_users || []);
      setReports(sRes.reports || []);
      setGuidelines(sRes.guidelines || []);
      if (nRes.preferences) {
        setNotifPrefs({
          matches: Boolean(nRes.preferences.matches),
          likes: Boolean(nRes.preferences.likes),
          messages: Boolean(nRes.preferences.messages),
          meetups: Boolean(nRes.preferences.meetups),
          billing: Boolean(nRes.preferences.billing),
          security: Boolean(nRes.preferences.security),
          preview_message_content: Boolean(nRes.preferences.preview_message_content),
        });
      }
    } catch {
      // Handled gracefully
    }
  }, []);

  useEffect(() => {
    loadSafety();
  }, [loadSafety]);

  async function savePrivacy(next: typeof privacy) {
    setPrivacy(next);
    const res = await api<{ user: CurrentUser }>('/api/profile/me', {
      method: 'PUT',
      body: JSON.stringify({ privacy: next }),
    });
    onUpdated(res.user);
    setFeedback('Privacy settings saved.');
  }

  async function saveNotifPrefs(next: typeof notifPrefs) {
    setNotifPrefs(next);
    await api('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    setFeedback('Notification preferences updated.');
  }

  async function unblockUser(uid: string) {
    await api(`/api/safety/block/${uid}`, { method: 'DELETE' });
    loadSafety();
    setFeedback('User unblocked.');
  }

  async function deleteAccount() {
    await api('/api/account/me', { method: 'DELETE' });
    onAccountDeleted();
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Safety Center &amp; Privacy</h1>
        <p className="text-sm text-zinc-400">
          Every safety, privacy, and moderation tool on GYMBUD is permanently free for all members.
        </p>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Privacy Controls */}
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-[#A3E635]" />
            Location &amp; Profile Privacy
          </h2>
          <div className="space-y-3 text-sm">
            {[
              { key: 'discoverable' as const, label: 'Allow my profile to appear in Discover' },
              { key: 'hide_gym' as const, label: 'Hide my preferred gym name from non-matches' },
              { key: 'hide_distance' as const, label: 'Hide approximate distance (km)' },
              { key: 'hide_schedule' as const, label: 'Hide exact training days & times from strangers' },
              { key: 'show_online' as const, label: 'Show online / recently active status' },
              { key: 'read_receipts' as const, label: 'Send & show message read receipts' },
              { key: 'profile_visits' as const, label: 'Include my profile visits in analytics' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0 cursor-pointer">
                <span className="text-zinc-200">{item.label}</span>
                <input
                  type="checkbox"
                  checked={privacy[item.key]}
                  onChange={(e) => savePrivacy({ ...privacy, [item.key]: e.target.checked })}
                  className="w-5 h-5 accent-[#A3E635]"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Notification Privacy Preferences */}
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#A3E635]" />
            Notification Preferences
          </h2>
          <div className="space-y-3 text-sm">
            {[
              { key: 'matches', label: 'New mutual match alerts' },
              { key: 'likes', label: 'Incoming like alerts' },
              { key: 'messages', label: 'New message notifications' },
              { key: 'meetups', label: 'Meet Safely session reminders' },
              { key: 'billing', label: 'Subscription & billing updates' },
              { key: 'security', label: 'Verification & security alerts' },
              { key: 'preview_message_content', label: 'Include message text in notifications (off by default for privacy)' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0 cursor-pointer">
                <span className="text-zinc-200">{item.label}</span>
                <input
                  type="checkbox"
                  checked={notifPrefs[item.key]}
                  onChange={(e) => saveNotifPrefs({ ...notifPrefs, [item.key]: e.target.checked })}
                  className="w-5 h-5 accent-[#A3E635]"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Blocked Users & Report History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <UserX className="w-5 h-5 text-[#A3E635]" />
            Blocked Accounts ({blockedUsers.length})
          </h2>
          {blockedUsers.length === 0 ? (
            <p className="text-sm text-zinc-500">You have not blocked any accounts.</p>
          ) : (
            <div className="space-y-2.5">
              {blockedUsers.map((b) => (
                <div key={b.blocked_id} className="flex items-center justify-between p-3 rounded-xl bg-[#070809] border border-white/10 text-sm">
                  <div>
                    <div className="font-semibold text-white">{b.display_name}</div>
                    <div className="text-xs text-zinc-400">{b.city}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => unblockUser(b.blocked_id)}
                    className="px-3 py-1.5 rounded-lg border border-white/15 text-xs text-zinc-300 hover:text-white cursor-pointer"
                  >
                    Unblock
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#A3E635]" />
            Your Reporting History ({reports.length})
          </h2>
          {reports.length === 0 ? (
            <p className="text-sm text-zinc-500">No safety reports filed.</p>
          ) : (
            <div className="space-y-2.5">
              {reports.map((r) => (
                <div key={r.id} className="p-3 rounded-xl bg-[#070809] border border-white/10 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{r.target_name} ({r.target_type})</span>
                    <span className="text-[#A3E635] uppercase font-mono-num">{r.status}</span>
                  </div>
                  <div className="text-zinc-400">{r.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Community Guidelines & Emergency Safety Guidance */}
      <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 space-y-4">
        <h2 className="font-display text-2xl font-bold text-white">Community Guidelines &amp; Emergency Resources</h2>
        <ul className="space-y-2 text-sm text-zinc-300">
          {guidelines.map((g, i) => (
            <li key={i} className="pb-2 border-b border-white/5 last:border-0">
              <span className="font-mono-num text-[#A3E635] mr-2">0{i + 1}.</span>
              {g}
            </li>
          ))}
        </ul>
        <div className="p-4 rounded-xl bg-[#070809] border border-white/10 text-xs text-zinc-300 space-y-1">
          <div className="font-semibold text-white">UAE Emergency &amp; Gym Meetup Guidance</div>
          <p>
            Always arrange first-time workout sessions at staffed public gyms during active hours.
            In any immediate emergency in the UAE, contact Police at <span className="font-mono-num text-white">999</span> or Ambulance at{' '}
            <span className="font-mono-num text-white">998</span>, and notify gym front-desk staff immediately.
          </p>
        </div>
      </div>

      {/* Account Deletion */}
      <div className="border border-red-500/30 rounded-2xl bg-[#101214] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" />
            Permanent Account Deletion
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Permanently deletes your profile, preferences, matches, messages, and verification records.
          </p>
        </div>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-[42px] px-4 rounded-lg border border-red-500/40 text-xs font-semibold text-red-400 hover:bg-red-500/10 cursor-pointer shrink-0"
          >
            Delete My Account
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-xs text-zinc-400 cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteAccount}
              className="min-h-[42px] px-4 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 cursor-pointer"
            >
              Confirm Permanent Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
