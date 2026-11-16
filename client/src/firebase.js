import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

// The Firebase web config comes from the API (GET /api/meta/client-config),
// so the only file to fill in is server/.env. These are live ES-module
// bindings: they are set once by initFirebase() before the app renders.
export let firebaseEnabled = false;
export let auth = null; // Google Auth 2.0 sign-in
export let realtimeDb = null; // live events channel
export let devLoginEnabled = false; // testing only (AUTH_DEV_BYPASS on the API)

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function initFirebase() {
  let clientConfig = { firebase: null, devLogin: false };
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/meta/client-config`);
    if (res.ok) clientConfig = await res.json();
  } catch {
    /* API not reachable yet - the login page will say so */
  }

  devLoginEnabled = clientConfig.devLogin;
  if (clientConfig.firebase) {
    const app = initializeApp(clientConfig.firebase);
    firebaseEnabled = true;
    auth = getAuth(app);
    realtimeDb = clientConfig.firebase.databaseURL ? getDatabase(app) : null;
  }
}
