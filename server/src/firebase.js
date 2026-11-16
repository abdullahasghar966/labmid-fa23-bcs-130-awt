import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { config } from './config.js';

// Firebase has two jobs in this design (see the infra diagram):
//   - Authentication: verifies the Google (OAuth 2.0) sign-in token sent by React
//   - Realtime Database: carries live events from the API to every browser
// PostgreSQL stays the source of truth for all data.

let app = null;
let initialised = false;

// The service-account key comes from a file locally (FIREBASE_SERVICE_ACCOUNT_PATH)
// or, on a hosting service, from an env var holding the JSON (FIREBASE_SERVICE_ACCOUNT_JSON).
function loadServiceAccount() {
  const { serviceAccountJson, serviceAccountPath } = config.firebase;
  if (serviceAccountJson) {
    const text = serviceAccountJson.trim().startsWith('{')
      ? serviceAccountJson
      : Buffer.from(serviceAccountJson, 'base64').toString('utf8');
    return JSON.parse(text);
  }
  if (serviceAccountPath && existsSync(serviceAccountPath)) {
    return JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  }
  return null;
}

function init() {
  if (initialised) return app;
  initialised = true;

  let serviceAccount;
  try {
    serviceAccount = loadServiceAccount();
  } catch (err) {
    console.warn(`[firebase] Could not read the service-account key: ${err.message}`);
  }
  if (!serviceAccount) {
    console.warn('[firebase] No service-account key found. Google sign-in and live events are disabled.');
    return null;
  }

  app = initializeApp({ credential: cert(serviceAccount), databaseURL: config.firebase.databaseURL });
  if (!config.firebase.databaseURL) {
    console.warn('[firebase] FIREBASE_DATABASE_URL missing - live events are disabled.');
  }
  return app;
}

export const firebaseAuth = () => (init() ? getAuth(app) : null);
export const firebaseDb = () => (init() && config.firebase.databaseURL ? getDatabase(app) : null);
