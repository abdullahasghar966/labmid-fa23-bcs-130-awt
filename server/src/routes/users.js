import { Router } from 'express';
import { query } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { idParam, text } from '../validate.js';
import { publishRole } from '../services/events.js';

const ROLES = ['admin', 'staff', 'student'];
const toUser = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

// Who am I? (the first call after Google sign-in also registers the user)
export const authRouter = Router();
authRouter.get('/me', async (req, res) => {
  // Make sure Firebase knows my role before the browser opens live channels.
  await publishRole(req.user.uid, req.user.role);
  res.json(req.user);
});

// Admin: manage roles
export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

usersRouter.get('/', async (_req, res) => {
  const { rows } = await query('SELECT * FROM users ORDER BY role, email');
  res.json(rows.map(toUser));
});

// Pre-register someone by email (e.g. a staff member who has not signed in yet)
usersRouter.post('/', async (req, res) => {
  const email = text(req.body.email, 'email', { required: true, max: 200 }).toLowerCase();
  const role = req.body.role ?? 'student';
  if (!email.includes('@')) throw badRequest('email must be a valid email address');
  if (!ROLES.includes(role)) throw badRequest(`role must be one of ${ROLES.join(', ')}`);
  const { rows } = await query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING *', [email, role]);
  res.status(201).json(toUser(rows[0]));
});

usersRouter.patch('/:id/role', async (req, res) => {
  const id = idParam(req.params.id);
  const { role } = req.body;
  if (!ROLES.includes(role)) throw badRequest(`role must be one of ${ROLES.join(', ')}`);
  if (id === req.user.id) throw badRequest('You cannot change your own role');

  const { rows } = await query('UPDATE users SET role = $2 WHERE id = $1 RETURNING *', [id, role]);
  if (!rows[0]) throw notFound('User');
  publishRole(rows[0].firebase_uid, role); // live channels follow the new role at once
  res.json(toUser(rows[0]));
});
