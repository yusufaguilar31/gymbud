import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { type Express } from 'express';
import { db, getDataDir } from './db.ts';
import {
  type AuthenticatedRequest,
  hashPassword,
  verifyPassword,
  signSessionToken,
  SESSION_COOKIE_NAME,
  requireAuth,
  requireAdmin,
  rateLimit,
  sanitizeText,
} from './auth.ts';
import {
  buildPublicProfileCard,
  calculateCompatibility,
  classifyWorkoutDna,
  getFullCurrentUser,
} from './matching.ts';
import {
  createCheckoutSession,
  finalizeVerifiedSubscription,
  getPaymentGatewayStatus,
  verifyInternalCheckoutToken,
  verifyWebhookSignature,
} from './payments.ts';
import { isEmailDeliveryConfigured, sendPasswordResetEmail } from './email.ts';
import { DEFAULT_COMMUNITY_GUIDELINES } from '../src/shared/constants.ts';

const uploadsDir = path.join(getDataDir(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export interface RealtimeHub {
  sendToUser: (userId: string, event: string, payload: unknown) => void;
  isUserOnline: (userId: string) => boolean;
}

function saveBase64Image(dataUrl: string, prefix: string): string | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    throw new Error('Image must be smaller than 2 MB');
  }
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return `/api/uploads/${filename}`;
}

function getBlockedUserIds(userId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT blocked_id AS other_id FROM blocked_users WHERE blocker_id = ?
       UNION
       SELECT blocker_id AS other_id FROM blocked_users WHERE blocked_id = ?`
    )
    .all(userId, userId) as { other_id: string }[];
  return new Set(rows.map((r) => r.other_id));
}

function createNotification(params: {
  userId: string;
  type: 'matches' | 'likes' | 'messages' | 'meetups' | 'billing' | 'security';
  title: string;
  bodySafe: string;
  linkView: string;
  hub: RealtimeHub;
}) {
  const prefs = db
    .prepare(`SELECT * FROM notification_preferences WHERE user_id = ?`)
    .get(params.userId) as Record<string, any> | undefined;
  if (prefs && prefs[params.type] === 0) return;

  const id = `ntf_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body_safe, link_view)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.userId, params.type, params.title, params.bodySafe, params.linkView);

  params.hub.sendToUser(params.userId, 'notification:new', {
    id,
    type: params.type,
    title: params.title,
    body_safe: params.bodySafe,
    link_view: params.linkView,
    is_read: false,
    created_at: new Date().toISOString(),
  });
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 1000 * 60 * 60 * 24 * 14,
    path: '/',
  });
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

