import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
} from 'firebase/auth';
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
    // Initialise sign-in with per-tab storage from the start (sessionStorage), so each
    // browser tab keeps its own Google account: two tabs can be signed in as two
    // different users, and signing out in one tab does not affect the other.
    // (Closing a tab signs that tab out.)
    auth = initializeAuth(app, {
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    realtimeDb = clientConfig.firebase.databaseURL ? getDatabase(app) : null;
  }
}
