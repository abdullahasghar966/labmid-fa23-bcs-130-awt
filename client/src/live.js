import { ref, query, orderByChild, startAt, onChildAdded, onValue } from 'firebase/database';
import { realtimeDb } from './firebase.js';

export const isLiveEnabled = () => Boolean(realtimeDb);

// Rule 7: listen to live events - no refresh needed.
//   live/public        availability:changed            (everyone)
//   live/users/{uid}   loan:created / loan:updated /    (only me - enforced by
//                      equipment:available               Firebase security rules)
//   live/staff         loan:created / loan:updated      (staff + admin)
export function subscribeLive({ uid, role }, onEvent) {
  if (!realtimeDb || !uid) return () => {};

  const since = Date.now() - 5000; // only new events (small allowance for clock skew)
  const paths = ['live/public', `live/users/${uid}`];
  if (role === 'staff' || role === 'admin') paths.push('live/staff');

  const seen = new Set();
  const unsubscribers = paths.map((path) =>
    onChildAdded(
      query(ref(realtimeDb, path), orderByChild('at'), startAt(since)),
      (snap) => {
        if (seen.has(snap.key)) return;
        seen.add(snap.key);
        onEvent({ ...snap.val(), channel: path });
      },
      (err) => console.warn(`[live] ${path}:`, err.message),
    ),
  );
  return () => unsubscribers.forEach((off) => off());
}

// Fires when an admin changes my role, so the UI can switch views live.
export function subscribeRole(uid, onRole) {
  if (!realtimeDb || !uid) return () => {};
  return onValue(
    ref(realtimeDb, `roles/${uid}`),
    (snap) => onRole(snap.val()),
    () => {},
  );
}
