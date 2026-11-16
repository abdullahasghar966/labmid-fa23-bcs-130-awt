import { ServerValue } from 'firebase-admin/database';
import { firebaseDb } from '../firebase.js';

// Real-time event catalogue (Rule 7: changes are published live, no refresh).
//
// Firebase Realtime Database paths (security rules in firebase/database.rules.json):
//   live/public        -> every signed-in user       (availability changes)
//   live/staff         -> staff + admin only          (all loan changes)
//   live/users/{uid}   -> only that student           (their own loan updates)
//   roles/{uid}        -> the user's role, used by the security rules

export const EVENTS = {
  AVAILABILITY_CHANGED: 'availability:changed',
  LOAN_CREATED: 'loan:created',
  LOAN_UPDATED: 'loan:updated',
  EQUIPMENT_AVAILABLE: 'equipment:available',
};

export const EVENT_CATALOGUE = [
  {
    name: EVENTS.AVAILABILITY_CHANGED,
    channel: 'live/public',
    audience: 'Everyone signed in (students, staff, admin)',
    trigger: 'Equipment created/updated/deleted, or units left change (book, cancel, complete)',
    payload: '{ type, action, equipment: { id, name, quantity, unitsOnLoan, unitsLeft, ... }, at }',
  },
  {
    name: EVENTS.LOAN_CREATED,
    channel: 'live/users/{uid} + live/staff',
    audience: 'The student who booked + all staff/admin',
    trigger: 'A student books equipment successfully',
    payload: '{ type, loan, at }',
  },
  {
    name: EVENTS.LOAN_UPDATED,
    channel: 'live/users/{uid} + live/staff',
    audience: 'The owning student only + all staff/admin',
    trigger: 'Status change (confirm/complete/cancel), loan amount set, payment recorded',
    payload: '{ type, change, loan, at }',
  },
  {
    name: EVENTS.EQUIPMENT_AVAILABLE,
    channel: 'live/users/{uid}',
    audience: 'Only the student who asked "notify me when available"',
    trigger: 'Units left rise to at least the number of units the student wanted',
    payload: '{ type, equipment, unitsWanted, at }',
  },
];

// Last events kept in memory (for tests / debugging even without Firebase).
export const recentEvents = [];

const clean = (obj) => JSON.parse(JSON.stringify(obj)); // Firebase rejects undefined / Date

function emit(channel, payload) {
  recentEvents.push({ channel, ...clean(payload), at: Date.now() });
  if (recentEvents.length > 200) recentEvents.shift();

  const db = firebaseDb();
  if (!db) return;
  db.ref(`live/${channel}`)
    .push({ ...clean(payload), at: ServerValue.TIMESTAMP })
    .catch((err) => console.error(`[live] publish to ${channel} failed:`, err.message));
}

export function publishAvailabilityChanged(action, equipment) {
  emit('public', { type: EVENTS.AVAILABILITY_CHANGED, action, equipment });
}

export function publishLoan(type, loan, studentUid, change = undefined) {
  const payload = { type, change, loan };
  if (studentUid) emit(`users/${studentUid}`, payload); // the owner only
  emit('staff', payload);
}

export function publishEquipmentAvailable(studentUid, equipment, unitsWanted) {
  if (!studentUid) return;
  emit(`users/${studentUid}`, { type: EVENTS.EQUIPMENT_AVAILABLE, equipment, unitsWanted });
}

export function publishRole(uid, role) {
  const db = firebaseDb();
  if (!db || !uid) return Promise.resolve();
  return db
    .ref(`roles/${uid}`)
    .set(role)
    .catch((err) => console.error('[live] role sync failed:', err.message));
}
