import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { sendCached, invalidateEquipmentCache } from '../cache.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { requireRole, STAFF } from '../middleware/auth.js';
import { idParam, integer, text } from '../validate.js';
import {
  EQUIPMENT_SELECT,
  toEquipment,
  findEquipment,
  lockEquipment,
  availabilityChanged,
  notifyWaitingStudents,
} from '../services/availability.js';
import { LOAN_SELECT, toLoan, STATUSES } from '../services/loans.js';
import { publishAvailabilityChanged } from '../services/events.js';

// (A) Lab Equipment - Rule 1: staff full CRUD, students read only.
export const equipmentRouter = Router();
const staffOnly = requireRole(...STAFF);

// READ (everyone) - cached, Rule 6
equipmentRouter.get('/', (req, res) =>
  sendCached(req, res, 'equipment:list', async () => {
    const { rows } = await query(`${EQUIPMENT_SELECT} ORDER BY e.name`);
    return rows.map(toEquipment);
  }),
);

equipmentRouter.get('/:id', (req, res) => {
  const id = idParam(req.params.id);
  return sendCached(req, res, `equipment:${id}`, async () => {
    const equipment = await findEquipment({ query }, id);
    if (!equipment) throw notFound('Equipment');
    return equipment;
  });
});

// "Number of lab equipments left"
equipmentRouter.get('/:id/availability', async (req, res) => {
  const equipment = await findEquipment({ query }, idParam(req.params.id));
  if (!equipment) throw notFound('Equipment');
  res.json({
    equipmentId: equipment.id,
    name: equipment.name,
    quantity: equipment.quantity,
    unitsOnLoan: equipment.unitsOnLoan,
    unitsLeft: equipment.unitsLeft,
    available: equipment.unitsLeft > 0,
    availabilityChangedAt: equipment.availabilityChangedAt,
  });
});

// CREATE (staff)
equipmentRouter.post('/', staffOnly, async (req, res) => {
  const name = text(req.body.name, 'name', { required: true, max: 100 });
  const description = text(req.body.description, 'description', { max: 500 }) ?? '';
  const quantity = integer(req.body.quantity, 'quantity');

  const { rows } = await query(
    `INSERT INTO equipment (name, description, quantity, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, description, quantity, req.user.id],
  );
  const equipment = await findEquipment({ query }, rows[0].id);
  invalidateEquipmentCache();
  publishAvailabilityChanged('created', equipment);
  res.status(201).json(equipment);
});

// UPDATE (staff) - 409 if quantity would drop below units already on loan
equipmentRouter.put('/:id', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const name = text(req.body.name, 'name', { max: 100 });
  const description = text(req.body.description, 'description', { max: 500 });
  const quantity = req.body.quantity === undefined ? undefined : integer(req.body.quantity, 'quantity');
  if (name === '') throw badRequest('name cannot be empty');
  if (name === undefined && description === undefined && quantity === undefined) {
    throw badRequest('Send at least one of: name, description, quantity');
  }

  await withTransaction(async (client) => {
    const current = await lockEquipment(client, id);
    if (!current) throw notFound('Equipment');

    if (quantity !== undefined && quantity < current.unitsOnLoan) {
      throw conflict(
        'CAPACITY_CONFLICT',
        `Cannot set quantity to ${quantity}: ${current.unitsOnLoan} unit(s) are currently on loan`,
        { equipmentId: id, requestedQuantity: quantity, unitsOnLoan: current.unitsOnLoan },
      );
    }

    await client.query(
      `UPDATE equipment SET
         name        = COALESCE($2, name),
         description = COALESCE($3, description),
         quantity    = COALESCE($4, quantity),
         availability_changed_at = CASE WHEN $4::int IS DISTINCT FROM quantity AND $4::int IS NOT NULL
                                        THEN now() ELSE availability_changed_at END,
         updated_at  = now()
       WHERE id = $1`,
      [id, name ?? null, description ?? null, quantity ?? null],
    );
  });

  await availabilityChanged(id, 'updated');
  res.json(await findEquipment({ query }, id));
});

// DELETE (staff) - 409 if the equipment is still out on loan
equipmentRouter.delete('/:id', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);

  const deleted = await withTransaction(async (client) => {
    const current = await lockEquipment(client, id);
    if (!current) throw notFound('Equipment');
    const active = await client.query(
      `SELECT COUNT(*) AS n FROM loans WHERE equipment_id = $1 AND status IN ('pending', 'confirmed')`,
      [id],
    );
    if (active.rows[0].n > 0) {
      throw conflict(
        'EQUIPMENT_HAS_ACTIVE_LOANS',
        `Cannot delete: ${active.rows[0].n} loan(s) are still pending or confirmed`,
        { equipmentId: id, activeLoans: active.rows[0].n },
      );
    }
    await client.query('DELETE FROM equipment WHERE id = $1', [id]);
    return current;
  });

  invalidateEquipmentCache();
  publishAvailabilityChanged('deleted', {
    id: deleted.id,
    name: deleted.name,
    quantity: 0,
    unitsOnLoan: 0,
    unitsLeft: 0,
  });
  res.status(204).end();
});

// Rule 3: staff list the loans of ONE equipment through a nested URI
equipmentRouter.get('/:id/loans', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const exists = await query('SELECT 1 FROM equipment WHERE id = $1', [id]);
  if (!exists.rowCount) throw notFound('Equipment');

  const params = [id];
  let filter = '';
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) throw badRequest(`status must be one of ${STATUSES}`);
    params.push(req.query.status);
    filter = ' AND l.status = $2';
  }
  const { rows } = await query(
    `${LOAN_SELECT} WHERE l.equipment_id = $1${filter} ORDER BY l.created_at DESC`,
    params,
  );
  res.json(rows.map(toLoan));
});

// Application diagram: "not enough units left -> notify when available" (students)
equipmentRouter.post('/:id/notify', requireRole('student'), async (req, res) => {
  const id = idParam(req.params.id);
  const unitsWanted = integer(req.body.units ?? 1, 'units', { min: 1 });

  const equipment = await findEquipment({ query }, id);
  if (!equipment) throw notFound('Equipment');
  if (unitsWanted > equipment.quantity) {
    throw badRequest(`The lab only owns ${equipment.quantity} unit(s) of ${equipment.name}`);
  }

  const { rows } = await query(
    `INSERT INTO availability_notifications (equipment_id, student_id, units_wanted)
     VALUES ($1, $2, $3)
     ON CONFLICT (equipment_id, student_id) WHERE notified_at IS NULL
     DO UPDATE SET units_wanted = EXCLUDED.units_wanted
     RETURNING id, equipment_id, units_wanted, created_at`,
    [id, req.user.id, unitsWanted],
  );

  // If the units are already back, notify straight away.
  if (equipment.unitsLeft >= unitsWanted) await notifyWaitingStudents(equipment);

  res.status(201).json({
    id: rows[0].id,
    equipmentId: id,
    unitsWanted: rows[0].units_wanted,
    message: `You will be notified live when ${unitsWanted} unit(s) of ${equipment.name} are available`,
  });
});
