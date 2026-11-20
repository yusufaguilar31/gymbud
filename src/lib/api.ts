const SESSION_STORAGE_KEY = 'gymbud_session_token';
let memoryToken: string | null = null;

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch {
    // sessionStorage unavailable in restricted iframe
  }
  return null;
}

export function setSessionToken(token: string | null | undefined): void {
  if (!token) return;
  memoryToken = token;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Ignore storage errors in strict sandboxed frames
  }
}

export function clearSessionToken(): void {
  memoryToken = null;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

const API_BASE_URL = ((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getSessionToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(resolveApiUrl(path), {
    ...options,
    credentials: 'include',
    headers,
  });

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const trimmed = text.trim();
      const isHtmlOrEdgeNotFound =
        trimmed.startsWith('<!') ||
        trimmed.startsWith('<html') ||
        trimmed.includes('NOT_FOUND') ||
        trimmed.includes('The page could not be found');
      data = {
        error:
          res.status === 404 && isHtmlOrEdgeNotFound
            ? 'API endpoint not found (404). Make sure the backend server or Vercel /api routes are deployed.'
            : isHtmlOrEdgeNotFound
              ? `Unexpected server response (${res.status}).`
              : trimmed,
      };
    }
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith('/api/auth/login') &&
      !path.startsWith('/api/auth/register') &&
      !path.startsWith('/api/auth/reset-password') &&
      path !== '/api/auth/me'
    ) {
      clearSessionToken();
      window.dispatchEvent(new CustomEvent('gymbud:unauthorized'));
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export function fileToCompressedDataUrl(file: File, maxWidth = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
