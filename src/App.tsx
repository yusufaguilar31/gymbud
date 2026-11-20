import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Compass,
  CreditCard,
  Dna,
  Heart,
  LogOut,
  Menu,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  X,
} from 'lucide-react';
import { api, clearSessionToken, getSessionToken } from './lib/api.ts';
import type { CurrentUser, NotificationItem } from './shared/types.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { OnboardingFlow } from './components/OnboardingFlow.tsx';
import { DiscoverView } from './components/DiscoverView.tsx';
import { LikesView, MatchesView } from './components/LikesAndMatchesView.tsx';
import { MessagesView } from './components/MessagesView.tsx';
import { WorkoutDnaView } from './components/WorkoutDnaView.tsx';
import { CommunityView } from './components/CommunityView.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { SubscriptionAndBillingView } from './components/SubscriptionAndBillingView.tsx';
import { SafetyCenterView } from './components/SafetyCenterView.tsx';
import { AdminDashboardView } from './components/AdminDashboardView.tsx';

type ActiveView =
  | 'discover'
  | 'likes'
  | 'matches'
  | 'messages'
  | 'profile'
  | 'community'
  | 'dna'
  | 'billing'
  | 'safety'
  | 'admin';

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [publicMode, setPublicMode] = useState<'landing' | 'login' | 'register' | 'reset'>('landing');
  const [initialResetToken, setInitialResetToken] = useState<string | null>(null);
  const [initialResetTokenKind, setInitialResetTokenKind] = useState<'token' | 'token_hash'>('token');
  const [initialResetEmail, setInitialResetEmail] = useState<string | null>(null);
  const [initialResetError, setInitialResetError] = useState<string | null>(null);
  const [view, setView] = useState<ActiveView>('discover');
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [discoverRefreshTick, setDiscoverRefreshTick] = useState(0);

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const [wsSocket, setWsSocket] = useState<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const res = await api<{
        user: CurrentUser;
        unread_notifications: number;
        unread_messages: number;
      }>('/api/auth/me');
      setUser(res.user);
      setUnreadNotifications(res.unread_notifications || 0);
      setUnreadMessages(res.unread_messages || 0);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    const isResetPath =
      window.location.pathname === '/reset-password' || window.location.pathname === '/reset-password/';
    const params = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hashRaw);

    const sbAccessToken = hashParams.get('access_token');
    const sbTokenHash = params.get('token_hash');
    const sbType = hashParams.get('type') || params.get('type');
    const sbError = hashParams.get('error_description') || params.get('error_description');

    const resetTok =
      sbType === 'recovery' && sbAccessToken
        ? sbAccessToken
        : sbType === 'recovery' && sbTokenHash
          ? sbTokenHash
          : (params.get('reset_token') || params.get('token'));
    const resetKind: 'token' | 'token_hash' =
      sbType === 'recovery' && !sbAccessToken && sbTokenHash ? 'token_hash' : 'token';
    const resetEm = params.get('email');

    if (resetTok) {
      setInitialResetToken(resetTok);
      setInitialResetTokenKind(resetKind);
      if (resetEm) setInitialResetEmail(resetEm);
      setInitialResetError(null);
      setPublicMode('reset');
      params.delete('reset_token');
      params.delete('token');
      params.delete('token_hash');
      params.delete('email');
      params.delete('type');
      const remaining = params.toString();
      window.history.replaceState({}, '', remaining ? `/reset-password?${remaining}` : '/reset-password');
    } else if (sbError && (hashParams.has('error') || params.has('error'))) {
      setInitialResetError(sbError.replace(/\+/g, ' '));
      setPublicMode('reset');
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      const remaining = params.toString();
      window.history.replaceState({}, '', remaining ? `/reset-password?${remaining}` : '/reset-password');
    } else if (isResetPath) {
      setPublicMode('reset');
    }
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onUnauthorized = () => {
      clearSessionToken();
      setUser(null);
      setPublicMode('login');
    };
    window.addEventListener('gymbud:unauthorized', onUnauthorized);
    return () => window.removeEventListener('gymbud:unauthorized', onUnauthorized);
  }, []);

  // Persistent real-time WebSocket connection
  useEffect(() => {
    if (!user) {
      if (wsSocket) wsSocket.close();
      setWsSocket(null);
      return;
    }

    const currentUserId = user.id;
    let cancelled = false;
    let failedAttempts = 0;

    function connect() {
      if (cancelled) return;
      const apiBase = ((import.meta as any).env?.VITE_API_BASE_URL || '').trim();
      let wsOrigin: string;
      if (apiBase && /^https?:\/\//i.test(apiBase)) {
        const parsed = new URL(apiBase);
        wsOrigin = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsOrigin = `${proto}//${window.location.host}`;
      }
      const token = getSessionToken();
      const wsUrl = token
        ? `${wsOrigin}/ws?token=${encodeURIComponent(token)}`
        : `${wsOrigin}/ws`;
      const sock = new WebSocket(wsUrl);
      let opened = false;

      sock.onopen = () => {
        opened = true;
        failedAttempts = 0;
        if (!cancelled) setWsSocket(sock);
      };

      sock.onmessage = (ev) => {
        try {
          const { event, payload } = JSON.parse(ev.data);
          if (event === 'notification:new' && payload) {
            setUnreadNotifications((c) => c + 1);
            setNotifications((prev) => [payload, ...prev]);
          } else if (event === 'message:new' && payload && payload.sender_id !== currentUserId) {
            setUnreadMessages((c) => c + 1);
          } else if (event === 'match:created') {
            refreshMe();
          } else if (event === 'discover:updated') {
            setDiscoverRefreshTick((t) => t + 1);
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      sock.onclose = () => {
        if (!cancelled) {
          setWsSocket(null);
          if (!opened) {
            failedAttempts += 1;
            if (failedAttempts >= 3) return;
          }
          reconnectTimerRef.current = window.setTimeout(connect, opened ? 2500 : 5000);
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    };
  }, [user?.id, refreshMe]);

  async function openNotifications() {
    setShowNotifDrawer(true);
    try {
      const res = await api<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications);
      await api('/api/notifications/read-all', { method: 'POST' });
      setUnreadNotifications(0);
    } catch {
      // Ignore transient errors
    }
  }

  async function handleLogout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session regardless
    }
    clearSessionToken();
    setUser(null);
    setPublicMode('landing');
    setView('discover');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070809] flex items-center justify-center text-zinc-400 text-sm">
        Loading GYMBUD...
      </div>
    );
  }

  if (!user || publicMode === 'reset') {
    if (!user && publicMode === 'landing') {
      return <LandingPage onGetStarted={(mode) => setPublicMode(mode)} />;
    }
    return (
      <AuthScreen
        initialMode={publicMode === 'landing' ? 'login' : publicMode}
        initialResetToken={initialResetToken}
        initialResetTokenKind={initialResetTokenKind}
        initialResetEmail={initialResetEmail}
        initialResetError={initialResetError}
        onBack={() => {
          setInitialResetToken(null);
          setInitialResetTokenKind('token');
          setInitialResetEmail(null);
          setInitialResetError(null);
          setPublicMode('landing');
          if (window.location.pathname.startsWith('/reset-password')) {
            window.history.replaceState({}, '', '/');
          }
        }}
        onAuthenticated={(loggedInUser) => {
          setInitialResetToken(null);
          setInitialResetTokenKind('token');
          setInitialResetEmail(null);
          setInitialResetError(null);
          setPublicMode('landing');
          if (window.location.pathname.startsWith('/reset-password')) {
            window.history.replaceState({}, '', '/');
          }
          setUser(loggedInUser);
          setView(loggedInUser.role === 'admin' ? 'admin' : 'discover');
        }}
      />
    );
  }

  if (!user.onboarding_completed) {
    return (
      <OnboardingFlow
        user={user}
        onComplete={(updatedUser) => {
          setUser(updatedUser);
          setView('discover');
        }}
      />
    );
  }

  const primaryBottomTabs = [
    { id: 'discover' as const, label: 'Discover', icon: Compass },
    { id: 'likes' as const, label: 'Likes', icon: Heart },
    { id: 'matches' as const, label: 'Matches', icon: Sparkles },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare, badge: unreadMessages },
    { id: 'profile' as const, label: 'Profile', icon: User },
  ];

  const secondaryNavItems = [
    { id: 'community' as const, label: 'Gym Community', icon: Users },
    { id: 'dna' as const, label: 'Workout DNA', icon: Dna },
    { id: 'billing' as const, label: 'GYMBUD+ & Billing', icon: CreditCard },
    { id: 'safety' as const, label: 'Safety Center', icon: ShieldCheck },
    ...(user.role === 'admin' || user.role === 'moderator'
      ? [{ id: 'admin' as const, label: 'Admin Console', icon: ShieldAlert }]
      : []),
  ];

  function navigateTo(nextView: ActiveView) {
    setView(nextView);
    setShowMobileDrawer(false);
    setShowNotifDrawer(false);
  }

  return (
    <div className="min-h-screen bg-[#070809] text-zinc-100 flex">
      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-white/10 bg-[#0A0C0E] p-5 justify-between">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <button
              type="button"
              onClick={() => navigateTo('discover')}
              className="font-display text-2xl font-extrabold tracking-tight text-white cursor-pointer"
            >
              GYMBUD
            </button>
            {user.is_plus && (
              <span className="text-[11px] font-semibold text-[#A3E635]">PLUS</span>
            )}
          </div>

          <nav className="space-y-1">
            {primaryBottomTabs.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl text-sm font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    active ? 'bg-[#A3E635] text-[#070809] font-semibold' : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </span>
                  {item.badge ? (
                    <span className={`font-mono-num text-xs font-bold px-2 py-0.5 rounded ${active ? 'bg-[#070809] text-[#A3E635]' : 'bg-[#A3E635] text-[#070809]'}`}>
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-white/10 space-y-1">
            {secondaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full min-h-[42px] px-3.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                    active ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={openNotifications}
            className="w-full min-h-[42px] px-3.5 rounded-xl text-sm text-zinc-300 hover:bg-white/5 flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-3">
              <Bell className="w-4 h-4" />
              Notifications
            </span>
            {unreadNotifications > 0 && (
              <span className="font-mono-num text-xs font-bold px-2 py-0.5 rounded bg-[#A3E635] text-[#070809]">
                {unreadNotifications}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[42px] px-3.5 rounded-xl text-sm text-zinc-400 hover:text-white hover:bg-white/5 flex items-center gap-3 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Mobile Compact Top App Bar (h-14) */}
        <header className="lg:hidden sticky top-0 z-30 h-14 px-4 bg-[#070809]/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowMobileDrawer(true)}
            aria-label="Open menu"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-300 cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-display text-xl font-extrabold text-white tracking-tight">GYMBUD</span>
          <button
            type="button"
            onClick={openNotifications}
            aria-label="Notifications"
            className="relative min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-300 cursor-pointer"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifications > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#A3E635]" />
            )}
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-10">
          {view === 'discover' && (
            <DiscoverView
              user={user}
              refreshTick={discoverRefreshTick}
              onOpenMessages={() => navigateTo('messages')}
              onOpenUpgrade={() => navigateTo('billing')}
            />
          )}
          {view === 'likes' && (
            <LikesView
              user={user}
              onOpenUpgrade={() => navigateTo('billing')}
              onMatched={() => navigateTo('matches')}
            />
          )}
          {view === 'matches' && (
            <MatchesView
              user={user}
              onOpenChat={(convoId) => {
                setActiveConvoId(convoId);
                navigateTo('messages');
              }}
            />
          )}
          {view === 'messages' && (
            <MessagesView
              user={user}
              initialConversationId={activeConvoId}
              wsSocket={wsSocket}
              onRefreshMatchesCount={refreshMe}
            />
          )}
          {view === 'profile' && (
            <ProfileView
              user={user}
              onUpdated={setUser}
              onNavigate={(v) => navigateTo(v as ActiveView)}
            />
          )}
          {view === 'dna' && <WorkoutDnaView user={user} onUpdated={setUser} />}
          {view === 'community' && <CommunityView user={user} />}
          {view === 'billing' && <SubscriptionAndBillingView user={user} onUpdated={setUser} />}
          {view === 'safety' && (
            <SafetyCenterView
              user={user}
              onUpdated={setUser}
              onAccountDeleted={() => {
                setUser(null);
                setPublicMode('landing');
              }}
            />
          )}
          {view === 'admin' && <AdminDashboardView />}
        </main>
      </div>

      {/* Mobile 5-Tab Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-[#0A0C0E]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center"
      >
        {primaryBottomTabs.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`relative h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                active ? 'text-[#A3E635]' : 'text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
              {item.badge ? (
                <span className="absolute top-1.5 right-3 font-mono-num text-[9px] font-bold px-1.5 rounded bg-[#A3E635] text-[#070809]">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Mobile Secondary Menu Drawer */}
      {showMobileDrawer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex">
          <div className="w-72 bg-[#0A0C0E] border-r border-white/10 h-full p-5 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl font-extrabold text-white">GYMBUD</span>
                <button
                  type="button"
                  onClick={() => setShowMobileDrawer(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-1">
                {secondaryNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTo(item.id)}
                      className="w-full min-h-[44px] px-3 rounded-xl text-sm text-zinc-200 hover:bg-white/5 flex items-center gap-3 cursor-pointer"
                    >
                      <Icon className="w-4 h-4 text-[#A3E635]" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[44px] px-3 rounded-xl text-sm text-zinc-400 hover:text-white flex items-center gap-3 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
          <div className="flex-1" onClick={() => setShowMobileDrawer(false)} />
        </div>
      )}

      {/* Notifications Drawer */}
      {showNotifDrawer && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end">
          <div className="flex-1" onClick={() => setShowNotifDrawer(false)} />
          <div className="w-full max-w-md bg-[#101214] border-l border-white/10 h-full p-6 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h2 className="font-display text-2xl font-bold text-white">Notifications</h2>
              <button
                type="button"
                onClick={() => setShowNotifDrawer(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-zinc-500">You are all caught up.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => navigateTo((n.link_view || 'discover') as ActiveView)}
                    className="w-full text-left p-4 rounded-xl border border-white/10 bg-[#070809] hover:border-[#A3E635]/40 space-y-1 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{n.title}</span>
                      <span className="text-[11px] font-mono-num text-zinc-500">
                        {new Date(n.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300">{n.body_safe}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
