import { query } from '../db.js';
import { invalidateEquipmentCache } from '../cache.js';
import { publishAvailabilityChanged, publishEquipmentAvailable } from './events.js';

// Units left = quantity - units held by pending/confirmed loans.
export const ACTIVE_STATUSES = ['pending', 'confirmed'];

const UNITS_ON_LOAN = `COALESCE((
  SELECT SUM(l.quantity) FROM loans l
  WHERE l.equipment_id = e.id AND l.status IN ('pending', 'confirmed')
), 0)`;

export const EQUIPMENT_SELECT = `
  SELECT e.id, e.name, e.description, e.quantity, ${UNITS_ON_LOAN} AS units_on_loan,
         e.availability_changed_at, e.created_at, e.updated_at
  FROM equipment e`;

export const toEquipment = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  quantity: r.quantity,
  unitsOnLoan: r.units_on_loan,
  unitsLeft: r.quantity - r.units_on_loan,
  availabilityChangedAt: r.availability_changed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function findEquipment(db, id) {
  const { rows } = await db.query(`${EQUIPMENT_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ? toEquipment(rows[0]) : null;
}

// Locks the equipment row so two bookings can never both take the last unit.
export async function lockEquipment(client, id) {
  const { rows } = await client.query(
    'SELECT id, name, quantity FROM equipment WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!rows[0]) return null;
  const used = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS units_on_loan FROM loans
     WHERE equipment_id = $1 AND status IN ('pending', 'confirmed')`,
    [id],
  );
  const unitsOnLoan = used.rows[0].units_on_loan;
  return { ...rows[0], unitsOnLoan, unitsLeft: rows[0].quantity - unitsOnLoan };
}

export const touchAvailability = (client, equipmentId) =>
  client.query('UPDATE equipment SET availability_changed_at = now() WHERE id = $1', [equipmentId]);

// Run after a committed change to units left: clear cache, publish live, notify waiters.
export async function availabilityChanged(equipmentId, action) {
  invalidateEquipmentCache();
  const equipment = await findEquipment({ query }, equipmentId);
  if (!equipment) return;

  publishAvailabilityChanged(action, equipment);
  await notifyWaitingStudents(equipment);
}

// "Notify when available" requests that can now be satisfied.
export async function notifyWaitingStudents(equipment) {
  const { rows } = await query(
    `UPDATE availability_notifications n SET notified_at = now()
     FROM users u
     WHERE u.id = n.student_id AND n.equipment_id = $1
       AND n.notified_at IS NULL AND n.units_wanted <= $2
     RETURNING n.units_wanted, u.firebase_uid`,
    [equipment.id, equipment.unitsLeft],
  );
  for (const row of rows) {
    publishEquipmentAvailable(row.firebase_uid, equipment, row.units_wanted);
  }
}
