import crypto from 'crypto';

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
  jwksUrl: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
  const jwksUrl =
    (process.env.SUPABASE_JWKS_URL || '').trim() ||
    (url ? `${url}/auth/v1/.well-known/jwks.json` : '');

  if (!url || !secretKey) return null;
  return { url, publishableKey, secretKey, jwksUrl };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseConfig());
}

function adminHeaders(cfg: SupabaseConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: cfg.secretKey,
    Authorization: `Bearer ${cfg.secretKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

let cachedJwks: { keys: any[]; fetchedAt: number } | null = null;

async function fetchJwks(jwksUrl: string): Promise<any[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < 10 * 60 * 1000) {
    return cachedJwks.keys;
  }
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const data = (await res.json()) as { keys?: any[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedJwks = { keys, fetchedAt: Date.now() };
  return keys;
}

export async function verifySupabaseJwt(token: string): Promise<{ sub: string; email?: string; user_metadata?: any } | null> {
  const cfg = getSupabaseConfig();
  if (!cfg || !cfg.jwksUrl || token.split('.').length !== 3) return null;
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: number;
      iss?: string;
      sub?: string;
      email?: string;
      user_metadata?: any;
    };

    if (!payload.sub || (payload.exp && payload.exp * 1000 < Date.now())) {
      return null;
    }
    if (payload.iss && !payload.iss.startsWith(cfg.url)) {
      return null;
    }

    const keys = await fetchJwks(cfg.jwksUrl);
    const jwk = keys.find((k) => !header.kid || k.kid === header.kid);
    if (!jwk) return null;

    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    const signature = Buffer.from(sigB64, 'base64url');

    // Support ES256 (ECDSA P-256) and RS256 JWKs
    const verified =
      header.alg === 'ES256'
        ? crypto.verify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
        : crypto.verify('sha256', signingInput, publicKey, signature);

    return verified ? { sub: payload.sub, email: payload.email, user_metadata: payload.user_metadata } : null;
  } catch {
    return null;
  }
}

export interface SupabaseAuthUserRecord {
  id: string;
  email: string;
  user_metadata?: Record<string, any>;
}

export async function listSupabaseUsers(): Promise<SupabaseAuthUserRecord[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) return [];
  try {
    const res = await fetch(
      `${cfg.url}/auth/v1/admin/users?page=1&per_page=200`,
      { headers: adminHeaders(cfg), signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { users?: SupabaseAuthUserRecord[] };
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

export async function findSupabaseUserByEmail(email: string): Promise<SupabaseAuthUserRecord | null> {
  const clean = email.trim().toLowerCase();
  const users = await listSupabaseUsers();
  return users.find((u) => (u.email || '').toLowerCase() === clean) || null;
}

export async function getSupabaseUserByAccessToken(accessToken: string): Promise<SupabaseAuthUserRecord | null> {
  const cfg = getSupabaseConfig();
  if (!cfg || !cfg.publishableKey) return null;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: {
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SupabaseAuthUserRecord;
    return data?.email ? data : null;
  } catch {
    return null;
  }
}

export async function sendSupabaseRecoveryEmail(
  email: string,
  redirectTo: string
): Promise<{ delivered: boolean; rateLimited?: boolean; error?: string }> {
  const cfg = getSupabaseConfig();
  if (!cfg || !cfg.publishableKey) {
    return { delivered: false, error: 'Supabase publishable key not configured.' };
  }
  try {
    const url = `${cfg.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        redirect_to: redirectTo,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      return { delivered: true };
    }
    const errBody = await res.json().catch(() => ({})) as { msg?: string; message?: string; error_description?: string };
    const msg = errBody.msg || errBody.message || errBody.error_description || `HTTP ${res.status}`;
    if (res.status === 429) {
      return { delivered: false, rateLimited: true, error: msg };
    }
    return { delivered: false, error: msg };
  } catch (err: any) {
    return { delivered: false, error: err?.message || 'Network error calling Supabase recovery endpoint.' };
  }
}

export async function provisionSupabaseAuthUser(params: {
  email: string;
  password: string;
  metadata: Record<string, any>;
}): Promise<{ ok: boolean; duplicate?: boolean; user?: SupabaseAuthUserRecord }> {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: false };
  try {
    const res = await fetch(`${cfg.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders(cfg),
      body: JSON.stringify({
        email: params.email.trim().toLowerCase(),
        password: params.password,
        email_confirm: true,
        user_metadata: params.metadata,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const user = (await res.json()) as SupabaseAuthUserRecord;
      return { ok: true, user };
    }
    const errBody = await res.json().catch(() => ({})) as { msg?: string; message?: string; error_code?: string };
    const errText = `${errBody.error_code || ''} ${errBody.msg || errBody.message || ''}`.toLowerCase();
    if (res.status === 422 || errText.includes('already') || errText.includes('exists')) {
      return { ok: false, duplicate: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function signInSupabaseAuth(email: string, password: string): Promise<SupabaseAuthUserRecord | null> {
  const cfg = getSupabaseConfig();
  if (!cfg || !cfg.publishableKey) return null;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SupabaseAuthUserRecord };
    return data.user || null;
  } catch {
    return null;
  }
}

export async function updateSupabaseAuthUser(params: {
  email: string;
  password?: string;
  metadata?: Record<string, any>;
}): Promise<boolean> {
  const cfg = getSupabaseConfig();
  if (!cfg) return false;
  try {
    const existing = await findSupabaseUserByEmail(params.email);
    if (!existing) return false;
    const body: Record<string, any> = {};
    if (params.password) body.password = params.password;
    if (params.metadata) {
      body.user_metadata = { ...(existing.user_metadata || {}), ...params.metadata };
    }
    const res = await fetch(`${cfg.url}/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      headers: adminHeaders(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let storageBucketEnsured = false;

export async function uploadImageToSupabaseStorage(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string | null> {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const bucket = 'gymbud-uploads';
  try {
    if (!storageBucketEnsured) {
      const checkRes = await fetch(`${cfg.url}/storage/v1/bucket/${bucket}`, {
        headers: adminHeaders(cfg),
        signal: AbortSignal.timeout(4000),
      });
      if (checkRes.status === 404 || checkRes.status === 400) {
        await fetch(`${cfg.url}/storage/v1/bucket`, {
          method: 'POST',
          headers: adminHeaders(cfg),
          body: JSON.stringify({ id: bucket, name: bucket, public: true }),
          signal: AbortSignal.timeout(4000),
        });
      }
      storageBucketEnsured = true;
    }

    const uploadRes = await fetch(`${cfg.url}/storage/v1/object/${bucket}/${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: {
        apikey: cfg.secretKey,
        Authorization: `Bearer ${cfg.secretKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(8000),
    });
    if (!uploadRes.ok) return null;
    return `${cfg.url}/storage/v1/object/public/${bucket}/${encodeURIComponent(filename)}`;
  } catch {
    return null;
  }
}

export async function checkSupabaseTablesReady(): Promise<boolean> {
  const cfg = getSupabaseConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/gyms?select=id&limit=1`, {
      headers: adminHeaders(cfg),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
