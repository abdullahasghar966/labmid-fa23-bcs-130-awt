import { config } from '../config.js';
import { query } from '../db.js';
import { ApiError, forbidden } from '../errors.js';
import { firebaseAuth } from '../firebase.js';
import { publishRole } from '../services/events.js';

// Authentication: React signs in with Google (OAuth 2.0 via Firebase Auth) and
// sends the ID token as "Authorization: Bearer <token>". We verify it here.
async function identify(token) {
  if (config.devAuthBypass && token.startsWith('dev:')) {
    const email = token.slice(4).trim().toLowerCase();
    if (!email.includes('@')) throw new ApiError(401, 'UNAUTHENTICATED', 'Bad dev token');
    return { uid: `dev-${email.replace(/[^a-z0-9]/g, '_')}`, email, name: email.split('@')[0] };
  }

  const auth = firebaseAuth();
  if (!auth) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Google sign-in is not configured on the server');
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
  }
  if (decoded.firebase?.sign_in_provider !== 'google.com' || !decoded.email) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in with a Google account');
  }
  return { uid: decoded.uid, email: decoded.email.toLowerCase(), name: decoded.name || null };
}

// First sign-in creates the user as a student (or admin if listed in ADMIN_EMAILS).
// Matching on email lets an admin pre-assign a role before the person signs in.
async function upsertUser({ uid, email, name }) {
  const isAdminEmail = config.adminEmails.includes(email);

  const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
  const row = existing.rows[0];
  if (row && row.firebase_uid === uid && (!isAdminEmail || row.role === 'admin')) {
    return row;
  }

  const { rows } = await query(
    `INSERT INTO users (firebase_uid, email, name, role, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (email) DO UPDATE SET
       firebase_uid  = EXCLUDED.firebase_uid,
       name          = COALESCE(EXCLUDED.name, users.name),
       role          = CASE WHEN $5 THEN 'admin'::user_role ELSE users.role END,
       last_login_at = now()
     RETURNING *`,
    [uid, email, name, isAdminEmail ? 'admin' : 'student', isAdminEmail],
  );
  publishRole(uid, rows[0].role);
  return rows[0];
}

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in with Google first');

  const user = await upsertUser(await identify(token));
  req.user = { id: user.id, uid: user.firebase_uid, email: user.email, name: user.name, role: user.role };
  next();
}

// RBAC: admin can do everything staff can (see the Auth & RBAC matrix).
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      throw forbidden(`This action needs role: ${roles.join(' or ')}`);
    }
    next();
  };

export const STAFF = ['staff', 'admin'];
export const isStaff = (user) => STAFF.includes(user.role);
