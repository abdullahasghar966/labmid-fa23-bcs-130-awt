import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requireRole, isStaff, STAFF } from '../middleware/auth.js';
import { idParam, integer, money, text, round2 } from '../validate.js';
import { lockEquipment, touchAvailability, availabilityChanged } from '../services/availability.js';
import { LOAN_SELECT, toLoan, findLoan, TRANSITIONS, STATUSES } from '../services/loans.js';
import { publishLoan, EVENTS } from '../services/events.js';

// (B) Loan
export const loansRouter = Router();
const staffOnly = requireRole(...STAFF);

// Rule 2: a student may only see their own loan. Staff/admin see any.
async function loadVisibleLoan(req) {
  const found = await findLoan({ query }, idParam(req.params.id));
  if (!found) throw notFound('Loan');
  if (!isStaff(req.user) && found.loan.studentId !== req.user.id) {
    throw forbidden('You can only access your own loans');
  }
  return found;
}

// CREATE - Rule 2 (students only) + Rule 5 (409 when not enough units left)
loansRouter.post('/', requireRole('student'), async (req, res) => {
  const equipmentId = integer(req.body.equipmentId, 'equipmentId', { min: 1, max: 2 ** 31 - 1 });
  const quantity = integer(req.body.quantity ?? 1, 'quantity', { min: 1 });
  const notes = text(req.body.notes, 'notes', { max: 500 }) ?? '';

  const loanId = await withTransaction(async (client) => {
    // Row lock: concurrent bookings for the same equipment are serialised here,
    // so the last unit can never be loaned twice.
    const equipment = await lockEquipment(client, equipmentId);
    if (!equipment) throw notFound('Equipment');

    if (quantity > equipment.unitsLeft) {
      throw conflict(
        'NOT_ENOUGH_UNITS',
        `Not enough units left: you asked for ${quantity}, only ${equipment.unitsLeft} of ${equipment.name} left`,
        { equipmentId, requested: quantity, unitsLeft: equipment.unitsLeft },
      );
    }

    const { rows } = await client.query(
      `INSERT INTO loans (equipment_id, student_id, quantity, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [equipmentId, req.user.id, quantity, notes],
    );
    await touchAvailability(client, equipmentId);
    return rows[0].id;
  });

  const { loan, studentUid } = await findLoan({ query }, loanId);
  publishLoan(EVENTS.LOAN_CREATED, loan, studentUid);
  await availabilityChanged(equipmentId, 'loan-created');
  res.status(201).json(loan);
});

// LIST - Rule 3: staff see all loans; Rule 2: a student sees only their own
loansRouter.get('/', async (req, res) => {
  const where = [];
  const params = [];

  if (!isStaff(req.user)) {
    params.push(req.user.id);
    where.push(`l.student_id = $${params.length}`);
  }
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) throw badRequest(`status must be one of ${STATUSES}`);
    params.push(req.query.status);
    where.push(`l.status = $${params.length}`);
  }

  const { rows } = await query(
    `${LOAN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.created_at DESC`,
    params,
  );
  res.json(rows.map(toLoan));
});

loansRouter.get('/:id', async (req, res) => {
  res.json((await loadVisibleLoan(req)).loan);
});

// STATUS ("loan set by staff") - Rule 4: forward only.
//   staff/admin: pending -> confirmed -> completed, or -> cancelled
//   student    : may only cancel their OWN loan
loansRouter.patch('/:id/status', async (req, res) => {
  const { loan } = await loadVisibleLoan(req);
  const to = req.body.status;
  if (!STATUSES.includes(to)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
  if (!isStaff(req.user) && to !== 'cancelled') {
    throw forbidden('Students can only cancel their own loans');
  }

  const transitionError = (from) =>
    conflict('INVALID_STATUS_TRANSITION', `A ${from} loan cannot become ${to} (loans only move forward)`, {
      loanId: loan.id,
      from,
      to,
      allowed: TRANSITIONS[from],
    });

  if (!TRANSITIONS[loan.status].includes(to)) throw transitionError(loan.status);

  // Only update if the status is still one that may move to `to` (safe against races).
  const allowedFrom = STATUSES.filter((s) => TRANSITIONS[s].includes(to));
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE loans SET status = $2 WHERE id = $1 AND status = ANY($3::loan_status[]) RETURNING status',
      [loan.id, to, allowedFrom],
    );
    if (!rows[0]) {
      const now = await client.query('SELECT status FROM loans WHERE id = $1', [loan.id]);
      throw transitionError(now.rows[0]?.status ?? loan.status);
    }
    // completed / cancelled give the units back
    if (to === 'completed' || to === 'cancelled') await touchAvailability(client, loan.equipmentId);
  });

  const updated = await findLoan({ query }, loan.id);
  publishLoan(EVENTS.LOAN_UPDATED, updated.loan, updated.studentUid, 'status');
  if (to === 'completed' || to === 'cancelled') {
    await availabilityChanged(loan.equipmentId, `loan-${to}`);
  }
  res.json(updated.loan);
});

// LOAN AMOUNT ("loan set by staff")
loansRouter.patch('/:id/amount', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const amount = money(req.body.amount, 'amount');

  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id FROM loans WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Loan');
    const paid = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM loan_payments WHERE loan_id = $1',
      [id],
    );
    if (amount < paid.rows[0].paid) {
      throw conflict(
        'AMOUNT_BELOW_PAID',
        `Loan amount cannot be lower than the ${paid.rows[0].paid} already paid`,
        { loanId: id, amount, amountPaid: paid.rows[0].paid },
      );
    }
    await client.query('UPDATE loans SET loan_amount = $2, amount_set_by = $3 WHERE id = $1', [
      id,
      amount,
      req.user.id,
    ]);
  });

  const updated = await findLoan({ query }, id);
  publishLoan(EVENTS.LOAN_UPDATED, updated.loan, updated.studentUid, 'amount');
  res.json(updated.loan);
});

// "How much loan paid (to loan set by staff)" - summary + history
loansRouter.get('/:id/payments', async (req, res) => {
  const { loan } = await loadVisibleLoan(req);
  const { rows } = await query(
    `SELECT p.id, p.amount, p.created_at, u.email AS recorded_by
     FROM loan_payments p LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.loan_id = $1 ORDER BY p.created_at`,
    [loan.id],
  );
  res.json({
    loanId: loan.id,
    loanAmount: loan.loanAmount,
    amountPaid: loan.amountPaid,
    remaining: loan.remaining,
    fullyPaid: loan.loanAmount > 0 && loan.remaining === 0,
    payments: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      recordedBy: r.recorded_by,
      createdAt: r.created_at,
    })),
  });
});

// Staff record a payment received against the loan amount
loansRouter.post('/:id/payments', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const amount = money(req.body.amount, 'amount', { min: 0.01 });

  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT loan_amount FROM loans WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Loan');
    const paid = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM loan_payments WHERE loan_id = $1',
      [id],
    );
    const remaining = round2(rows[0].loan_amount - paid.rows[0].paid);
    if (amount > remaining) {
      throw conflict(
        'PAYMENT_EXCEEDS_BALANCE',
        `Payment of ${amount} is more than the remaining balance of ${remaining}`,
        { loanId: id, amount, remaining },
      );
    }
    await client.query(
      'INSERT INTO loan_payments (loan_id, amount, recorded_by) VALUES ($1, $2, $3)',
      [id, amount, req.user.id],
    );
  });

  const updated = await findLoan({ query }, id);
  publishLoan(EVENTS.LOAN_UPDATED, updated.loan, updated.studentUid, 'payment');
  res.status(201).json(updated.loan);
});
