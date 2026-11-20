import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import type { UserRole, AccountStatus } from '../src/shared/types.ts';

let cachedSecret: string | null = null;
export function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET;
  if (envSecret && envSecret !== 'change_this_to_a_long_random_secret_in_production') {
    return envSecret;
  }
  if (cachedSecret) return cachedSecret;
  const secretFile = path.resolve(process.cwd(), 'data', '.session_secret');
  if (fs.existsSync(secretFile)) {
    const stored = fs.readFileSync(secretFile, 'utf8').trim();
    if (stored.length >= 32) {
      cachedSecret = stored;
      return cachedSecret;
    }
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  cachedSecret = generated;
  return cachedSecret;
}

export const SESSION_COOKIE_NAME = 'gymbud_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  uid: string;
  role: UserRole;
  exp: number;
}

export function signSessionToken(uid: string, role: UserRole): string {
  const payload: SessionPayload = {
    uid,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 14, // 14 days
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    role: UserRole;
    account_status: AccountStatus;
    is_plus: boolean;
  };
}

export function isUserPlus(userId: string): boolean {
  const sub = db
    .prepare(
      `SELECT id FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'cancelled')
         AND datetime(current_period_end) > datetime('now')
       LIMIT 1`
    )
    .get(userId);
  return Boolean(sub);
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userRow = db
    .prepare(`SELECT id, email, role, account_status FROM users WHERE id = ?`)
    .get(payload.uid) as
    | { id: string; email: string; role: UserRole; account_status: AccountStatus }
    | undefined;

  if (!userRow) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  if (userRow.account_status === 'suspended' || userRow.account_status === 'banned' || userRow.account_status === 'deleted') {
    res.status(403).json({ error: `Account is ${userRow.account_status}. Contact safety support.` });
    return;
  }

  db.prepare(`UPDATE users SET last_active_at = datetime('now') WHERE id = ?`).run(userRow.id);

  req.authUser = {
    ...userRow,
    is_plus: isUserPlus(userRow.id),
  };
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || (req.authUser.role !== 'admin' && req.authUser.role !== 'moderator')) {
    res.status(403).json({ error: 'Administrator privileges required' });
    return;
  }
  next();
}

// Lightweight sliding-window rate limiter to protect against spam/bots without hurting real users
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const actor = req.authUser?.id || req.ip || 'anon';
    const key = `${keyPrefix}:${actor}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      res.status(429).json({
        error: 'Rate limit reached to keep GYMBUD spam-free. Please wait a moment.',
      });
      return;
    }
    existing.count += 1;
    next();
  };
}

export function sanitizeText(value: unknown, maxLen = 1000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>]/g, '').trim().slice(0, maxLen);
}
