import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, firebaseEnabled, devLoginEnabled } from '../firebase.js';

export default function Login({ error, busy, onDevLogin, onSignOut }) {
  const [message, setMessage] = useState('');
  const [devEmail, setDevEmail] = useState('');

  const google = async () => {
    setMessage('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') setMessage(err.message);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <span className="logo big">⚗</span>
        <h1>Lab Equipment Loans</h1>
        <p className="muted">Browse lab equipment, request loans and follow them live.</p>

        {busy ? (
          <p>Signing you in…</p>
        ) : (
          <>
            <button className="google" onClick={google} disabled={!firebaseEnabled}>
              <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Sign in with Google
            </button>
            {!firebaseEnabled && <p className="error">Google sign-in is not set up yet: run "npm run setup" and fill in the Firebase values.</p>}
          </>
        )}

        {(error || message) && (
          <div className="error">
            {error || message}
            {error && (
              <button className="link" onClick={onSignOut}>
                Try again
              </button>
            )}
          </div>
        )}

        {devLoginEnabled && (
          <form
            className="dev-login"
            onSubmit={(e) => {
              e.preventDefault();
              if (devEmail.includes('@')) onDevLogin(devEmail.trim().toLowerCase());
            }}
          >
            <small>Test login (AUTH_DEV_BYPASS only)</small>
            <div className="row">
              <input
                type="email"
                placeholder="someone@test.edu"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
              />
              <button type="submit">Enter</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