export function registerRoutes(app: Express, hub: RealtimeHub): void {
  // Serve uploaded user avatars safely (prevent XSS by forcing image content types & nosniff)
  app.use('/api/uploads', express.static(uploadsDir, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }));

  // Stripe raw webhook must be registered before JSON body parsing or handle raw buffer explicitly
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.headers['stripe-signature'] as string | undefined;
    const verification = verifyWebhookSignature(req.body as Buffer, signature);
    if (!verification.valid || !verification.event) {
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }

    const event = verification.event;
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = session.metadata || {};
      if (meta.user_id && meta.plan_id) {
        finalizeVerifiedSubscription({
          userId: meta.user_id,
          planId: meta.plan_id,
          provider: 'stripe',
          providerSubscriptionId: String(session.subscription || session.id),
          providerPaymentIntentId: String(session.payment_intent || session.id),
          idempotencyKey: meta.idempotency_key || session.id,
          cardBrand: 'Card',
          cardLast4: '••••',
        });
      }
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: '4mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'gymbud-api' });
  });

  // ==========================================
  // 0. PUBLIC WEBSITE DATA (NON-PII, PRIVACY-SAFE)
  // ==========================================
  app.get('/api/public/website-data', (_req, res) => {
    const gyms = db.prepare(`SELECT * FROM gyms ORDER BY country DESC, city ASC, name ASC`).all() as any[];
    const activeMembersCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM users u
           JOIN profiles p ON p.user_id = u.id
           WHERE u.account_status = 'active' AND p.privacy_discoverable = 1`
        )
        .get() as { cnt: number }
    ).cnt;
    const matchesCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM matches WHERE status = 'active'`).get() as { cnt: number }
    ).cnt;

    const rawPosts = db
      .prepare(
        `SELECT cp.id, cp.title, cp.body, cp.category, cp.routine_json, cp.image_url, cp.created_at,
                p.display_name AS author_name, p.city AS author_city,
                wd.archetype AS author_archetype,
                (SELECT COUNT(*) FROM post_reactions pr WHERE pr.post_id = cp.id) AS reaction_count
         FROM community_posts cp
         JOIN users u ON u.id = cp.user_id
         JOIN profiles p ON p.user_id = cp.user_id
         LEFT JOIN workout_dna wd ON wd.user_id = cp.user_id
         WHERE cp.moderation_status = 'published' AND u.account_status = 'active'
         ORDER BY datetime(cp.created_at) DESC LIMIT 4`
      )
      .all() as any[];

    const posts = rawPosts.map((p) => {
      const parts = String(p.author_name || 'Member').trim().split(/\s+/);
      const publicName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
      return {
        id: p.id,
        title: p.title,
        body: p.body,
        category: p.category,
        routine: p.routine_json ? JSON.parse(p.routine_json) : null,
        image_url: p.image_url,
        author_name: publicName,
        author_city: p.author_city,
        author_archetype: p.author_archetype,
        reaction_count: p.reaction_count || 0,
        created_at: p.created_at,
      };
    });

    const guidelinesRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'community_guidelines'`).get() as {
      value_json: string;
    } | undefined;

    res.json({
      stats: {
        gyms_count: gyms.length,
        active_members_count: activeMembersCount,
        matches_count: matchesCount,
        posts_count: posts.length,
      },
      gyms,
      posts,
      safety_guidelines: guidelinesRow ? JSON.parse(guidelinesRow.value_json) : DEFAULT_COMMUNITY_GUIDELINES,
    });
  });

  app.post('/api/public/compatibility-preview', rateLimit('public_compat_preview', 30, 60_000), (req, res) => {
    const goal = sanitizeText(req.body?.goal, 60) || 'Strength training';
    const gymId = sanitizeText(req.body?.gym_id, 64) || null;
    const timeOfDay = (['Morning', 'Afternoon', 'Evening', 'Flexible'].includes(req.body?.time_of_day)
      ? req.body.time_of_day
      : 'Evening') as 'Morning' | 'Afternoon' | 'Evening' | 'Flexible';
    const experienceLevel = sanitizeText(req.body?.experience_level, 40) || 'Intermediate';
    const workoutSplit = sanitizeText(req.body?.workout_split, 60) || 'Push / Pull / Legs';

    const syntheticViewer = {
      gym_id: gymId,
      experience_level: experienceLevel,
      preferences: {
        goals: [goal],
        muscle_groups: ['Chest', 'Back', 'Legs'],
        favorite_exercises: ['Bench Press', 'Deadlift', 'Pull-Ups'],
        workout_split: workoutSplit,
        training_frequency: 4,
        training_days: ['Mon', 'Tue', 'Thu', 'Sat'],
        training_times: timeOfDay === 'Morning' ? ['7:00 AM'] : timeOfDay === 'Afternoon' ? ['2:00 PM'] : ['7:00 PM'],
        time_of_day: timeOfDay,
        gym_environment: 'Strength & Barbell Club' as const,
        partner_preference: 'Training Partner' as const,
      },
      workout_dna: null,
    };

    const candidates = db
      .prepare(
        `SELECT u.email_verified, u.phone_verified,
                p.display_name, p.city, p.gym_id, p.experience_level, p.privacy_hide_gym, p.privacy_hide_schedule,
                g.name AS gym_name,
                fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
                fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
                fp.gym_environment, fp.partner_preference,
                wd.archetype, wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
                wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN gyms g ON g.id = p.gym_id
         LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
         LEFT JOIN workout_dna wd ON wd.user_id = u.id
         WHERE u.account_status = 'active'
           AND p.privacy_discoverable = 1
           AND p.onboarding_completed = 1`
      )
      .all() as any[];

    const parseArr = (raw: string | null) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const matches = candidates
      .map((c) => {
        const hideGym = Boolean(c.privacy_hide_gym);
        const hideSchedule = Boolean(c.privacy_hide_schedule);
        const candidatePrefs = {
          goals: parseArr(c.goals_json),
          muscle_groups: parseArr(c.muscle_groups_json),
          favorite_exercises: parseArr(c.favorite_exercises_json),
          workout_split: c.workout_split || 'Push / Pull / Legs',
          training_frequency: c.training_frequency || 4,
          training_days: parseArr(c.training_days_json),
          training_times: parseArr(c.training_times_json),
          time_of_day: c.time_of_day || 'Evening',
          gym_environment: c.gym_environment || 'Strength & Barbell Club',
          partner_preference: c.partner_preference || 'Training Partner',
        };
        const compat = calculateCompatibility(syntheticViewer, {
          gym_id: c.gym_id,
          gym_name: c.gym_name || null,
          privacy_hide_gym: hideGym,
          privacy_hide_schedule: hideSchedule,
          experience_level: c.experience_level,
          preferences: candidatePrefs,
          workout_dna: c.archetype
            ? {
                favorite_day: c.favorite_day,
                weight_vs_reps: c.weight_vs_reps,
                solo_vs_partner: c.solo_vs_partner,
                morning_vs_evening: c.morning_vs_evening,
                music_habit: c.music_habit,
                strength_vs_aesthetics: c.strength_vs_aesthetics,
                structured_vs_spontaneous: c.structured_vs_spontaneous,
                seriousness: c.seriousness,
                archetype: c.archetype,
              }
            : null,
        });

        const firstName = String(c.display_name || 'Athlete').trim().split(/\s+/)[0];
        return {
          first_name: firstName,
          city: c.city,
          experience_level: c.experience_level,
          verified: Boolean(c.email_verified && c.phone_verified),
          archetype: c.archetype || 'The Fitness Enthusiast',
          gym_name: hideGym ? 'Private Gym' : c.gym_name || 'Local UAE Club',
          time_of_day: hideSchedule ? 'Flexible' : c.time_of_day || 'Evening',
          goals: candidatePrefs.goals.slice(0, 3),
          score: compat.score,
          reasons: compat.reasons,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    res.json({ matches });
  });

  // ==========================================
  // 1. AUTHENTICATION & REGISTRATION
  // ==========================================
  app.post('/api/auth/register', rateLimit('auth_register', 10, 60_000), (req, res) => {
    const email = sanitizeText(req.body?.email, 160).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const displayName = sanitizeText(req.body?.display_name, 80);
    const phone = sanitizeText(req.body?.phone, 32);
    const age = Number(req.body?.age);
    const gender = sanitizeText(req.body?.gender, 40) || 'Prefer not to say';
    const city = sanitizeText(req.body?.city, 60) || 'Abu Dhabi';
    const country = sanitizeText(req.body?.country, 60) || 'UAE';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }
    if (!displayName || displayName.length < 2) {
      res.status(400).json({ error: 'Please enter your display name.' });
      return;
    }
    if (!Number.isFinite(age) || age < 18 || age > 100) {
      res.status(400).json({ error: 'You must be at least 18 years old to join GYMBUD.' });
      return;
    }

    const existingEmail = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existingEmail) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    if (phone) {
      const existingPhone = db.prepare(`SELECT id FROM users WHERE phone = ? AND phone != ''`).get(phone);
      if (existingPhone) {
        res.status(409).json({ error: 'An account with this phone number already exists.' });
        return;
      }
    }

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const passwordHash = hashPassword(password);
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${displayName.toLowerCase()}:${age}:${city.toLowerCase()}`)
      .digest('hex')
      .slice(0, 16);

    const dupMatches = db
      .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE duplicate_fingerprint = ?`)
      .get(fingerprint) as { cnt: number };
    const suspiciousScore = dupMatches.cnt >= 2 ? 25 : 0;

    const ownerAdminEmail = (process.env.ADMIN_OWNER_EMAIL || 'yusufaguilar2008@gmail.com').trim().toLowerCase();
    const assignedRole: 'member' | 'admin' = email === ownerAdminEmail ? 'admin' : 'member';

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, phone, password_hash, role, duplicate_fingerprint, suspicious_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, email, phone, passwordHash, assignedRole, fingerprint, suspiciousScore);

      db.prepare(
        `INSERT INTO profiles (user_id, display_name, age, gender, city, country, avatar_url, onboarding_completed)
         VALUES (?, ?, ?, ?, ?, ?, '', 0)`
      ).run(userId, displayName, Math.floor(age), gender, city, country);

      db.prepare(`INSERT INTO fitness_preferences (user_id) VALUES (?)`).run(userId);
      db.prepare(`INSERT INTO notification_preferences (user_id) VALUES (?)`).run(userId);
      if (assignedRole === 'admin') {
        db.prepare(`INSERT INTO admin_roles (user_id, role_name, granted_by) VALUES (?, 'Owner Admin', 'system')`).run(
          userId
        );
      }
    });
    tx();

    const token = signSessionToken(userId, assignedRole);
    setSessionCookie(req, res, token);

    res.status(201).json({ user: getFullCurrentUser(userId), session_token: token });
  });

  app.post('/api/auth/login', rateLimit('auth_login', 20, 60_000), (req, res) => {
    const email = sanitizeText(req.body?.email, 160).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const userRow = db
      .prepare(`SELECT id, password_hash, role, account_status FROM users WHERE email = ?`)
      .get(email) as { id: string; password_hash: string; role: 'member' | 'moderator' | 'admin'; account_status: string } | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (userRow.account_status === 'suspended' || userRow.account_status === 'banned' || userRow.account_status === 'deleted') {
      res.status(403).json({ error: `Your account is ${userRow.account_status}. Please contact GYMBUD Safety.` });
      return;
    }

    const token = signSessionToken(userRow.id, userRow.role);
    setSessionCookie(req, res, token);

    res.json({ user: getFullCurrentUser(userRow.id), session_token: token });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  function hashResetSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  function safeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }

  function maskEmailAddress(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    const prefix = local.slice(0, Math.min(2, local.length));
    return `${prefix}${'*'.repeat(Math.max(2, local.length - prefix.length))}@${domain}`;
  }

  app.post('/api/auth/forgot-password', rateLimit('auth_forgot', 5, 60_000), async (req, res) => {
    const email = sanitizeText(req.body?.email, 160).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const mailConfigured = isEmailDeliveryConfigured();
    const genericMessage =
      'If an account with that email exists, a secure password reset email has been sent with a reset link and 6-digit code.';

    const userRow = db
      .prepare(
        `SELECT u.id, u.email, u.account_status, p.display_name
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.email = ?`
      )
      .get(email) as { id: string; email: string; account_status: string; display_name: string | null } | undefined;

    if (!userRow || userRow.account_status !== 'active') {
      res.json({ sent: true, mail_configured: mailConfigured, message: genericMessage });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const resetCode = String(crypto.randomInt(100000, 999999));
    const tokenHash = hashResetSecret(rawToken);
    const codeHash = hashResetSecret(resetCode);
    const expiresMinutes = 15;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();
    const tokenId = `rst_${crypto.randomBytes(8).toString('hex')}`;

    const tx = db.transaction(() => {
      db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(
        userRow.id
      );
      db.prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, code_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(tokenId, userRow.id, tokenHash, codeHash, expiresAt);
    });
    tx();

    const rawOrigin =
      (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('http') ? req.headers.origin : null) ||
      (req.get('host') ? `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}` : null) ||
      process.env.APP_URL ||
      'http://localhost:3000';
    const baseUrl = rawOrigin.replace(/\/$/, '');
    const resetUrl = `${baseUrl}/?reset_token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(userRow.email)}`;

    try {
      const emailResult = await sendPasswordResetEmail({
        to: userRow.email,
        displayName: userRow.display_name || 'Athlete',
        resetUrl,
        code: resetCode,
        expiresMinutes,
      });

      createNotification({
        userId: userRow.id,
        type: 'security',
        title: 'Password Reset Requested',
        bodySafe: 'A password reset email was dispatched to your email address. Ignore if this was you.',
        linkView: 'safety',
        hub,
      });

      const isDevSandbox = !mailConfigured && process.env.NODE_ENV !== 'production';
      res.json({
        sent: true,
        mail_configured: mailConfigured,
        message: genericMessage,
        ...(isDevSandbox && emailResult.preview ? { dev_mail_preview: emailResult.preview } : {}),
      });
    } catch (err: any) {
      console.error('[Password Reset Email Error]', err?.message || err);
      res.status(502).json({ error: 'Unable to dispatch reset email right now. Please try again shortly.' });
    }
  });

  app.post('/api/auth/verify-reset-token', rateLimit('auth_verify_token', 15, 60_000), (req, res) => {
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!rawToken || rawToken.length < 16) {
      res.status(400).json({ error: 'Invalid or missing password reset token.' });
      return;
    }

    const tokenHash = hashResetSecret(rawToken);
    const record = db
      .prepare(
        `SELECT prt.id, prt.expires_at, prt.used_at, prt.attempts, u.email
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.token_hash = ? AND u.account_status = 'active'`
      )
      .get(tokenHash) as
      | { id: string; expires_at: string; used_at: string | null; attempts: number; email: string }
      | undefined;

    if (!record || record.used_at || record.attempts >= 5 || Date.parse(record.expires_at) <= Date.now()) {
      res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
      return;
    }

    res.json({
      valid: true,
      email_masked: maskEmailAddress(record.email),
    });
  });

  app.post('/api/auth/reset-password', rateLimit('auth_reset', 10, 60_000), (req, res) => {
    const email = sanitizeText(req.body?.email, 160).toLowerCase();
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const resetCode = sanitizeText(req.body?.code, 12);
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      res.status(400).json({ error: 'New password must be at least 8 characters and include both letters and numbers.' });
      return;
    }

    let matchedRecord:
      | { id: string; user_id: string; expires_at: string; used_at: string | null; attempts: number; code_hash: string }
      | undefined;

    if (rawToken) {
      const tokenHash = hashResetSecret(rawToken);
      matchedRecord = db
        .prepare(
          `SELECT id, user_id, expires_at, used_at, attempts, code_hash
           FROM password_reset_tokens
           WHERE token_hash = ?`
        )
        .get(tokenHash) as typeof matchedRecord;

      if (
        !matchedRecord ||
        matchedRecord.used_at ||
        matchedRecord.attempts >= 5 ||
        Date.parse(matchedRecord.expires_at) <= Date.now()
      ) {
        res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
        return;
      }
    } else {
      if (!email || !resetCode) {
        res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
        return;
      }

      const userRow = db
        .prepare(`SELECT id, account_status FROM users WHERE email = ?`)
        .get(email) as { id: string; account_status: string } | undefined;

      if (!userRow || userRow.account_status !== 'active') {
        res.status(400).json({ error: 'Invalid or expired reset verification code.' });
        return;
      }

      const latest = db
        .prepare(
          `SELECT id, user_id, expires_at, used_at, attempts, code_hash
           FROM password_reset_tokens
           WHERE user_id = ? AND used_at IS NULL
           ORDER BY datetime(created_at) DESC, rowid DESC
           LIMIT 1`
        )
        .get(userRow.id) as typeof matchedRecord;

      if (!latest || Date.parse(latest.expires_at) <= Date.now() || latest.attempts >= 5) {
        res.status(400).json({ error: 'Reset code has expired. Please request a new reset email.' });
        return;
      }

      const candidateCodeHash = hashResetSecret(resetCode);
      if (!safeHexEqual(candidateCodeHash, latest.code_hash)) {
        const nextAttempts = latest.attempts + 1;
        if (nextAttempts >= 5) {
          db.prepare(`UPDATE password_reset_tokens SET attempts = ?, used_at = datetime('now') WHERE id = ?`).run(
            nextAttempts,
            latest.id
          );
          res.status(400).json({ error: 'Too many invalid attempts. Please request a new reset email.' });
          return;
        }
        db.prepare(`UPDATE password_reset_tokens SET attempts = ? WHERE id = ?`).run(nextAttempts, latest.id);
        res.status(400).json({ error: 'Invalid reset verification code.' });
        return;
      }

      matchedRecord = latest;
    }

    const tx = db.transaction(() => {
      db.prepare(`UPDATE users SET password_hash = ?, email_code = NULL WHERE id = ?`).run(
        hashPassword(newPassword),
        matchedRecord!.user_id
      );
      db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(
        matchedRecord!.user_id
      );
    });
    tx();

    createNotification({
      userId: matchedRecord.user_id,
      type: 'security',
      title: 'Password Updated',
      bodySafe: 'Your GYMBUD password was reset successfully. If this was not you, contact safety support immediately.',
      linkView: 'safety',
      hub,
    });

    res.json({ reset: true, message: 'Password updated securely. You can now sign in.' });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = getFullCurrentUser(req.authUser!.id);
    if (!user) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    const unreadNotifications = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`).get(user.id) as { cnt: number }
    ).cnt;
    const unreadMessages = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN matches mt ON mt.id = c.match_id
           WHERE mt.status = 'active'
             AND (mt.user_a_id = ? OR mt.user_b_id = ?)
             AND m.sender_id != ?
             AND m.read_at IS NULL`
        )
        .get(user.id, user.id, user.id) as { cnt: number }
    ).cnt;

    res.json({ user, unread_notifications: unreadNotifications, unread_messages: unreadMessages });
  });

  // ==========================================
  // 2. PROFILE & ONBOARDING
  // ==========================================
  app.put('/api/profile/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const body = req.body || {};

    try {
      const current = getFullCurrentUser(userId);
      if (!current) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      let avatarUrl = current.avatar_url;
      if (typeof body.avatar_data === 'string' && body.avatar_data.startsWith('data:image/')) {
        const saved = saveBase64Image(body.avatar_data, `avatar_${userId}`);
        if (saved) avatarUrl = saved;
      } else if (typeof body.avatar_url === 'string') {
        avatarUrl = sanitizeText(body.avatar_url, 400);
      }

      let additionalPhotos = current.additional_photos;
      if (Array.isArray(body.additional_photos)) {
        additionalPhotos = body.additional_photos
          .slice(0, 5)
          .map((item: unknown) => {
            if (typeof item === 'string' && item.startsWith('data:image/')) {
              return saveBase64Image(item, `photo_${userId}`) || '';
            }
            return typeof item === 'string' ? sanitizeText(item, 400) : '';
          })
          .filter(Boolean);
      }

      const age = body.age !== undefined ? Number(body.age) : current.age;
      if (!Number.isFinite(age) || age < 18 || age > 100) {
        res.status(400).json({ error: 'Age must be 18 or older.' });
        return;
      }

      const displayName = body.display_name !== undefined ? sanitizeText(body.display_name, 80) : current.display_name;
      const gender = body.gender !== undefined ? sanitizeText(body.gender, 40) : current.gender;
      const bio = body.bio !== undefined ? sanitizeText(body.bio, 500) : current.bio;
      const city = body.city !== undefined ? sanitizeText(body.city, 60) : current.city;
      const country = body.country !== undefined ? sanitizeText(body.country, 60) : current.country;
      const gymId = body.gym_id !== undefined ? (body.gym_id ? sanitizeText(body.gym_id, 64) : null) : current.gym_id;
      const experienceLevel = body.experience_level !== undefined ? sanitizeText(body.experience_level, 40) : current.experience_level;
      const phone = body.phone !== undefined ? sanitizeText(body.phone, 32) : current.phone;

      // Premium-only features gated cleanly on backend
      const profileTheme = current.is_plus && body.profile_theme ? sanitizeText(body.profile_theme, 32) : current.profile_theme;
      const customBadge = current.is_plus && body.custom_badge !== undefined ? sanitizeText(body.custom_badge, 32) || null : current.custom_badge;
      const travelCity = current.is_plus && body.travel_city !== undefined ? (body.travel_city ? sanitizeText(body.travel_city, 60) : null) : current.travel_city;
      const travelCountry = current.is_plus && body.travel_country !== undefined ? (body.travel_country ? sanitizeText(body.travel_country, 60) : null) : current.travel_country;

      const privacy = {
        hide_gym: body.privacy?.hide_gym ?? current.privacy.hide_gym,
        hide_distance: body.privacy?.hide_distance ?? current.privacy.hide_distance,
        hide_schedule: body.privacy?.hide_schedule ?? current.privacy.hide_schedule,
        discoverable: body.privacy?.discoverable ?? current.privacy.discoverable,
        show_online: body.privacy?.show_online ?? current.privacy.show_online,
        read_receipts: body.privacy?.read_receipts ?? current.privacy.read_receipts,
        profile_visits: body.privacy?.profile_visits ?? current.privacy.profile_visits,
      };

      const prefs = {
        goals: Array.isArray(body.preferences?.goals) ? body.preferences.goals.slice(0, 9).map((s: unknown) => sanitizeText(s, 50)) : current.preferences.goals,
        muscle_groups: Array.isArray(body.preferences?.muscle_groups) ? body.preferences.muscle_groups.slice(0, 8).map((s: unknown) => sanitizeText(s, 40)) : current.preferences.muscle_groups,
        favorite_exercises: Array.isArray(body.preferences?.favorite_exercises) ? body.preferences.favorite_exercises.slice(0, 12).map((s: unknown) => sanitizeText(s, 60)) : current.preferences.favorite_exercises,
        workout_split: body.preferences?.workout_split ? sanitizeText(body.preferences.workout_split, 60) : current.preferences.workout_split,
        training_frequency: body.preferences?.training_frequency ? Math.min(7, Math.max(1, Number(body.preferences.training_frequency))) : current.preferences.training_frequency,
        training_days: Array.isArray(body.preferences?.training_days) ? body.preferences.training_days.slice(0, 7).map((s: unknown) => sanitizeText(s, 10)) : current.preferences.training_days,
        training_times: Array.isArray(body.preferences?.training_times) ? body.preferences.training_times.slice(0, 6).map((s: unknown) => sanitizeText(s, 20)) : current.preferences.training_times,
        time_of_day: body.preferences?.time_of_day ? sanitizeText(body.preferences.time_of_day, 30) : current.preferences.time_of_day,
        gym_environment: body.preferences?.gym_environment ? sanitizeText(body.preferences.gym_environment, 60) : current.preferences.gym_environment,
        partner_preference: body.preferences?.partner_preference ? sanitizeText(body.preferences.partner_preference, 50) : current.preferences.partner_preference,
      };

      const onboardingCompleted = body.onboarding_completed !== undefined ? (body.onboarding_completed ? 1 : 0) : current.onboarding_completed ? 1 : 0;

      const tx = db.transaction(() => {
        if (phone !== current.phone) {
          db.prepare(`UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?`).run(phone, userId);
        }

        db.prepare(
          `UPDATE profiles
           SET display_name = ?, age = ?, gender = ?, bio = ?, city = ?, country = ?, gym_id = ?,
               avatar_url = ?, additional_photos_json = ?, experience_level = ?,
               privacy_hide_gym = ?, privacy_hide_distance = ?, privacy_hide_schedule = ?,
               privacy_discoverable = ?, privacy_show_online = ?, privacy_read_receipts = ?, privacy_profile_visits = ?,
               profile_theme = ?, custom_badge = ?, travel_city = ?, travel_country = ?, onboarding_completed = ?
           WHERE user_id = ?`
        ).run(
          displayName,
          Math.floor(age),
          gender,
          bio,
          city,
          country,
          gymId,
          avatarUrl,
          JSON.stringify(additionalPhotos),
          experienceLevel,
          privacy.hide_gym ? 1 : 0,
          privacy.hide_distance ? 1 : 0,
          privacy.hide_schedule ? 1 : 0,
          privacy.discoverable ? 1 : 0,
          privacy.show_online ? 1 : 0,
          privacy.read_receipts ? 1 : 0,
          privacy.profile_visits ? 1 : 0,
          profileTheme,
          customBadge,
          travelCity,
          travelCountry,
          onboardingCompleted,
          userId
        );

        db.prepare(
          `UPDATE fitness_preferences
           SET goals_json = ?, muscle_groups_json = ?, favorite_exercises_json = ?, workout_split = ?,
               training_frequency = ?, training_days_json = ?, training_times_json = ?, time_of_day = ?,
               gym_environment = ?, partner_preference = ?
           WHERE user_id = ?`
        ).run(
          JSON.stringify(prefs.goals),
          JSON.stringify(prefs.muscle_groups),
          JSON.stringify(prefs.favorite_exercises),
          prefs.workout_split,
          prefs.training_frequency,
          JSON.stringify(prefs.training_days),
          JSON.stringify(prefs.training_times),
          prefs.time_of_day,
          prefs.gym_environment,
          prefs.partner_preference,
          userId
        );
      });
      tx();

      res.json({ user: getFullCurrentUser(userId) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Unable to update profile.' });
    }
  });

  // ==========================================
  // 3. VERIFICATION (GENUINE FLOWS ONLY)
  // ==========================================
  app.post('/api/verification/request-code', requireAuth, rateLimit('verify_req', 5, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const type = req.body?.type;
    if (type !== 'email' && type !== 'phone') {
      res.status(400).json({ error: 'Verification type must be email or phone.' });
      return;
    }

    const userRow = db.prepare(`SELECT email, phone FROM users WHERE id = ?`).get(userId) as { email: string; phone: string };
    if (type === 'phone' && !userRow.phone) {
      res.status(400).json({ error: 'Add a phone number in your profile first.' });
      return;
    }

    const code = String(crypto.randomInt(100000, 999999));
    if (type === 'email') {
      db.prepare(`UPDATE users SET email_code = ? WHERE id = ?`).run(code, userId);
    } else {
      db.prepare(`UPDATE users SET phone_code = ? WHERE id = ?`).run(code, userId);
    }

    db.prepare(
      `INSERT INTO verification_records (id, user_id, verification_type, status, artifact_ref)
       VALUES (?, ?, ?, 'pending', ?)`
    ).run(`ver_${crypto.randomBytes(8).toString('hex')}`, userId, type, `${type}_otp_issued`);

    res.json({
      sent: true,
      destination: type === 'email' ? userRow.email : userRow.phone,
      // Transparent sandbox delivery hint when external SMTP/SMS keys are not configured
      sandbox_code: code,
    });
  });

  app.post('/api/verification/verify-code', requireAuth, rateLimit('verify_code', 10, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const type = req.body?.type;
    const code = sanitizeText(req.body?.code, 10);

    if (type !== 'email' && type !== 'phone') {
      res.status(400).json({ error: 'Invalid verification type.' });
      return;
    }

    const row = db.prepare(`SELECT email_code, phone_code FROM users WHERE id = ?`).get(userId) as {
      email_code: string | null;
      phone_code: string | null;
    };

    const expected = type === 'email' ? row.email_code : row.phone_code;
    if (!expected || expected !== code) {
      res.status(400).json({ error: 'Verification code does not match.' });
      return;
    }

    if (type === 'email') {
      db.prepare(`UPDATE users SET email_verified = 1, email_code = NULL WHERE id = ?`).run(userId);
    } else {
      db.prepare(`UPDATE users SET phone_verified = 1, phone_code = NULL WHERE id = ?`).run(userId);
    }

    db.prepare(
      `UPDATE verification_records
       SET status = 'approved', reviewed_at = datetime('now'), notes = 'OTP verified by member'
       WHERE user_id = ? AND verification_type = ? AND status = 'pending'`
    ).run(userId, type);

    const updated = getFullCurrentUser(userId);
    if (updated?.verified) {
      createNotification({
        userId,
        type: 'security',
        title: 'Verification Badge Active',
        bodySafe: 'Your email and phone are now verified. Your genuine verification badge is visible on your profile.',
        linkView: 'profile',
        hub,
      });
    }

    res.json({ user: updated });
  });

  app.post('/api/verification/selfie', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const selfieData = typeof req.body?.selfie_data === 'string' ? req.body.selfie_data : '';
    const poseNote = sanitizeText(req.body?.pose_note, 120) || 'GYMBUD pose check';

    let artifactRef = `selfie_submission_${poseNote}`;
    try {
      if (selfieData.startsWith('data:image/')) {
        artifactRef = saveBase64Image(selfieData, `selfie_${userId}`) || artifactRef;
      }
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }

    const id = `ver_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(
      `INSERT INTO verification_records (id, user_id, verification_type, status, artifact_ref, notes)
       VALUES (?, ?, 'selfie', 'pending', ?, ?)`
    ).run(id, userId, artifactRef, poseNote);

    res.status(201).json({
      submitted: true,
      status: 'pending',
      message: 'Selfie submitted for moderator review. Your badge updates once reviewed.',
    });
  });

  // ==========================================
  // 4. GYMS & PERSONALIZED DISCOVERY
  // ==========================================
  app.get('/api/gyms', requireAuth, (req: AuthenticatedRequest, res) => {
    const search = sanitizeText(req.query.q, 80).toLowerCase();
    const city = sanitizeText(req.query.city, 60);

    let rows = db.prepare(`SELECT * FROM gyms ORDER BY country DESC, city ASC, name ASC`).all() as any[];
    if (city && city !== 'All') {
      rows = rows.filter((g) => g.city.toLowerCase() === city.toLowerCase());
    }
    if (search) {
      rows = rows.filter(
        (g) =>
          g.name.toLowerCase().includes(search) ||
          g.area.toLowerCase().includes(search) ||
          g.city.toLowerCase().includes(search)
      );
    }
    res.json({ gyms: rows });
  });

  app.get('/api/discover', requireAuth, (req: AuthenticatedRequest, res) => {
    const viewer = getFullCurrentUser(req.authUser!.id);
    if (!viewer) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const blocked = getBlockedUserIds(viewer.id);
    const swipedRows = db
      .prepare(`SELECT to_user_id FROM likes WHERE from_user_id = ?`)
      .all(viewer.id) as { to_user_id: string }[];
    const swipedSet = new Set(swipedRows.map((r) => r.to_user_id));

    const includeSwiped = req.query.include_swiped === 'true';
    const goalFilter = sanitizeText(req.query.goal, 60);
    const gymFilter = sanitizeText(req.query.gym_id, 64);
    const timeFilter = sanitizeText(req.query.time_of_day, 30);
    const expFilter = sanitizeText(req.query.experience_level, 30);
    const exerciseFilter = viewer.is_plus ? sanitizeText(req.query.exercise, 60) : '';
    const cityFilter = viewer.is_plus
      ? sanitizeText(req.query.city, 60) || viewer.travel_city || ''
      : sanitizeText(req.query.city, 60);
    const sortMode = sanitizeText(req.query.sort, 30) || 'compatibility';

    const viewerGym = viewer.gym_id
      ? (db.prepare(`SELECT latitude_approx, longitude_approx FROM gyms WHERE id = ?`).get(viewer.gym_id) as
          | { latitude_approx: number; longitude_approx: number }
          | undefined)
      : undefined;
    const viewerCoords = viewerGym ? { lat: viewerGym.latitude_approx, lon: viewerGym.longitude_approx } : null;

    const likedMeRows = db
      .prepare(`SELECT from_user_id FROM likes WHERE to_user_id = ? AND decision = 'like'`)
      .all(viewer.id) as { from_user_id: string }[];
    const likedMeSet = new Set(likedMeRows.map((r) => r.from_user_id));

    const rows = db
      .prepare(
        `SELECT u.id AS user_id, u.email_verified, u.phone_verified, u.selfie_verified, u.last_active_at,
                p.*, g.name AS gym_name, g.area AS gym_area, g.latitude_approx, g.longitude_approx,
                fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
                fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
                fp.gym_environment, fp.partner_preference,
                wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
                wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness, wd.archetype,
                EXISTS(
                  SELECT 1 FROM subscriptions s
                  WHERE s.user_id = u.id AND s.status IN ('active', 'cancelled') AND datetime(s.current_period_end) > datetime('now')
                ) AS has_plus
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN gyms g ON g.id = p.gym_id
         LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
         LEFT JOIN workout_dna wd ON wd.user_id = u.id
         WHERE u.id != ?
           AND u.account_status = 'active'
           AND p.privacy_discoverable = 1`
      )
      .all(viewer.id) as Record<string, any>[];

    let cards = rows
      .filter((r) => !blocked.has(r.user_id))
      .filter((r) => includeSwiped || !swipedSet.has(r.user_id))
      .map((r) => buildPublicProfileCard(viewer, r, viewerCoords, likedMeSet));

    if (goalFilter) {
      cards = cards.filter((c) => c.preferences.goals.some((g) => g.toLowerCase() === goalFilter.toLowerCase()));
    }
    if (gymFilter) {
      cards = cards.filter((c) => c.gym_id === gymFilter);
    }
    if (timeFilter) {
      cards = cards.filter((c) => c.preferences.time_of_day.toLowerCase() === timeFilter.toLowerCase());
    }
    if (expFilter) {
      cards = cards.filter((c) => c.experience_level.toLowerCase() === expFilter.toLowerCase());
    }
    if (exerciseFilter) {
      cards = cards.filter((c) =>
        c.preferences.favorite_exercises.some((ex) => ex.toLowerCase() === exerciseFilter.toLowerCase())
      );
    }
    if (cityFilter && cityFilter !== 'All') {
      cards = cards.filter((c) => c.city.toLowerCase() === cityFilter.toLowerCase());
    }

    cards.sort((a, b) => {
      if (a.is_boosted !== b.is_boosted) return a.is_boosted ? -1 : 1;
      if (sortMode === 'same_gym') {
        const aSame = viewer.gym_id && a.gym_id === viewer.gym_id ? 1 : 0;
        const bSame = viewer.gym_id && b.gym_id === viewer.gym_id ? 1 : 0;
        if (aSame !== bSame) return bSame - aSame;
      }
      if (sortMode === 'active') {
        const aTime = a.last_active_at ? Date.parse(a.last_active_at) : 0;
        const bTime = b.last_active_at ? Date.parse(b.last_active_at) : 0;
        if (aTime !== bTime) return bTime - aTime;
      }
      return b.compatibility.score - a.compatibility.score;
    });

    res.json({ profiles: cards });
  });

  app.post('/api/profile/:userId/visit', requireAuth, (req: AuthenticatedRequest, res) => {
    const viewerId = req.authUser!.id;
    const viewedId = sanitizeText(req.params.userId, 64);
    if (viewerId === viewedId) {
      res.json({ ok: true });
      return;
    }
    const viewerPrivacy = db
      .prepare(`SELECT privacy_profile_visits FROM profiles WHERE user_id = ?`)
      .get(viewerId) as { privacy_profile_visits: number } | undefined;
    if (viewerPrivacy?.privacy_profile_visits) {
      db.prepare(`INSERT INTO profile_visits (id, viewer_id, viewed_id) VALUES (?, ?, ?)`).run(
        `vis_${crypto.randomBytes(6).toString('hex')}`,
        viewerId,
        viewedId
      );
    }
    res.json({ ok: true });
  });

  // ==========================================
  // 5. UNLIMITED MATCHING & LIKES
  // ==========================================
  app.post('/api/swipe', requireAuth, rateLimit('swipe_anti_bot', 120, 60_000), (req: AuthenticatedRequest, res) => {
    const fromId = req.authUser!.id;
    const toId = sanitizeText(req.body?.target_user_id, 64);
    const decision = req.body?.decision;

    if (!toId || toId === fromId || (decision !== 'like' && decision !== 'pass')) {
      res.status(400).json({ error: 'Invalid swipe request.' });
      return;
    }

    const blocked = getBlockedUserIds(fromId);
    if (blocked.has(toId)) {
      res.status(403).json({ error: 'Cannot interact with a blocked account.' });
      return;
    }

    const targetExists = db.prepare(`SELECT id FROM users WHERE id = ? AND account_status = 'active'`).get(toId);
    if (!targetExists) {
      res.status(404).json({ error: 'Target member not found.' });
      return;
    }

    db.prepare(
      `INSERT INTO likes (id, from_user_id, to_user_id, decision)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(from_user_id, to_user_id) DO UPDATE SET decision = excluded.decision, created_at = datetime('now')`
    ).run(`lik_${crypto.randomBytes(8).toString('hex')}`, fromId, toId, decision);

    let matched = false;
    let matchId: string | null = null;
    let conversationId: string | null = null;

    if (decision === 'like') {
      const reciprocal = db
        .prepare(`SELECT id FROM likes WHERE from_user_id = ? AND to_user_id = ? AND decision = 'like'`)
        .get(toId, fromId);

      const viewer = getFullCurrentUser(fromId)!;
      const candidateRow = db
        .prepare(
          `SELECT u.id AS user_id, u.email_verified, u.phone_verified, u.selfie_verified, u.last_active_at,
                  p.*, g.name AS gym_name, g.area AS gym_area, g.latitude_approx, g.longitude_approx,
                  fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
                  fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
                  fp.gym_environment, fp.partner_preference,
                  wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
                  wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness, wd.archetype,
                  0 AS has_plus
           FROM users u
           JOIN profiles p ON p.user_id = u.id
           LEFT JOIN gyms g ON g.id = p.gym_id
           LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
           LEFT JOIN workout_dna wd ON wd.user_id = u.id
           WHERE u.id = ?`
        )
        .get(toId) as Record<string, any> | undefined;

      if (reciprocal && candidateRow) {
        matched = true;
        const [userA, userB] = fromId < toId ? [fromId, toId] : [toId, fromId];
        const card = buildPublicProfileCard(viewer, candidateRow, null);

        const existingMatch = db
          .prepare(`SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?`)
          .get(userA, userB) as { id: string } | undefined;

        if (existingMatch) {
          matchId = existingMatch.id;
          db.prepare(`UPDATE matches SET status = 'active', unmatched_by = NULL, compatibility_score = ? WHERE id = ?`).run(
            card.compatibility.score,
            matchId
          );
          const convo = db.prepare(`SELECT id FROM conversations WHERE match_id = ?`).get(matchId) as { id: string };
          conversationId = convo.id;
        } else {
          matchId = `mth_${crypto.randomBytes(8).toString('hex')}`;
          conversationId = `cnv_${crypto.randomBytes(8).toString('hex')}`;
          db.prepare(
            `INSERT INTO matches (id, user_a_id, user_b_id, compatibility_score, status)
             VALUES (?, ?, ?, ?, 'active')`
          ).run(matchId, userA, userB, card.compatibility.score);
          db.prepare(`INSERT INTO conversations (id, match_id) VALUES (?, ?)`).run(conversationId, matchId);
        }

        createNotification({
          userId: toId,
          type: 'matches',
          title: 'New Workout Partner Match',
          bodySafe: `You and ${viewer.display_name} matched (${card.compatibility.score}% compatibility).`,
          linkView: 'matches',
          hub,
        });
        createNotification({
          userId: fromId,
          type: 'matches',
          title: 'New Workout Partner Match',
          bodySafe: `You and ${candidateRow.display_name} matched (${card.compatibility.score}% compatibility).`,
          linkView: 'matches',
          hub,
        });

        hub.sendToUser(toId, 'match:created', { match_id: matchId, conversation_id: conversationId, partner_name: viewer.display_name });
        hub.sendToUser(fromId, 'match:created', { match_id: matchId, conversation_id: conversationId, partner_name: candidateRow.display_name });
      } else {
        createNotification({
          userId: toId,
          type: 'likes',
          title: 'Someone wants to train with you',
          bodySafe: 'A gym member liked your fitness profile.',
          linkView: 'likes',
          hub,
        });
      }
    }

    res.json({ ok: true, matched, match_id: matchId, conversation_id: conversationId });
  });

  app.post('/api/swipe/undo', requireAuth, (req: AuthenticatedRequest, res) => {
    const fromId = req.authUser!.id;
    const toId = sanitizeText(req.body?.target_user_id, 64);
    if (!toId) {
      res.status(400).json({ error: 'Target user ID is required.' });
      return;
    }

    const result = db
      .prepare(`DELETE FROM likes WHERE from_user_id = ? AND to_user_id = ? AND decision = 'pass'`)
      .run(fromId, toId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Only skipped profiles can be undone.' });
      return;
    }

    res.json({ ok: true });
  });

  app.get('/api/likes/incoming', requireAuth, (req: AuthenticatedRequest, res) => {
    const viewer = getFullCurrentUser(req.authUser!.id)!;
    const blocked = getBlockedUserIds(viewer.id);

    const rows = db
      .prepare(
        `SELECT u.id AS user_id, u.email_verified, u.phone_verified, u.selfie_verified, u.last_active_at,
                p.*, g.name AS gym_name, g.area AS gym_area, g.latitude_approx, g.longitude_approx,
                fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
                fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
                fp.gym_environment, fp.partner_preference,
                wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
                wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness, wd.archetype,
                EXISTS(
                  SELECT 1 FROM subscriptions s
                  WHERE s.user_id = u.id AND s.status IN ('active', 'cancelled') AND datetime(s.current_period_end) > datetime('now')
                ) AS has_plus
         FROM likes l
         JOIN users u ON u.id = l.from_user_id
         JOIN profiles p ON p.user_id = u.id
         LEFT JOIN gyms g ON g.id = p.gym_id
         LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
         LEFT JOIN workout_dna wd ON wd.user_id = u.id
         WHERE l.to_user_id = ?
           AND l.decision = 'like'
           AND u.account_status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM likes l2 WHERE l2.from_user_id = ? AND l2.to_user_id = u.id
           )
         ORDER BY datetime(l.created_at) DESC`
      )
      .all(viewer.id, viewer.id) as Record<string, any>[];

    const filtered = rows.filter((r) => !blocked.has(r.user_id));

    if (!viewer.is_plus) {
      // Free members still see count & top goal hints without paying, while exact identity list is a GYMBUD+ perk
      res.json({
        count: filtered.length,
        is_plus: false,
        profiles: [],
        previews: filtered.slice(0, 4).map((r) => ({
          id: r.user_id.slice(0, 6),
          city: r.city,
          experience_level: r.experience_level,
          archetype: r.archetype || 'Fitness Member',
        })),
      });
      return;
    }

    const viewerGym = viewer.gym_id
      ? (db.prepare(`SELECT latitude_approx, longitude_approx FROM gyms WHERE id = ?`).get(viewer.gym_id) as
          | { latitude_approx: number; longitude_approx: number }
          | undefined)
      : undefined;
    const viewerCoords = viewerGym ? { lat: viewerGym.latitude_approx, lon: viewerGym.longitude_approx } : null;

    res.json({
      count: filtered.length,
      is_plus: true,
      profiles: filtered.map((r) => buildPublicProfileCard(viewer, r, viewerCoords)),
      previews: [],
    });
  });

  app.get('/api/matches', requireAuth, (req: AuthenticatedRequest, res) => {
    const viewer = getFullCurrentUser(req.authUser!.id)!;
    const blocked = getBlockedUserIds(viewer.id);

    const matchRows = db
      .prepare(
        `SELECT m.id AS match_id, m.user_a_id, m.user_b_id, m.compatibility_score, m.created_at AS matched_at,
                c.id AS conversation_id
         FROM matches m
         JOIN conversations c ON c.match_id = m.id
         WHERE m.status = 'active' AND (m.user_a_id = ? OR m.user_b_id = ?)
         ORDER BY COALESCE(c.last_message_at, m.created_at) DESC`
      )
      .all(viewer.id, viewer.id) as {
      match_id: string;
      user_a_id: string;
      user_b_id: string;
      compatibility_score: number;
      matched_at: string;
      conversation_id: string;
    }[];

    const results = [];
    for (const m of matchRows) {
      const partnerId = m.user_a_id === viewer.id ? m.user_b_id : m.user_a_id;
      if (blocked.has(partnerId)) continue;

      const partnerRow = db
        .prepare(
          `SELECT u.id AS user_id, u.email_verified, u.phone_verified, u.selfie_verified, u.last_active_at,
                  p.*, g.name AS gym_name, g.area AS gym_area, g.latitude_approx, g.longitude_approx,
                  fp.goals_json, fp.muscle_groups_json, fp.favorite_exercises_json, fp.workout_split,
                  fp.training_frequency, fp.training_days_json, fp.training_times_json, fp.time_of_day,
                  fp.gym_environment, fp.partner_preference,
                  wd.favorite_day, wd.weight_vs_reps, wd.solo_vs_partner, wd.morning_vs_evening,
                  wd.music_habit, wd.strength_vs_aesthetics, wd.structured_vs_spontaneous, wd.seriousness, wd.archetype,
                  EXISTS(
                    SELECT 1 FROM subscriptions s
                    WHERE s.user_id = u.id AND s.status IN ('active', 'cancelled') AND datetime(s.current_period_end) > datetime('now')
                  ) AS has_plus
           FROM users u
           JOIN profiles p ON p.user_id = u.id
           LEFT JOIN gyms g ON g.id = p.gym_id
           LEFT JOIN fitness_preferences fp ON fp.user_id = u.id
           LEFT JOIN workout_dna wd ON wd.user_id = u.id
           WHERE u.id = ? AND u.account_status = 'active'`
        )
        .get(partnerId) as Record<string, any> | undefined;

      if (!partnerRow) continue;

      const partnerCard = buildPublicProfileCard(viewer, partnerRow, null);
      partnerCard.is_online = Boolean(partnerRow.privacy_show_online) && (hub.isUserOnline(partnerId) || partnerCard.is_online);

      const lastMsg = db
        .prepare(
          `SELECT id, content, message_type, sender_id, created_at, read_at
           FROM messages WHERE conversation_id = ?
           ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`
        )
        .get(m.conversation_id) as any;

      const unreadCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
          )
          .get(m.conversation_id, viewer.id) as { cnt: number }
      ).cnt;

      results.push({
        match_id: m.match_id,
        conversation_id: m.conversation_id,
        matched_at: m.matched_at,
        compatibility_score: partnerCard.compatibility.score,
        compatibility_reasons: partnerCard.compatibility.reasons,
        partner: partnerCard,
        last_message: lastMsg || null,
        unread_count: unreadCount,
      });
    }

    res.json({ matches: results });
  });

  app.post('/api/matches/:matchId/unmatch', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const matchId = sanitizeText(req.params.matchId, 64);

    const match = db
      .prepare(`SELECT * FROM matches WHERE id = ? AND (user_a_id = ? OR user_b_id = ?) AND status = 'active'`)
      .get(matchId, userId, userId) as any;
    if (!match) {
      res.status(404).json({ error: 'Active match not found.' });
      return;
    }

    db.prepare(`UPDATE matches SET status = 'unmatched', unmatched_by = ? WHERE id = ?`).run(userId, matchId);
    const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    hub.sendToUser(partnerId, 'match:unmatched', { match_id: matchId });
    res.json({ ok: true });
  });

  // ==========================================
  // 6. REAL-TIME MESSAGING & MEET SAFELY
  // ==========================================
  app.get('/api/conversations/:conversationId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const conversationId = sanitizeText(req.params.conversationId, 64);

    const access = db
      .prepare(
        `SELECT m.user_a_id, m.user_b_id, m.status
         FROM conversations c
         JOIN matches m ON m.id = c.match_id
         WHERE c.id = ?`
      )
      .get(conversationId) as { user_a_id: string; user_b_id: string; status: string } | undefined;

    if (!access || (access.user_a_id !== userId && access.user_b_id !== userId)) {
      res.status(403).json({ error: 'You are not authorized to access this conversation.' });
      return;
    }
    if (access.status !== 'active') {
      res.status(403).json({ error: 'This conversation is inactive.' });
      return;
    }

    const partnerId = access.user_a_id === userId ? access.user_b_id : access.user_a_id;
    const blocked = getBlockedUserIds(userId);
    if (blocked.has(partnerId)) {
      res.status(403).json({ error: 'Messaging disabled for blocked accounts.' });
      return;
    }

    const viewerProfile = db.prepare(`SELECT privacy_read_receipts FROM profiles WHERE user_id = ?`).get(userId) as {
      privacy_read_receipts: number;
    };
    const partnerProfile = db.prepare(`SELECT privacy_read_receipts FROM profiles WHERE user_id = ?`).get(partnerId) as {
      privacy_read_receipts: number;
    };

    if (viewerProfile?.privacy_read_receipts) {
      const now = new Date().toISOString();
      const updated = db
        .prepare(
          `UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
        )
        .run(now, conversationId, userId);
      if (updated.changes > 0 && partnerProfile?.privacy_read_receipts) {
        hub.sendToUser(partnerId, 'message:read', { conversation_id: conversationId, read_at: now });
      }
    }

    const rows = db
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, rowid ASC`)
      .all(conversationId) as any[];

    const messages = rows.map((r) => ({
      id: r.id,
      conversation_id: r.conversation_id,
      sender_id: r.sender_id,
      content: r.content,
      message_type: r.message_type,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
      read_at: partnerProfile?.privacy_read_receipts ? r.read_at : null,
      created_at: r.created_at,
    }));

    res.json({ messages });
  });

  app.post('/api/conversations/:conversationId/messages', requireAuth, rateLimit('msg_send', 40, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const conversationId = sanitizeText(req.params.conversationId, 64);
    const content = sanitizeText(req.body?.content, 1500);
    const messageType = req.body?.message_type === 'routine' || req.body?.message_type === 'session_invite' ? req.body.message_type : 'text';
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : null;

    if (!content) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const access = db
      .prepare(
        `SELECT m.user_a_id, m.user_b_id, m.status
         FROM conversations c
         JOIN matches m ON m.id = c.match_id
         WHERE c.id = ?`
      )
      .get(conversationId) as { user_a_id: string; user_b_id: string; status: string } | undefined;

    if (!access || (access.user_a_id !== userId && access.user_b_id !== userId) || access.status !== 'active') {
      res.status(403).json({ error: 'Only active matched users can message each other.' });
      return;
    }

    const partnerId = access.user_a_id === userId ? access.user_b_id : access.user_a_id;
    if (getBlockedUserIds(userId).has(partnerId)) {
      res.status(403).json({ error: 'Cannot message a blocked user.' });
      return;
    }

    const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, content, message_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(msgId, conversationId, userId, content, messageType, metadata ? JSON.stringify(metadata) : null, createdAt);

    db.prepare(`UPDATE conversations SET last_message_at = ? WHERE id = ?`).run(createdAt, conversationId);

    const payload = {
      id: msgId,
      conversation_id: conversationId,
      sender_id: userId,
      content,
      message_type: messageType,
      metadata,
      read_at: null,
      created_at: createdAt,
    };

    hub.sendToUser(partnerId, 'message:new', payload);
    hub.sendToUser(userId, 'message:new', payload);

    const partnerPrefs = db
      .prepare(`SELECT preview_message_content FROM notification_preferences WHERE user_id = ?`)
      .get(partnerId) as { preview_message_content: number } | undefined;
    const senderProfile = db.prepare(`SELECT display_name FROM profiles WHERE user_id = ?`).get(userId) as {
      display_name: string;
    };

    // Never expose sensitive message content on lock-screen notifications by default
    const safeBody = partnerPrefs?.preview_message_content
      ? `${senderProfile.display_name}: ${content.slice(0, 70)}`
      : `New message from ${senderProfile.display_name}`;

    createNotification({
      userId: partnerId,
      type: 'messages',
      title: 'New Message',
      bodySafe: safeBody,
      linkView: 'messages',
      hub,
    });

    res.status(201).json({ message: payload });
  });

  app.get('/api/meetups', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const rows = db
      .prepare(
        `SELECT mt.*, g.name AS gym_name, g.area AS gym_area,
                CASE WHEN mt.creator_id = ? THEN p2.display_name ELSE p1.display_name END AS partner_name
         FROM meetups mt
         JOIN gyms g ON g.id = mt.gym_id
         JOIN profiles p1 ON p1.user_id = mt.creator_id
         JOIN profiles p2 ON p2.user_id = mt.partner_id
         WHERE mt.creator_id = ? OR mt.partner_id = ?
         ORDER BY datetime(mt.created_at) DESC`
      )
      .all(userId, userId, userId);
    res.json({ meetups: rows });
  });

  app.post('/api/meetups', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const matchId = sanitizeText(req.body?.match_id, 64);
    const gymId = sanitizeText(req.body?.gym_id, 64);
    const scheduledFor = sanitizeText(req.body?.scheduled_for, 80);
    const trustedName = sanitizeText(req.body?.trusted_contact_name, 80) || null;
    const trustedPhone = sanitizeText(req.body?.trusted_contact_phone, 32) || null;

    const match = db
      .prepare(`SELECT * FROM matches WHERE id = ? AND (user_a_id = ? OR user_b_id = ?) AND status = 'active'`)
      .get(matchId, userId, userId) as any;
    if (!match) {
      res.status(403).json({ error: 'Meetups can only be scheduled with active matches.' });
      return;
    }
    const gym = db.prepare(`SELECT id, name, area FROM gyms WHERE id = ?`).get(gymId) as any;
    if (!gym) {
      res.status(400).json({ error: 'Please select a verified public gym location.' });
      return;
    }

    const partnerId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    const meetupId = `mtp_${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(
      `INSERT INTO meetups (id, match_id, creator_id, partner_id, gym_id, scheduled_for, trusted_contact_name, trusted_contact_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(meetupId, matchId, userId, partnerId, gymId, scheduledFor, trustedName, trustedPhone);

    createNotification({
      userId: partnerId,
      type: 'meetups',
      title: 'Gym Session Suggested',
      bodySafe: `Public gym meetup proposed at ${gym.name} (${scheduledFor}).`,
      linkView: 'messages',
      hub,
    });

    res.status(201).json({ id: meetupId, gym_name: gym.name, gym_area: gym.area });
  });

  app.patch('/api/meetups/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const meetupId = sanitizeText(req.params.id, 64);
    const action = req.body?.action;

    const meetup = db
      .prepare(`SELECT * FROM meetups WHERE id = ? AND (creator_id = ? OR partner_id = ?)`)
      .get(meetupId, userId, userId) as any;
    if (!meetup) {
      res.status(404).json({ error: 'Meetup not found.' });
      return;
    }

    if (action === 'check_in') {
      db.prepare(`UPDATE meetups SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ?`).run(meetupId);
    } else if (action === 'check_out') {
      db.prepare(`UPDATE meetups SET status = 'checked_out', checked_out_at = datetime('now') WHERE id = ?`).run(meetupId);
    } else if (action === 'cancel') {
      db.prepare(`UPDATE meetups SET status = 'cancelled' WHERE id = ?`).run(meetupId);
    } else {
      res.status(400).json({ error: 'Invalid meetup action.' });
      return;
    }

    res.json({ ok: true });
  });

  // ==========================================
  // 7. WORKOUT DNA
  // ==========================================
  app.post('/api/workout-dna', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const b = req.body || {};

    const payload = {
      favorite_day: sanitizeText(b.favorite_day, 50) || 'Chest & Push',
      weight_vs_reps: b.weight_vs_reps || 'balanced',
      solo_vs_partner: b.solo_vs_partner || 'partner',
      morning_vs_evening: b.morning_vs_evening || 'evening',
      music_habit: b.music_habit || 'always_headphones',
      strength_vs_aesthetics: b.strength_vs_aesthetics || 'strength',
      structured_vs_spontaneous: b.structured_vs_spontaneous || 'structured',
      seriousness: b.seriousness || 'dedicated',
    };

    const archetype = classifyWorkoutDna(payload);
    db.prepare(
      `INSERT INTO workout_dna
       (user_id, favorite_day, weight_vs_reps, solo_vs_partner, morning_vs_evening, music_habit, strength_vs_aesthetics, structured_vs_spontaneous, seriousness, archetype, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         favorite_day = excluded.favorite_day,
         weight_vs_reps = excluded.weight_vs_reps,
         solo_vs_partner = excluded.solo_vs_partner,
         morning_vs_evening = excluded.morning_vs_evening,
         music_habit = excluded.music_habit,
         strength_vs_aesthetics = excluded.strength_vs_aesthetics,
         structured_vs_spontaneous = excluded.structured_vs_spontaneous,
         seriousness = excluded.seriousness,
         archetype = excluded.archetype,
         completed_at = datetime('now')`
    ).run(
      userId,
      payload.favorite_day,
      payload.weight_vs_reps,
      payload.solo_vs_partner,
      payload.morning_vs_evening,
      payload.music_habit,
      payload.strength_vs_aesthetics,
      payload.structured_vs_spontaneous,
      payload.seriousness,
      archetype
    );

    res.json({ user: getFullCurrentUser(userId), archetype });
  });

  // ==========================================
  // 8. GYM COMMUNITY
  // ==========================================
  app.get('/api/community/posts', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const blocked = getBlockedUserIds(userId);
    const category = sanitizeText(req.query.category, 40);

    const rows = db
      .prepare(
        `SELECT cp.*, p.display_name, p.avatar_url, p.city,
                u.email_verified, u.phone_verified, wd.archetype
         FROM community_posts cp
         JOIN users u ON u.id = cp.user_id
         JOIN profiles p ON p.user_id = cp.user_id
         LEFT JOIN workout_dna wd ON wd.user_id = cp.user_id
         WHERE cp.moderation_status = 'published' AND u.account_status = 'active'
         ORDER BY datetime(cp.created_at) DESC`
      )
      .all() as any[];

    const posts = rows
      .filter((r) => !blocked.has(r.user_id))
      .filter((r) => !category || category === 'All' || r.category === category)
      .map((r) => {
        const reactionCount = (
          db.prepare(`SELECT COUNT(*) AS cnt FROM post_reactions WHERE post_id = ?`).get(r.id) as { cnt: number }
        ).cnt;
        const userReacted = Boolean(
          db.prepare(`SELECT id FROM post_reactions WHERE post_id = ? AND user_id = ?`).get(r.id, userId)
        );
        const comments = db
          .prepare(
            `SELECT c.id, c.user_id, c.content, c.created_at, p.display_name AS author_name, p.avatar_url AS author_avatar
             FROM post_comments c
             JOIN profiles p ON p.user_id = c.user_id
             WHERE c.post_id = ?
             ORDER BY datetime(c.created_at) ASC`
          )
          .all(r.id) as any[];

        return {
          id: r.id,
          user_id: r.user_id,
          author_name: r.display_name,
          author_avatar: r.avatar_url,
          author_verified: Boolean(r.email_verified && r.phone_verified),
          author_archetype: r.archetype || null,
          author_city: r.city,
          title: r.title,
          body: r.body,
          category: r.category,
          routine: r.routine_json ? JSON.parse(r.routine_json) : null,
          image_url: r.image_url,
          reaction_count: reactionCount,
          user_reacted: userReacted,
          comment_count: comments.filter((c) => !blocked.has(c.user_id)).length,
          comments: comments.filter((c) => !blocked.has(c.user_id)),
          created_at: r.created_at,
        };
      });

    res.json({ posts });
  });

  app.post('/api/community/posts', requireAuth, rateLimit('post_create', 15, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const title = sanitizeText(req.body?.title, 140);
    const body = sanitizeText(req.body?.body, 2000);
    const category = sanitizeText(req.body?.category, 40) || 'Milestone';
    const routine = req.body?.routine && req.body.routine.name ? req.body.routine : null;

    if (!title || !body) {
      res.status(400).json({ error: 'Post title and details are required.' });
      return;
    }

    let imageUrl: string | null = null;
    try {
      if (typeof req.body?.image_data === 'string' && req.body.image_data.startsWith('data:image/')) {
        imageUrl = saveBase64Image(req.body.image_data, `post_${userId}`);
      }
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }

    const id = `pst_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(
      `INSERT INTO community_posts (id, user_id, title, body, category, routine_json, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, title, body, category, routine ? JSON.stringify(routine) : null, imageUrl);

    res.status(201).json({ id });
  });

  app.post('/api/community/posts/:postId/react', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const postId = sanitizeText(req.params.postId, 64);

    const existing = db
      .prepare(`SELECT id FROM post_reactions WHERE post_id = ? AND user_id = ?`)
      .get(postId, userId) as { id: string } | undefined;

    if (existing) {
      db.prepare(`DELETE FROM post_reactions WHERE id = ?`).run(existing.id);
      res.json({ reacted: false });
    } else {
      db.prepare(`INSERT INTO post_reactions (id, post_id, user_id) VALUES (?, ?, ?)`).run(
        `rxn_${crypto.randomBytes(6).toString('hex')}`,
        postId,
        userId
      );
      res.json({ reacted: true });
    }
  });

  app.post('/api/community/posts/:postId/comments', requireAuth, rateLimit('comment_create', 30, 60_000), (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const postId = sanitizeText(req.params.postId, 64);
    const content = sanitizeText(req.body?.content, 500);
    if (!content) {
      res.status(400).json({ error: 'Comment cannot be empty.' });
      return;
    }

    const id = `cmt_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(`INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)`).run(
      id,
      postId,
      userId,
      content
    );
    res.status(201).json({ id });
  });

  app.delete('/api/community/posts/:postId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const role = req.authUser!.role;
    const postId = sanitizeText(req.params.postId, 64);

    const post = db.prepare(`SELECT id, user_id, title FROM community_posts WHERE id = ?`).get(postId) as
      | { id: string; user_id: string; title: string }
      | undefined;

    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }

    if (post.user_id !== userId && role === 'member') {
      res.status(403).json({ error: 'You can only delete your own posts.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM post_comments WHERE post_id = ?`).run(postId);
      db.prepare(`DELETE FROM post_reactions WHERE post_id = ?`).run(postId);
      db.prepare(`DELETE FROM community_posts WHERE id = ?`).run(postId);
      if (post.user_id !== userId) {
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
           VALUES (?, ?, 'delete_community_post', 'post', ?, ?)`
        ).run(
          `aud_${crypto.randomBytes(8).toString('hex')}`,
          userId,
          postId,
          JSON.stringify({ title: post.title, author_id: post.user_id })
        );
      }
    });
    tx();

    res.json({ ok: true });
  });

  // ==========================================
  // 9. SAFETY CENTER (FREE FOR EVERYONE)
  // ==========================================
  app.get('/api/safety/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const blocked = db
      .prepare(
        `SELECT b.blocked_id, b.created_at, p.display_name, p.city
         FROM blocked_users b
         JOIN profiles p ON p.user_id = b.blocked_id
         WHERE b.blocker_id = ?
         ORDER BY datetime(b.created_at) DESC`
      )
      .all(userId);

    const reports = db
      .prepare(
        `SELECT r.id, r.target_type, r.reason, r.status, r.created_at, r.resolution_notes, p.display_name AS target_name
         FROM reports r
         JOIN profiles p ON p.user_id = r.target_user_id
         WHERE r.reporter_id = ?
         ORDER BY datetime(r.created_at) DESC`
      )
      .all(userId);

    const verifications = db
      .prepare(
        `SELECT id, verification_type, status, submitted_at, reviewed_at, notes
         FROM verification_records WHERE user_id = ? ORDER BY datetime(submitted_at) DESC`
      )
      .all(userId);

    const guidelinesRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'community_guidelines'`).get() as {
      value_json: string;
    } | undefined;

    res.json({
      blocked_users: blocked,
      reports,
      verifications,
      guidelines: guidelinesRow ? JSON.parse(guidelinesRow.value_json) : DEFAULT_COMMUNITY_GUIDELINES,
    });
  });

  app.post('/api/safety/block', requireAuth, (req: AuthenticatedRequest, res) => {
    const blockerId = req.authUser!.id;
    const blockedId = sanitizeText(req.body?.user_id, 64);
    if (!blockedId || blockedId === blockerId) {
      res.status(400).json({ error: 'Invalid user to block.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO blocked_users (id, blocker_id, blocked_id) VALUES (?, ?, ?)`).run(
        `blk_${crypto.randomBytes(8).toString('hex')}`,
        blockerId,
        blockedId
      );
      const [userA, userB] = blockerId < blockedId ? [blockerId, blockedId] : [blockedId, blockerId];
      db.prepare(`UPDATE matches SET status = 'unmatched', unmatched_by = ? WHERE user_a_id = ? AND user_b_id = ?`).run(
        blockerId,
        userA,
        userB
      );
    });
    tx();
    res.json({ ok: true });
  });

  app.delete('/api/safety/block/:userId', requireAuth, (req: AuthenticatedRequest, res) => {
    const blockerId = req.authUser!.id;
    const blockedId = sanitizeText(req.params.userId, 64);
    db.prepare(`DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`).run(blockerId, blockedId);
    res.json({ ok: true });
  });

  app.post('/api/safety/report', requireAuth, rateLimit('safety_report', 20, 60_000), (req: AuthenticatedRequest, res) => {
    const reporterId = req.authUser!.id;
    const targetUserId = sanitizeText(req.body?.target_user_id, 64);
    const targetType = ['profile', 'message', 'post', 'photo'].includes(req.body?.target_type)
      ? req.body.target_type
      : 'profile';
    const targetId = sanitizeText(req.body?.target_id, 64) || targetUserId;
    const reason = sanitizeText(req.body?.reason, 120);
    const details = sanitizeText(req.body?.details, 1000);

    if (!targetUserId || !reason) {
      res.status(400).json({ error: 'Please specify a reason for your report.' });
      return;
    }

    const id = `rpt_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(
      `INSERT INTO reports (id, reporter_id, target_user_id, target_type, target_id, reason, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, reporterId, targetUserId, targetType, targetId, reason, details);

    db.prepare(`UPDATE users SET suspicious_score = suspicious_score + 15 WHERE id = ?`).run(targetUserId);

    res.status(201).json({ id, message: 'Report submitted securely to the GYMBUD Safety Team.' });
  });

  app.delete('/api/account/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ deleted: true });
  });

  // ==========================================
  // 10. GYMBUD+ SUBSCRIPTIONS & SECURE BILLING
  // ==========================================
  app.get('/api/billing/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const user = getFullCurrentUser(userId);
    const gateway = getPaymentGatewayStatus();
    const waitlistRow = db
      .prepare(`SELECT preferred_plan, created_at FROM plus_waitlist WHERE user_id = ?`)
      .get(userId) as { preferred_plan: string; created_at: string } | undefined;
    const waitlistTotal = (db.prepare(`SELECT COUNT(*) AS cnt FROM plus_waitlist`).get() as { cnt: number }).cnt;
    const payments = db
      .prepare(`SELECT * FROM payment_records WHERE user_id = ? ORDER BY datetime(created_at) DESC`)
      .all(userId);
    res.json({
      gateway,
      coming_soon: !gateway.stripe_configured,
      waitlist: waitlistRow ? { joined: true, ...waitlistRow } : { joined: false },
      waitlist_count: waitlistTotal,
      is_plus: user?.is_plus || false,
      subscription: user?.subscription || null,
      boost_expires_at: user?.boost_expires_at || null,
      payments,
    });
  });

  app.post('/api/billing/waitlist', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const preferredPlan =
      req.body?.preferred_plan === 'gymbud_plus_monthly' ? 'gymbud_plus_monthly' : 'gymbud_plus_annual';

    db.prepare(
      `INSERT INTO plus_waitlist (user_id, preferred_plan)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET preferred_plan = excluded.preferred_plan`
    ).run(userId, preferredPlan);

    res.json({ joined: true, preferred_plan: preferredPlan });
  });

  app.post('/api/billing/checkout', requireAuth, rateLimit('billing_checkout', 10, 60_000), async (req: AuthenticatedRequest, res) => {
    const gateway = getPaymentGatewayStatus();
    if (!gateway.stripe_configured) {
      res.status(503).json({
        error: 'GYMBUD+ subscriptions are coming soon while payment gateway keys are being configured.',
      });
      return;
    }

    const userId = req.authUser!.id;
    const planId = req.body?.plan_id === 'gymbud_plus_annual' ? 'gymbud_plus_annual' : 'gymbud_plus_monthly';
    const confirmedRecurring = req.body?.confirmed_recurring === true;
    const idempotencyKey = sanitizeText(req.body?.idempotency_key, 80) || `idem_${userId}_${Date.now()}`;

    if (!confirmedRecurring) {
      res.status(400).json({ error: 'Explicit confirmation of recurring billing terms is required.' });
      return;
    }

    try {
      const origin = `${req.protocol}://${req.get('host')}`;
      const result = await createCheckoutSession({
        userId,
        email: req.authUser!.email,
        planId,
        originUrl: origin,
        idempotencyKey,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Unable to initiate secure checkout.' });
    }
  });

  app.post('/api/billing/confirm-tokenized', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const checkoutToken = typeof req.body?.checkout_token === 'string' ? req.body.checkout_token : '';
    const paymentMethodToken = sanitizeText(req.body?.payment_method_token, 64);
    const cardBrand = sanitizeText(req.body?.card_brand, 24) || 'Visa';
    const cardLast4 = sanitizeText(req.body?.card_last4, 4) || '4242';

    // Reject any attempt to pass raw PAN / CVV fields
    if (req.body?.card_number || req.body?.cvv || req.body?.cvc || req.body?.pin) {
      res.status(400).json({ error: 'Raw card details are strictly prohibited on GYMBUD servers. Use tokenized payment elements.' });
      return;
    }

    const payload = verifyInternalCheckoutToken(checkoutToken);
    if (!payload || payload.user_id !== userId || payload.exp < Date.now() || !paymentMethodToken.startsWith('tok_')) {
      res.status(400).json({ error: 'Invalid or expired checkout verification token.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id, receipt_number FROM payment_records WHERE idempotency_key = ?`)
      .get(payload.idempotency_key) as { id: string; receipt_number: string } | undefined;
    if (existing) {
      res.json({ ok: true, receipt_number: existing.receipt_number, user: getFullCurrentUser(userId) });
      return;
    }

    const finalized = finalizeVerifiedSubscription({
      userId,
      planId: payload.plan_id,
      provider: 'stripe_tokenized',
      providerSubscriptionId: `sub_tok_${crypto.randomBytes(6).toString('hex')}`,
      providerPaymentIntentId: payload.intent_id,
      idempotencyKey: payload.idempotency_key,
      cardBrand,
      cardLast4: cardLast4.replace(/\D/g, '').slice(-4).padStart(4, '0'),
    });

    res.json({
      ok: true,
      receipt_number: finalized.receipt_number,
      user: getFullCurrentUser(userId),
    });
  });

  app.post('/api/billing/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const result = db
      .prepare(
        `UPDATE subscriptions
         SET status = 'cancelled', cancel_at_period_end = 1
         WHERE user_id = ? AND status = 'active'`
      )
      .run(userId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'No active subscription found.' });
      return;
    }
    createNotification({
      userId,
      type: 'billing',
      title: 'Subscription Cancelled',
      bodySafe: 'Your GYMBUD+ renewal has been cancelled. Benefits remain active through the end of your paid period.',
      linkView: 'billing',
      hub,
    });
    res.json({ ok: true, user: getFullCurrentUser(userId) });
  });

  app.post('/api/billing/boost', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!req.authUser!.is_plus) {
      res.status(403).json({ error: 'Profile Boost is a GYMBUD+ feature.' });
      return;
    }
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE profiles SET boost_expires_at = ? WHERE user_id = ?`).run(expires, req.authUser!.id);
    res.json({ boost_expires_at: expires, user: getFullCurrentUser(req.authUser!.id) });
  });

  app.get('/api/analytics/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    if (!req.authUser!.is_plus) {
      res.status(403).json({ error: 'Detailed Profile Analytics requires GYMBUD+.' });
      return;
    }
    const totalVisits = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM profile_visits WHERE viewed_id = ?`).get(userId) as { cnt: number }
    ).cnt;
    const totalLikesReceived = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM likes WHERE to_user_id = ? AND decision = 'like'`).get(userId) as { cnt: number }
    ).cnt;
    const totalLikesSent = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM likes WHERE from_user_id = ? AND decision = 'like'`).get(userId) as { cnt: number }
    ).cnt;
    const activeMatches = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM matches WHERE (user_a_id = ? OR user_b_id = ?) AND status = 'active'`).get(userId, userId) as { cnt: number }
    ).cnt;
    const recentVisitors = db
      .prepare(
        `SELECT p.display_name, p.city, p.experience_level, pv.visited_at
         FROM profile_visits pv
         JOIN profiles p ON p.user_id = pv.viewer_id
         WHERE pv.viewed_id = ? AND p.privacy_profile_visits = 1
         ORDER BY datetime(pv.visited_at) DESC LIMIT 10`
      )
      .all(userId);

    res.json({
      total_visits: totalVisits,
      likes_received: totalLikesReceived,
      likes_sent: totalLikesSent,
      active_matches: activeMatches,
      recent_visitors: recentVisitors,
    });
  });

  // ==========================================
  // 11. NOTIFICATIONS
  // ==========================================
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 50`)
      .all(userId);
    const prefs = db.prepare(`SELECT * FROM notification_preferences WHERE user_id = ?`).get(userId);
    res.json({ notifications, preferences: prefs });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.authUser!.id);
    res.json({ ok: true });
  });

  app.put('/api/notifications/preferences', requireAuth, (req: AuthenticatedRequest, res) => {
    const b = req.body || {};
    db.prepare(
      `UPDATE notification_preferences
       SET matches = ?, likes = ?, messages = ?, meetups = ?, billing = ?, security = ?, preview_message_content = ?
       WHERE user_id = ?`
    ).run(
      b.matches ? 1 : 0,
      b.likes ? 1 : 0,
      b.messages ? 1 : 0,
      b.meetups ? 1 : 0,
      b.billing ? 1 : 0,
      b.security ? 1 : 0,
      b.preview_message_content ? 1 : 0,
      req.authUser!.id
    );
    res.json({ ok: true });
  });

  // ==========================================
  // 12. ADMIN DASHBOARD (STRICT RBAC + AUDIT)
  // ==========================================
  app.get('/api/admin/overview', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res) => {
    const stats = {
      total_users: (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt,
      active_matches: (db.prepare(`SELECT COUNT(*) AS cnt FROM matches WHERE status = 'active'`).get() as { cnt: number }).cnt,
      open_reports: (db.prepare(`SELECT COUNT(*) AS cnt FROM reports WHERE status IN ('open', 'investigating')`).get() as { cnt: number }).cnt,
      pending_verifications: (db.prepare(`SELECT COUNT(*) AS cnt FROM verification_records WHERE verification_type = 'selfie' AND status = 'pending'`).get() as { cnt: number }).cnt,
      active_plus_subs: (db.prepare(`SELECT COUNT(*) AS cnt FROM subscriptions WHERE status = 'active'`).get() as { cnt: number }).cnt,
      total_revenue_aed: (db.prepare(`SELECT COALESCE(SUM(amount_aed), 0) AS total FROM payment_records WHERE status = 'succeeded'`).get() as { total: number }).total,
    };

    const users = db
      .prepare(
        `SELECT u.id, u.email, u.role, u.account_status, u.email_verified, u.phone_verified, u.selfie_verified, u.suspicious_score, u.created_at,
                p.display_name, p.city, p.age,
                EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') AS is_plus
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         ORDER BY datetime(u.created_at) DESC`
      )
      .all();

    const reports = db
      .prepare(
        `SELECT r.*, rp.display_name AS reporter_name, tp.display_name AS target_name
         FROM reports r
         JOIN profiles rp ON rp.user_id = r.reporter_id
         JOIN profiles tp ON tp.user_id = r.target_user_id
         ORDER BY datetime(r.created_at) DESC`
      )
      .all();

    const verifications = db
      .prepare(
        `SELECT vr.*, p.display_name, u.email
         FROM verification_records vr
         JOIN users u ON u.id = vr.user_id
         JOIN profiles p ON p.user_id = vr.user_id
         WHERE vr.verification_type = 'selfie'
         ORDER BY datetime(vr.submitted_at) DESC`
      )
      .all();

    const subscriptions = db
      .prepare(
        `SELECT s.*, p.display_name, u.email
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN profiles p ON p.user_id = s.user_id
         ORDER BY datetime(s.created_at) DESC`
      )
      .all();

    const auditLogs = db
      .prepare(
        `SELECT a.*, p.display_name AS actor_name
         FROM audit_logs a
         JOIN profiles p ON p.user_id = a.actor_id
         ORDER BY datetime(a.created_at) DESC LIMIT 60`
      )
      .all();

    const guidelinesRow = db.prepare(`SELECT value_json FROM app_settings WHERE key = 'community_guidelines'`).get() as {
      value_json: string;
    } | undefined;

    const gyms = db.prepare(`SELECT * FROM gyms ORDER BY country DESC, city ASC, name ASC`).all();

    const posts = db
      .prepare(
        `SELECT cp.id, cp.user_id, cp.title, cp.body, cp.category, cp.moderation_status, cp.created_at,
                p.display_name AS author_name, u.email AS author_email
         FROM community_posts cp
         JOIN users u ON u.id = cp.user_id
         JOIN profiles p ON p.user_id = cp.user_id
         ORDER BY datetime(cp.created_at) DESC LIMIT 100`
      )
      .all();

    const ownerAdminEmail = (process.env.ADMIN_OWNER_EMAIL || 'yusufaguilar2008@gmail.com').trim().toLowerCase();

    res.json({
      owner_email: ownerAdminEmail,
      stats,
      users,
      reports,
      verifications,
      subscriptions,
      gyms,
      posts,
      audit_logs: auditLogs,
      guidelines: guidelinesRow ? JSON.parse(guidelinesRow.value_json) : DEFAULT_COMMUNITY_GUIDELINES,
    });
  });

  app.post('/api/admin/users/:userId/status', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const targetId = sanitizeText(req.params.userId, 64);
    const status = req.body?.account_status;
    const reason = sanitizeText(req.body?.reason, 200) || 'Admin moderation review';

    if (!['active', 'suspended', 'banned'].includes(status)) {
      res.status(400).json({ error: 'Invalid account status.' });
      return;
    }
    if (targetId === req.authUser!.id) {
      res.status(400).json({ error: 'Admins cannot suspend their own active session.' });
      return;
    }

    db.prepare(`UPDATE users SET account_status = ? WHERE id = ?`).run(status, targetId);
    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, ?, 'user', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      `set_account_status_${status}`,
      targetId,
      JSON.stringify({ reason })
    );

    res.json({ ok: true });
  });

  app.post('/api/admin/verifications/:id/review', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const verId = sanitizeText(req.params.id, 64);
    const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
    const notes = sanitizeText(req.body?.notes, 300);

    const record = db.prepare(`SELECT * FROM verification_records WHERE id = ?`).get(verId) as any;
    if (!record) {
      res.status(404).json({ error: 'Verification record not found.' });
      return;
    }

    db.prepare(
      `UPDATE verification_records SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?, notes = ? WHERE id = ?`
    ).run(decision, req.authUser!.id, notes, verId);

    if (record.verification_type === 'selfie') {
      db.prepare(`UPDATE users SET selfie_verified = ? WHERE id = ?`).run(decision === 'approved' ? 1 : 0, record.user_id);
    }

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, ?, 'verification', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      `verification_${decision}`,
      record.user_id,
      JSON.stringify({ verId, notes })
    );

    createNotification({
      userId: record.user_id,
      type: 'security',
      title: `Selfie Verification ${decision === 'approved' ? 'Approved' : 'Update'}`,
      bodySafe:
        decision === 'approved'
          ? 'Your selfie verification has been approved by our safety team.'
          : 'Your selfie verification requires resubmission. Check Safety Center for notes.',
      linkView: 'safety',
      hub,
    });

    res.json({ ok: true });
  });

  app.post('/api/admin/reports/:id/resolve', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const reportId = sanitizeText(req.params.id, 64);
    const status = ['investigating', 'resolved', 'dismissed'].includes(req.body?.status) ? req.body.status : 'resolved';
    const notes = sanitizeText(req.body?.resolution_notes, 400);
    const removePost = req.body?.remove_post === true;

    const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId) as any;
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    db.prepare(
      `UPDATE reports SET status = ?, resolution_notes = ?, resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`
    ).run(status, notes, req.authUser!.id, reportId);

    if (removePost && report.target_type === 'post') {
      db.prepare(`UPDATE community_posts SET moderation_status = 'removed' WHERE id = ?`).run(report.target_id);
    }

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, ?, 'report', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      `report_${status}`,
      reportId,
      JSON.stringify({ notes, removePost })
    );

    res.json({ ok: true });
  });

  app.put('/api/admin/guidelines', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const guidelines = Array.isArray(req.body?.guidelines)
      ? req.body.guidelines.map((g: unknown) => sanitizeText(g, 300)).filter(Boolean)
      : [];
    if (guidelines.length === 0) {
      res.status(400).json({ error: 'At least one guideline is required.' });
      return;
    }

    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('community_guidelines', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
    ).run(JSON.stringify(guidelines));

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, 'update_community_guidelines', 'settings', 'community_guidelines', ?)`
    ).run(`aud_${crypto.randomBytes(8).toString('hex')}`, req.authUser!.id, JSON.stringify({ count: guidelines.length }));

    res.json({ ok: true, guidelines });
  });

  app.post('/api/admin/users/:userId/role', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const targetId = sanitizeText(req.params.userId, 64);
    const nextRole = req.body?.role;
    if (!['member', 'moderator', 'admin'].includes(nextRole)) {
      res.status(400).json({ error: 'Role must be member, moderator, or admin.' });
      return;
    }
    if (targetId === req.authUser!.id && nextRole !== 'admin') {
      res.status(400).json({ error: 'You cannot demote your own active admin session.' });
      return;
    }
    const target = db.prepare(`SELECT id, email FROM users WHERE id = ?`).get(targetId) as
      | { id: string; email: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const ownerAdminEmail = (process.env.ADMIN_OWNER_EMAIL || 'yusufaguilar2008@gmail.com').trim().toLowerCase();
    if (target.email.toLowerCase() === ownerAdminEmail && nextRole !== 'admin') {
      res.status(403).json({ error: 'The Owner Admin role cannot be revoked.' });
      return;
    }

    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(nextRole, targetId);
    if (nextRole === 'admin' || nextRole === 'moderator') {
      db.prepare(
        `INSERT INTO admin_roles (user_id, role_name, granted_by)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET role_name = excluded.role_name, granted_by = excluded.granted_by`
      ).run(targetId, nextRole === 'admin' ? 'Admin' : 'Moderator', req.authUser!.id);
    } else {
      db.prepare(`DELETE FROM admin_roles WHERE user_id = ?`).run(targetId);
    }

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, 'set_user_role', 'user', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      targetId,
      JSON.stringify({ role: nextRole })
    );

    res.json({ ok: true });
  });

  app.post('/api/admin/gyms', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const name = sanitizeText(req.body?.name, 100);
    const area = sanitizeText(req.body?.area, 80);
    const city = sanitizeText(req.body?.city, 60);
    const country = sanitizeText(req.body?.country, 60) || 'UAE';
    const category = sanitizeText(req.body?.category, 60) || 'Commercial Gym';
    const lat = Number.isFinite(Number(req.body?.latitude_approx)) ? Number(req.body.latitude_approx) : 24.47;
    const lon = Number.isFinite(Number(req.body?.longitude_approx)) ? Number(req.body.longitude_approx) : 54.37;

    if (!name || !area || !city) {
      res.status(400).json({ error: 'Gym name, area, and city are required.' });
      return;
    }

    const gymId = `gym_${crypto.randomBytes(6).toString('hex')}`;
    db.prepare(
      `INSERT INTO gyms (id, name, area, city, country, category, latitude_approx, longitude_approx, verified_partner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(gymId, name, area, city, country, category, lat, lon);

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, 'add_gym_partner', 'gym', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      gymId,
      JSON.stringify({ name, area, city, country })
    );

    const gym = db.prepare(`SELECT * FROM gyms WHERE id = ?`).get(gymId);
    res.status(201).json({ gym });
  });

  app.post('/api/admin/posts/:postId/moderate', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const postId = sanitizeText(req.params.postId, 64);
    const nextStatus = req.body?.moderation_status === 'removed' ? 'removed' : 'published';

    const post = db.prepare(`SELECT id, title FROM community_posts WHERE id = ?`).get(postId) as
      | { id: string; title: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Community post not found.' });
      return;
    }

    db.prepare(`UPDATE community_posts SET moderation_status = ? WHERE id = ?`).run(nextStatus, postId);
    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
       VALUES (?, ?, ?, 'post', ?, ?)`
    ).run(
      `aud_${crypto.randomBytes(8).toString('hex')}`,
      req.authUser!.id,
      `moderate_post_${nextStatus}`,
      postId,
      JSON.stringify({ title: post.title })
    );

    res.json({ ok: true, moderation_status: nextStatus });
  });

  app.delete('/api/admin/gyms/:gymId', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const gymId = sanitizeText(req.params.gymId, 64);
    const gym = db.prepare(`SELECT id, name FROM gyms WHERE id = ?`).get(gymId) as { id: string; name: string } | undefined;
    if (!gym) {
      res.status(404).json({ error: 'Gym not found.' });
      return;
    }

    const activeMeetups = (
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM meetups WHERE gym_id = ? AND status IN ('scheduled', 'checked_in')`)
        .get(gymId) as { cnt: number }
    ).cnt;
    if (activeMeetups > 0) {
      res.status(400).json({ error: 'Cannot delete a gym with active or upcoming Meet Safely sessions.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`UPDATE profiles SET gym_id = NULL WHERE gym_id = ?`).run(gymId);
      db.prepare(`DELETE FROM meetups WHERE gym_id = ?`).run(gymId);
      db.prepare(`DELETE FROM gyms WHERE id = ?`).run(gymId);
      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json)
         VALUES (?, ?, 'delete_gym_partner', 'gym', ?, ?)`
      ).run(`aud_${crypto.randomBytes(8).toString('hex')}`, req.authUser!.id, gymId, JSON.stringify({ name: gym.name }));
    });
    tx();

    res.json({ ok: true });
  });
}
