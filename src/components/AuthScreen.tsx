import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api, setSessionToken } from '../lib/api.ts';
import type { CurrentUser } from '../shared/types.ts';

interface AuthScreenProps {
  initialMode: 'login' | 'register' | 'reset';
  initialResetToken?: string | null;
  initialResetEmail?: string | null;
  initialResetError?: string | null;
  onBack: () => void;
  onAuthenticated: (user: CurrentUser) => void;
}

interface DevMailPreview {
  to: string;
  subject: string;
  reset_url: string;
  code: string;
  expires_minutes: number;
}

export function AuthScreen({
  initialMode,
  initialResetToken = null,
  initialResetEmail = null,
  initialResetError = null,
  onBack,
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [email, setEmail] = useState(initialResetEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('24');
  const [gender, setGender] = useState('Male');
  const [city, setCity] = useState('Abu Dhabi');
  const [country, setCountry] = useState('UAE');

  // Password recovery state
  const [resetStep, setResetStep] = useState<'request' | 'confirm'>(initialResetToken ? 'confirm' : 'request');
  const [resetToken, setResetToken] = useState<string | null>(initialResetToken);
  const [recoveryEmailSent, setRecoveryEmailSent] = useState(false);
  const [deliveryProvider, setDeliveryProvider] = useState<'resend' | 'webhook' | 'supabase' | 'sandbox' | null>(null);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [devMailPreview, setDevMailPreview] = useState<DevMailPreview | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(Boolean(initialResetToken));
  const [error, setError] = useState<string | null>(initialResetError);
  const [showTestAccounts, setShowTestAccounts] = useState(false);

  // Sync mode when parent updates initialMode unless URL reset token is active
  useEffect(() => {
    if (!initialResetToken) {
      setMode(initialMode);
    }
  }, [initialMode, initialResetToken]);

  // Extract URL query or Supabase recovery hash token directly if present and scrub it from URL history
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hashRaw);

    const sbAccessToken = hashParams.get('access_token');
    const sbType = hashParams.get('type') || params.get('type');
    const sbError = hashParams.get('error_description') || params.get('error_description');

    const rawToken =
      sbType === 'recovery' && sbAccessToken ? sbAccessToken : (params.get('reset_token') || params.get('token'));
    const rawEmail = params.get('email');

    if (rawToken !== null) {
      const trimmedToken = rawToken.trim();
      params.delete('reset_token');
      params.delete('token');
      params.delete('email');
      params.delete('type');
      const remaining = params.toString();
      window.history.replaceState(
        {},
        '',
        remaining ? `${window.location.pathname}?${remaining}` : window.location.pathname
      );

      setMode('reset');
      setRecoveryEmailSent(false);
      if (rawEmail && rawEmail.trim()) {
        setEmail(rawEmail.trim());
      }

      if (trimmedToken.length >= 16 && /^[A-Za-z0-9_.-]+$/.test(trimmedToken)) {
        setResetToken(trimmedToken);
        setResetStep('confirm');
      } else {
        setResetToken(null);
        setResetStep('request');
        setError('This password reset link is invalid or malformed. Request a new recovery email below.');
      }
    } else if (sbError && (hashParams.has('error') || params.has('error'))) {
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      const remaining = params.toString();
      window.history.replaceState(
        {},
        '',
        remaining ? `${window.location.pathname}?${remaining}` : window.location.pathname
      );
      setMode('reset');
      setResetStep('request');
      setError(sbError.replace(/\+/g, ' '));
    }
  }, []);

  // Sync parent-provided URL token/email/error if updated after mount
  useEffect(() => {
    if (initialResetError) {
      setMode('reset');
      setResetStep('request');
      setError(initialResetError);
    }
  }, [initialResetError]);

  useEffect(() => {
    if (!initialResetToken) return;
    const trimmedToken = initialResetToken.trim();
    setMode('reset');
    setRecoveryEmailSent(false);
    if (initialResetEmail) {
      setEmail(initialResetEmail.trim());
    }
    if (trimmedToken.length >= 16 && /^[A-Za-z0-9_.-]+$/.test(trimmedToken)) {
      setResetToken(trimmedToken);
      setResetStep('confirm');
    } else {
      setResetToken(null);
      setResetStep('request');
      setError('This password reset link is invalid or malformed. Request a new recovery email below.');
    }
  }, [initialResetToken, initialResetEmail]);

  // Verify email reset token whenever resetToken changes
  useEffect(() => {
    if (!resetToken) {
      setVerifyingToken(false);
      return;
    }
    let active = true;
    setVerifyingToken(true);
    setError(null);
    api<{ valid: boolean; email_masked: string }>('/api/auth/verify-reset-token', {
      method: 'POST',
      body: JSON.stringify({ token: resetToken }),
    })
      .then((res) => {
        if (!active) return;
        setMaskedEmail(res.email_masked);
        setRecoveryEmailSent(false);
        setResetStep('confirm');
      })
      .catch((err: any) => {
        if (!active) return;
        setResetToken(null);
        setResetStep('request');
        setRecoveryEmailSent(false);
        setError(err?.message || 'This password reset link is invalid or has expired. Request a new email below.');
      })
      .finally(() => {
        if (active) setVerifyingToken(false);
      });
    return () => {
      active = false;
    };
  }, [resetToken]);

  // Cooldown timer for resending reset email
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function requestPasswordResetEmail(targetEmail: string) {
    const cleanEmail = targetEmail.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    setEmail(cleanEmail);
    setError(null);
    setLoading(true);
    try {
      const res = await api<{
        sent: boolean;
        mail_configured: boolean;
        delivery_provider?: 'resend' | 'webhook' | 'supabase' | 'sandbox';
        message: string;
        dev_mail_preview?: DevMailPreview;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
      });
      setRecoveryEmailSent(true);
      setDeliveryProvider(res.delivery_provider || null);
      setResetMessage(res.message);
      setDevMailPreview(res.dev_mail_preview || null);
      setResetStep('confirm');
      setResendCooldown(30);
    } catch (err: any) {
      setError(err?.message || 'Unable to dispatch password reset email.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'reset') {
      if (resetStep === 'request') {
        await requestPasswordResetEmail(email);
        return;
      }

      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        setError('Password must be at least 8 characters and include both letters and numbers.');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setError('Passwords do not match.');
        return;
      }

      setLoading(true);
      try {
        const res = await api<{ reset: boolean; message: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify(
            resetToken
              ? { token: resetToken, new_password: newPassword }
              : { email, code: resetCode.trim(), new_password: newPassword }
          ),
        });
        setMode('login');
        setResetStep('request');
        setRecoveryEmailSent(false);
        setResetToken(null);
        setResetCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        setDevMailPreview(null);
        setMaskedEmail(null);
        setPassword('');
        setResetMessage(res.message);
      } catch (err: any) {
        setError(err?.message || 'Unable to reset password.');
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password) {
          setError('Please enter your email address and password.');
          setLoading(false);
          return;
        }
        const res = await api<{ user: CurrentUser; session_token?: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: cleanEmail, password }),
        });
        if (!res?.user) {
          throw new Error('Invalid login response from server.');
        }
        setSessionToken(res.session_token);
        onAuthenticated(res.user);
      } else if (mode === 'register') {
        const cleanDisplayName = displayName.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = phone.trim();
        const cleanAge = age.trim();
        const parsedAge = Number(cleanAge);

        if (cleanDisplayName.length < 2) {
          setError('Please enter a display name (at least 2 characters).');
          setLoading(false);
          return;
        }
        if (!/^\d{2}$/.test(cleanAge) || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 99) {
          setError('Age must be a 2-digit number between 18 and 99.');
          setLoading(false);
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          setError('Please enter a valid email address.');
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters long.');
          setLoading(false);
          return;
        }

        const res = await api<{ user: CurrentUser; session_token?: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: cleanEmail,
            password,
            display_name: cleanDisplayName,
            phone: cleanPhone,
            age: parsedAge,
            gender,
            city,
            country,
          }),
        });
        if (!res?.user) {
          throw new Error('Invalid registration response from server.');
        }
        setSessionToken(res.session_token);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function loginAsSeededUser(seedEmail: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ user: CurrentUser; session_token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: seedEmail, password: 'Gymbud2026!' }),
      });
      if (!res?.user) {
        throw new Error('Invalid login response from server.');
      }
      setSessionToken(res.session_token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  function enterResetMode() {
    setMode('reset');
    setResetStep('request');
    setRecoveryEmailSent(false);
    setDeliveryProvider(null);
    setResetToken(null);
    setResetCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setMaskedEmail(null);
    setDevMailPreview(null);
    setResetMessage(null);
    setError(null);
  }

  const awaitingSupabaseLink = mode === 'reset' && resetStep === 'confirm' && !resetToken && deliveryProvider === 'supabase';

  return (
    <div className="min-h-screen bg-[#070809] text-zinc-100 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 cursor-pointer min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to GYMBUD
        </button>

        <div className="border border-white/10 rounded-2xl bg-[#101214] p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-display text-3xl font-bold text-white tracking-tight">
                {mode === 'login' ? 'Member Sign In' : mode === 'register' ? 'Join GYMBUD' : 'Recover Your Account'}
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                {mode === 'login'
                  ? 'Access your matches, workouts, and gym community.'
                  : mode === 'register'
                    ? '18+ fitness community · Free unlimited matching.'
                    : resetStep === 'request'
                      ? 'Enter your account email and we will send a secure password recovery email.'
                      : resetToken
                        ? `Verified reset link${maskedEmail ? ` for ${maskedEmail}` : ''}. Choose a strong new password.`
                        : awaitingSupabaseLink
                          ? 'Check your inbox (and spam folder) and click the secure reset link we sent you.'
                          : 'Check your inbox for the 6-digit code or click the link in your email.'}
              </p>
            </div>
          </div>

          {mode !== 'reset' && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#070809] border border-white/10 mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setResetMessage(null);
                }}
                className={`min-h-[40px] text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-[#A3E635] text-[#070809]' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setResetMessage(null);
                }}
                className={`min-h-[40px] text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-[#A3E635] text-[#070809]' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              {error}
            </div>
          )}

          {(recoveryEmailSent || resetMessage) && (
            <div className="mb-4 p-3.5 rounded-lg bg-[#A3E635]/10 border border-[#A3E635]/30 text-sm text-[#bef264] space-y-2">
              {recoveryEmailSent && mode === 'reset' && (
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Mail className="w-4 h-4 text-[#A3E635] shrink-0" />
                  <span>Recovery email sent{email ? ` to ${email}` : ''}</span>
                </div>
              )}
              {resetMessage && (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#A3E635] shrink-0 mt-0.5" />
                  <span>{resetMessage}</span>
                </div>
              )}

              {devMailPreview && mode === 'reset' && (
                <div className="mt-2 p-3 rounded-lg bg-[#070809] border border-white/15 text-xs text-zinc-300 space-y-1.5">
                  <div className="text-[11px] font-medium text-[#A3E635]">
                    Local Mail Sandbox (configure RESEND_API_KEY in .env for live email delivery)
                  </div>
                  <div>
                    <span className="text-zinc-500">To:</span> {devMailPreview.to}
                  </div>
                  <div>
                    <span className="text-zinc-500">Verification Code:</span>{' '}
                    <span className="font-mono-num font-bold text-white">{devMailPreview.code}</span>
                  </div>
                  <div className="pt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setResetCode(devMailPreview.code);
                      }}
                      className="px-2.5 py-1 rounded bg-[#A3E635] text-[#070809] text-[11px] font-semibold cursor-pointer"
                    >
                      Fill Code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = new URL(devMailPreview.reset_url);
                        const tok = url.searchParams.get('reset_token') || url.searchParams.get('token');
                        if (tok) setResetToken(tok);
                      }}
                      className="px-2.5 py-1 rounded border border-white/20 text-white text-[11px] font-medium hover:bg-white/5 cursor-pointer"
                    >
                      Simulate Link Click
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {verifyingToken ? (
            <div className="py-10 text-center text-sm text-zinc-400">
              Verifying secure password reset link...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Display Name</label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your display name"
                      className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">Age (18–99)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{2}"
                        maxLength={2}
                        required
                        value={age}
                        onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        placeholder="24"
                        aria-invalid={age.length > 0 && (!/^\d{2}$/.test(age) || Number(age) < 18)}
                        className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white font-mono-num focus:outline-none focus:border-[#A3E635]"
                      />
                      {age.length > 0 && (!/^\d{2}$/.test(age) || Number(age) < 18) && (
                        <p className="mt-1 text-[11px] text-amber-400">Enter 2 digits (18–99)</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">Gender</label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">City</label>
                      <select
                        value={city}
                        onChange={(e) => {
                          const nextCity = e.target.value;
                          setCity(nextCity);
                          if (['Abu Dhabi', 'Dubai', 'Sharjah', 'Al Ain'].includes(nextCity)) {
                            setCountry('UAE');
                          } else if (nextCity === 'Riyadh') {
                            setCountry('Saudi Arabia');
                          } else if (nextCity === 'London') {
                            setCountry('UK');
                          } else if (nextCity === 'Singapore') {
                            setCountry('Singapore');
                          }
                        }}
                        className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                      >
                        <option value="Abu Dhabi">Abu Dhabi</option>
                        <option value="Dubai">Dubai</option>
                        <option value="Sharjah">Sharjah</option>
                        <option value="Al Ain">Al Ain</option>
                        <option value="Riyadh">Riyadh</option>
                        <option value="London">London</option>
                        <option value="Singapore">Singapore</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">Phone (Optional now)</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+97150..."
                        className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                      />
                    </div>
                  </div>
                </>
              )}

              {!(mode === 'reset' && resetStep === 'confirm' && resetToken) && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    disabled={mode === 'reset' && resetStep === 'confirm'}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635] disabled:opacity-60"
                  />
                </div>
              )}

              {mode !== 'reset' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={mode === 'register' ? 8 : undefined}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'}
                      className="w-full h-11 px-3.5 pr-11 rounded-lg bg-[#070809] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#A3E635]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'reset' && resetStep === 'confirm' && awaitingSupabaseLink && (
                <div className="p-4 rounded-xl bg-[#070809] border border-white/10 space-y-3">
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Click the <span className="text-white font-semibold">Reset Password</span> link inside the email sent to{' '}
                    <span className="text-white font-medium">{email}</span>. That link opens GYMBUD right back here so you can set your new password.
                  </p>
                  <button
                    type="button"
                    disabled={resendCooldown > 0 || loading}
                    onClick={() => requestPasswordResetEmail(email)}
                    className="w-full min-h-[42px] rounded-lg border border-white/15 text-xs font-medium text-white hover:border-[#A3E635]/60 disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#A3E635]" />
                    {resendCooldown > 0 ? `Resend recovery email in ${resendCooldown}s` : 'Resend recovery email'}
                  </button>
                </div>
              )}

              {mode === 'reset' && resetStep === 'confirm' && !awaitingSupabaseLink && (
                <>
                  {!resetToken && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-zinc-300">6-Digit Reset Code</label>
                        <button
                          type="button"
                          disabled={resendCooldown > 0 || loading}
                          onClick={() => requestPasswordResetEmail(email)}
                          className="text-[11px] text-[#A3E635] hover:underline disabled:text-zinc-500 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
                        </button>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength={6}
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code from email"
                        className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white font-mono-num tracking-widest focus:outline-none focus:border-[#A3E635]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">New Password</label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 chars, letters + numbers"
                        className="w-full h-11 px-3.5 pr-11 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Confirm New Password</label>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Re-enter your new password"
                      className="w-full h-11 px-3.5 rounded-lg bg-[#070809] border border-white/15 text-sm text-white focus:outline-none focus:border-[#A3E635]"
                    />
                  </div>
                </>
              )}

              {!awaitingSupabaseLink && (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[46px] rounded-lg bg-[#A3E635] text-[#070809] font-semibold text-sm hover:bg-[#bef264] disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  {mode === 'reset' && resetStep === 'request' && <Mail className="w-4 h-4" />}
                  {loading
                    ? 'Processing...'
                    : mode === 'login'
                      ? 'Sign In'
                      : mode === 'register'
                        ? 'Create Account'
                        : resetStep === 'request'
                          ? 'Send Reset Email'
                          : 'Update Password'}
                </button>
              )}

              {mode === 'reset' && resetStep === 'confirm' && (
                <button
                  type="button"
                  onClick={() => {
                    setResetStep('request');
                    setRecoveryEmailSent(false);
                    setDeliveryProvider(null);
                    setResetToken(null);
                    setResetCode('');
                    setMaskedEmail(null);
                    setDevMailPreview(null);
                    setResetMessage(null);
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-zinc-400 hover:text-white cursor-pointer py-1"
                >
                  Use a different email address
                </button>
              )}
            </form>
          )}

          <div className="mt-4 flex items-center justify-between text-xs text-zinc-400">
            {mode === 'login' ? (
              <button
                type="button"
                onClick={enterResetMode}
                className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer py-2"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Forgot password?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setResetStep('request');
                  setRecoveryEmailSent(false);
                  setDeliveryProvider(null);
                  setResetToken(null);
                  setResetCode('');
                  setMaskedEmail(null);
                  setDevMailPreview(null);
                  setResetMessage(null);
                  setError(null);
                }}
                className="hover:text-white cursor-pointer py-2"
              >
                {mode === 'reset' ? 'Back to Sign In' : 'Already have an account? Sign in'}
              </button>
            )}
            <span className="inline-flex items-center gap-1 text-zinc-500">
              <ShieldCheck className="w-3.5 h-3.5 text-[#A3E635]" />
              18+ Enforced
            </span>
          </div>

          {/* Owner Admin Quick Access */}
          <div className="mt-6 pt-5 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowTestAccounts(!showTestAccounts)}
              className="w-full flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-white cursor-pointer py-1"
            >
              <span className="inline-flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[#A3E635]" />
                Owner Admin Quick Sign In
              </span>
              <span>{showTestAccounts ? 'Hide' : 'Show'}</span>
            </button>

            {showTestAccounts && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-zinc-500">
                  Sign in as the Owner Admin (default password: <span className="font-mono-num text-zinc-300">Gymbud2026!</span> — change anytime via Forgot password):
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => loginAsSeededUser('yusufaguilar2008@gmail.com')}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-white/10 bg-[#070809] hover:border-[#A3E635]/50 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-white">Yusuf Aguilar · Owner Admin (Full Console Access)</div>
                  <div className="text-[11px] font-mono-num text-zinc-400">yusufaguilar2008@gmail.com</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
