import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// All settings live in ONE file: server/.env (created by `npm run setup`).
export const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');
dotenv.config({ path: path.join(SERVER_DIR, '.env'), quiet: true });

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const fromServerDir = (p) => (p ? path.resolve(SERVER_DIR, p) : undefined);

const firebaseWeb = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  appId: process.env.FIREBASE_APP_ID,
};

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5433/lab_loans',

  // Google accounts listed here become admin on first sign-in.
  adminEmails: list(process.env.ADMIN_EMAILS),

  // Testing only: lets "Bearer dev:<email>" act as a signed-in user.
  // Never active when NODE_ENV=production.
  devAuthBypass:
    process.env.AUTH_DEV_BYPASS === 'true' && process.env.NODE_ENV !== 'production',

  firebase: {
    serviceAccountPath: fromServerDir(process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON, // hosting: JSON or base64
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    // Public web config, sent to the browser by GET /api/meta/client-config
    web: firebaseWeb.apiKey && firebaseWeb.authDomain ? firebaseWeb : null,
  },

  // Caching plan: equipment browsing is cached in the API for this long
  // (and invalidated immediately on any change).
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 60),

  corsOrigins: list(process.env.CORS_ORIGIN || 'http://localhost:5173'),

  // Built React app. When it exists, the API serves it too, so the whole
  // app runs on one link (http://localhost:4000).
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
};

export const hasClientBuild = () => existsSync(path.join(config.clientDist, 'index.html'));
