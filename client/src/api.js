import { auth } from './firebase.js';

const BASE = import.meta.env.VITE_API_URL || '';
const DEV_KEY = 'labLoans.devEmail';

export const devSession = {
  get() {
    try {
      return localStorage.getItem(DEV_KEY);
    } catch {
      return null;
    }
  },
  set(email) {
    try {
      localStorage.setItem(DEV_KEY, email);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(DEV_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function getToken() {
  const devEmail = devSession.get();
  if (devEmail) return `dev:${devEmail}`;
  return auth?.currentUser ? auth.currentUser.getIdToken() : null;
}

// Every request carries the Google ID token; errors come back as ApiError
// using the server's { error: { status, code, message, details } } shape.
export async function api(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data;
}
