import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MapPin, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { GYM_ENVIRONMENTS } from '../shared/constants.ts';

export function AdminDashboardView() {
  const [tab, setTab] = useState<'users' | 'reports' | 'verifications' | 'posts' | 'gyms' | 'subscriptions' | 'guidelines' | 'audit'>('reports');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [guidelinesText, setGuidelinesText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [gymName, setGymName] = useState('');
  const [gymArea, setGymArea] = useState('');
  const [gymCity, setGymCity] = useState('Abu Dhabi');
  const [gymCountry, setGymCountry] = useState('UAE');
  const [gymCategory, setGymCategory] = useState<string>('Strength & Barbell Club');

  const loadAdmin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<any>('/api/admin/overview');
      setData(res);
      setGuidelinesText((res.guidelines || []).join('\n'));
    } catch (err: any) {
      setError(err?.message || 'Unable to load admin console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin]);

  async function setUserStatus(userId: string, account_status: 'active' | 'suspended' | 'banned') {
    try {
      await api(`/api/admin/users/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ account_status, reason: `Admin action: ${account_status}` }),
      });
      setFeedback(`Account updated to ${account_status}.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to update user status.');
    }
  }

  async function reviewVerification(id: string, decision: 'approved' | 'rejected') {
    try {
      await api(`/api/admin/verifications/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: decision === 'approved' ? 'Verified clear pose' : 'Please upload a clearer photo' }),
      });
      setFeedback(`Verification ${decision}.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to review verification.');
    }
  }

  async function resolveReport(id: string, status: 'resolved' | 'dismissed', remove_post = false) {
    try {
      await api(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status, resolution_notes: `Reviewed by admin (${status})`, remove_post }),
      });
      setFeedback(`Report marked ${status}.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to resolve report.');
    }
  }

  async function moderatePost(postId: string, moderation_status: 'published' | 'removed') {
    try {
      await api(`/api/admin/posts/${postId}/moderate`, {
        method: 'POST',
        body: JSON.stringify({ moderation_status }),
      });
      setFeedback(`Post marked ${moderation_status}.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to moderate post.');
    }
  }

  async function setUserRole(userId: string, role: 'member' | 'moderator' | 'admin') {
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      setFeedback(`User role updated to ${role}.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to update user role.');
    }
  }

  async function addGym(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/admin/gyms', {
        method: 'POST',
        body: JSON.stringify({
          name: gymName,
          area: gymArea,
          city: gymCity,
          country: gymCountry,
          category: gymCategory,
        }),
      });
      setGymName('');
      setGymArea('');
      setFeedback(`Added "${gymName}" to the live gym directory.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to add gym.');
    }
  }

  async function deleteGym(gymId: string, name: string) {
    try {
      await api(`/api/admin/gyms/${gymId}`, { method: 'DELETE' });
      setFeedback(`Removed "${name}" from the gym directory.`);
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to remove gym.');
    }
  }

  async function saveGuidelines(e: React.FormEvent) {
    e.preventDefault();
    try {
      const lines = guidelinesText.split('\n').map((l) => l.trim()).filter(Boolean);
      await api('/api/admin/guidelines', {
        method: 'PUT',
        body: JSON.stringify({ guidelines: lines }),
      });
      setFeedback('Community guidelines published.');
      loadAdmin();
    } catch (err: any) {
      setFeedback(err?.message || 'Unable to save guidelines.');
    }
  }

  const filteredUsers = useMemo(() => {
    const allUsers = data?.users || [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(
      (u: any) =>
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.city || '').toLowerCase().includes(q)
    );
  }, [data?.users, userSearch]);

  if (loading) {
    return <div className="h-64 rounded-2xl border border-white/10 bg-[#101214] animate-pulse" />;
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-2xl border border-red-500/30 bg-[#101214] text-red-300 text-sm">
        {error || 'Access denied.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">Trust, Safety &amp; Admin Console</h1>
        <p className="text-sm text-zinc-400">
          Role-restricted moderation workspace · All administrative actions are logged to the audit trail
        </p>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Users', value: data.stats.total_users },
          { label: 'Active Matches', value: data.stats.active_matches },
          { label: 'Open Reports', value: data.stats.open_reports },
          { label: 'Pending Checks', value: data.stats.pending_verifications },
          { label: 'Active GYMBUD+', value: data.stats.active_plus_subs },
          { label: 'Revenue (AED)', value: data.stats.total_revenue_aed },
        ].map((kpi) => (
          <div key={kpi.label} className="border border-white/10 rounded-xl bg-[#101214] p-4">
            <div className="text-xs text-zinc-400">{kpi.label}</div>
            <div className="font-mono-num text-2xl font-bold text-white mt-1">{kpi.value}</div>
          </div>
        ))}
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264]">
          {feedback}
        </div>
      )}

      {/* Segmented Console Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'reports', label: `Reports (${data.reports.length})` },
          { id: 'verifications', label: `Verifications (${data.verifications.length})` },
          { id: 'users', label: `Users (${data.users.length})` },
          { id: 'posts', label: `Posts (${(data.posts || []).length})` },
          { id: 'gyms', label: `Gyms (${(data.gyms || []).length})` },
          { id: 'subscriptions', label: `Subscriptions (${data.subscriptions.length})` },
          { id: 'guidelines', label: 'Guidelines' },
          { id: 'audit', label: 'Audit Logs' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as any)}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
              tab === t.id ? 'bg-[#A3E635] text-[#070809]' : 'bg-[#101214] text-zinc-400 border border-white/10 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="border border-white/10 rounded-2xl bg-[#101214] p-5 sm:p-6 overflow-x-auto">
        {tab === 'reports' && (
          <div className="space-y-3">
            {data.reports.length === 0 ? (
              <p className="text-sm text-zinc-500">No safety reports filed.</p>
            ) : (
              data.reports.map((r: any) => (
                <div key={r.id} className="p-4 rounded-xl bg-[#070809] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-white">
                      {r.target_name} · <span className="text-[#A3E635] uppercase font-mono-num">{r.status}</span>
                    </div>
                    <div className="text-zinc-300">
                      Reported by {r.reporter_name} ({r.target_type}): {r.reason}
                    </div>
                    {r.details && <div className="text-zinc-400">{r.details}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => resolveReport(r.id, 'resolved', r.target_type === 'post')}
                      className="px-3 py-1.5 rounded-lg bg-[#A3E635] text-[#070809] font-semibold cursor-pointer"
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveReport(r.id, 'dismissed')}
                      className="px-3 py-1.5 rounded-lg border border-white/15 text-zinc-300 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'verifications' && (
          <div className="space-y-3">
            {data.verifications.length === 0 ? (
              <p className="text-sm text-zinc-500">No pending selfie verification requests.</p>
            ) : (
              data.verifications.map((v: any) => (
                <div key={v.id} className="p-4 rounded-xl bg-[#070809] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                  <div className="flex items-center gap-3">
                    {v.artifact_ref?.startsWith('/api/uploads/') && (
                      <img src={v.artifact_ref} alt={v.display_name} className="w-14 h-14 rounded-lg object-cover border border-white/10" />
                    )}
                    <div>
                      <div className="font-semibold text-white">{v.display_name} ({v.email})</div>
                      <div className="text-zinc-400">Status: {v.status} · {v.notes}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => reviewVerification(v.id, 'approved')}
                      className="px-3 py-1.5 rounded-lg bg-[#A3E635] text-[#070809] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewVerification(v.id, 'rejected')}
                      className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search members by name, email, or city..."
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-white"
              />
            </div>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  <th className="py-2 pr-4">Member</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Verified</th>
                  <th className="py-2 pr-4">Risk Score</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredUsers.map((u: any) => {
                  const isOwner = u.email.toLowerCase() === (data.owner_email || 'yusufaguilar2008@gmail.com');
                  return (
                  <tr key={u.id}>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-white">{u.display_name} ({u.age})</div>
                      <div className="text-zinc-400">{u.email} · {u.city}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={u.role}
                        disabled={isOwner}
                        onChange={(e) => setUserRole(u.id, e.target.value as 'member' | 'moderator' | 'admin')}
                        className="h-8 px-2 rounded bg-[#070809] border border-white/15 text-xs uppercase font-mono-num text-zinc-200 disabled:opacity-60"
                      >
                        <option value="member">member</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-zinc-300">
                      {u.email_verified && u.phone_verified ? 'Verified' : 'Partial/None'}
                    </td>
                    <td className="py-3 pr-4 font-mono-num text-zinc-300">{u.suspicious_score}</td>
                    <td className="py-3 pr-4 font-mono-num uppercase text-[#A3E635]">{u.account_status}</td>
                    <td className="py-3 text-right space-x-1.5 whitespace-nowrap">
                      {u.role !== 'admin' && (
                        <>
                          {u.account_status !== 'active' && (
                            <button type="button" onClick={() => setUserStatus(u.id, 'active')} className="px-2.5 py-1 rounded border border-white/15 text-zinc-200 cursor-pointer">
                              Reinstate
                            </button>
                          )}
                          {u.account_status === 'active' && (
                            <button type="button" onClick={() => setUserStatus(u.id, 'suspended')} className="px-2.5 py-1 rounded border border-amber-500/40 text-amber-300 cursor-pointer">
                              Suspend
                            </button>
                          )}
                          {u.account_status !== 'banned' && (
                            <button type="button" onClick={() => setUserStatus(u.id, 'banned')} className="px-2.5 py-1 rounded border border-red-500/40 text-red-400 cursor-pointer">
                              Ban
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'posts' && (
          <div className="space-y-3">
            {(data.posts || []).length === 0 ? (
              <p className="text-sm text-zinc-500">No community posts submitted yet.</p>
            ) : (
              (data.posts || []).map((p: any) => (
                <div key={p.id} className="p-4 rounded-xl bg-[#070809] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-white">
                      {p.title} · <span className={`uppercase font-mono-num ${p.moderation_status === 'published' ? 'text-[#A3E635]' : 'text-red-400'}`}>{p.moderation_status}</span>
                    </div>
                    <div className="text-zinc-400">
                      {p.author_name} ({p.author_email}) · {p.category}
                    </div>
                    <p className="text-zinc-300 line-clamp-2">{p.body}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {p.moderation_status === 'published' ? (
                      <button
                        type="button"
                        onClick={() => moderatePost(p.id, 'removed')}
                        className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        Remove Post
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => moderatePost(p.id, 'published')}
                        className="px-3 py-1.5 rounded-lg bg-[#A3E635] text-[#070809] font-semibold cursor-pointer"
                      >
                        Restore Post
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'gyms' && (
          <div className="space-y-6">
            <form onSubmit={addGym} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 p-4 rounded-xl bg-[#070809] border border-white/10">
              <input
                type="text"
                required
                value={gymName}
                onChange={(e) => setGymName(e.target.value)}
                placeholder="Gym Name"
                className="h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white"
              />
              <input
                type="text"
                required
                value={gymArea}
                onChange={(e) => setGymArea(e.target.value)}
                placeholder="Area / District"
                className="h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white"
              />
              <input
                type="text"
                required
                value={gymCity}
                onChange={(e) => setGymCity(e.target.value)}
                placeholder="City"
                className="h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white"
              />
              <input
                type="text"
                required
                value={gymCountry}
                onChange={(e) => setGymCountry(e.target.value)}
                placeholder="Country"
                className="h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white"
              />
              <select
                value={gymCategory}
                onChange={(e) => setGymCategory(e.target.value)}
                className="h-10 px-3 rounded-lg bg-[#101214] border border-white/15 text-xs text-white"
              >
                {GYM_ENVIRONMENTS.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button
                type="submit"
                className="h-10 px-4 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Gym
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(data.gyms || []).map((g: any) => (
                <div key={g.id} className="p-3.5 rounded-xl bg-[#070809] border border-white/10 text-xs flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-white truncate">{g.name}</div>
                    <div className="text-zinc-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#A3E635] shrink-0" />
                      <span className="truncate">{g.area} · {g.city}, {g.country}</span>
                    </div>
                    <div className="text-zinc-500">{g.category}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteGym(g.id, g.name)}
                    aria-label={`Remove ${g.name}`}
                    title="Remove gym"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'subscriptions' && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="py-2 pr-4">Member</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 text-right">Period End</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.subscriptions.length === 0 ? (
                <tr><td colSpan={5} className="py-4 text-zinc-500">No active subscriptions recorded yet.</td></tr>
              ) : (
                data.subscriptions.map((s: any) => (
                  <tr key={s.id}>
                    <td className="py-3 pr-4 text-white">{s.display_name} ({s.email})</td>
                    <td className="py-3 pr-4 font-mono-num text-zinc-300">{s.plan_id}</td>
                    <td className="py-3 pr-4 text-zinc-400">{s.provider}</td>
                    <td className="py-3 pr-4 text-[#A3E635] uppercase font-mono-num">{s.status}</td>
                    <td className="py-3 text-right font-mono-num text-zinc-400">{new Date(s.current_period_end).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {tab === 'guidelines' && (
          <form onSubmit={saveGuidelines} className="space-y-4">
            <div className="text-xs text-zinc-400">One guideline per line. Updates immediately in Safety Center.</div>
            <textarea
              rows={7}
              value={guidelinesText}
              onChange={(e) => setGuidelinesText(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-[#070809] border border-white/15 text-sm text-white"
            />
            <button type="submit" className="px-5 py-2.5 rounded-lg bg-[#A3E635] text-[#070809] text-xs font-semibold cursor-pointer">
              Publish Guidelines
            </button>
          </form>
        )}

        {tab === 'audit' && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Target</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.audit_logs.length === 0 ? (
                <tr><td colSpan={5} className="py-4 text-zinc-500">No audit entries yet.</td></tr>
              ) : (
                data.audit_logs.map((log: any) => (
                  <tr key={log.id}>
                    <td className="py-2.5 pr-4 font-mono-num text-zinc-400">{log.created_at}</td>
                    <td className="py-2.5 pr-4 text-white">{log.actor_name}</td>
                    <td className="py-2.5 pr-4 font-mono-num text-[#A3E635]">{log.action}</td>
                    <td className="py-2.5 pr-4 font-mono-num text-zinc-300">{log.target_type}:{log.target_id}</td>
                    <td className="py-2.5 font-mono-num text-zinc-400">{log.details_json}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
