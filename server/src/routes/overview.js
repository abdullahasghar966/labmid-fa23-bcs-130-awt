import { Router } from 'express';
import { query } from '../db.js';
import { badRequest } from '../errors.js';
import { isStaff } from '../middleware/auth.js';
import { EQUIPMENT_SELECT, toEquipment } from '../services/availability.js';
import { LOAN_SELECT, toLoan, STATUSES } from '../services/loans.js';
import { round2 } from '../validate.js';

// "Availability changed or not" - GET /api/availability/changes?since=<ISO time>
export const availabilityRouter = Router();

availabilityRouter.get('/changes', async (req, res) => {
  let since = null;
  if (req.query.since) {
    since = new Date(req.query.since);
    if (Number.isNaN(since.getTime())) throw badRequest('since must be an ISO date-time');
  }
  const { rows } = await query(
    `${EQUIPMENT_SELECT} ${since ? 'WHERE e.availability_changed_at > $1' : ''}
     ORDER BY e.availability_changed_at`,
    since ? [since] : [],
  );
  const checkedAt = (await query('SELECT now() AS now')).rows[0].now;
  res.json({
    since,
    checkedAt, // pass this back as ?since= next time
    changed: rows.length > 0,
    equipment: rows.map(toEquipment),
  });
});

// "API for interconnection of all" - one call that joins equipment, loans,
// availability and payments, scoped by role (student = own data only).
export const overviewRouter = Router();

overviewRouter.get('/', async (req, res) => {
  const staff = isStaff(req.user);
  const scope = staff ? '' : 'WHERE l.student_id = $1';
  const params = staff ? [] : [req.user.id];

  const [equipment, byStatus, money, recent] = await Promise.all([
    query(`${EQUIPMENT_SELECT} ORDER BY e.name`),
    query(`SELECT l.status, COUNT(*) AS n FROM loans l ${scope} GROUP BY l.status`, params),
    query(
      `SELECT COALESCE(SUM(l.loan_amount), 0) AS amount_set,
              COALESCE(SUM((SELECT SUM(p.amount) FROM loan_payments p WHERE p.loan_id = l.id)), 0) AS amount_paid
       FROM loans l ${scope}`,
      params,
    ),
    query(`${LOAN_SELECT} ${scope} ORDER BY l.created_at DESC LIMIT 5`, params),
  ]);

  const items = equipment.rows.map(toEquipment);
  const loansByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of byStatus.rows) loansByStatus[r.status] = r.n;
  const { amount_set: amountSet, amount_paid: amountPaid } = money.rows[0];

  res.json({
    user: req.user,
    scope: staff ? 'all loans' : 'my loans',
    equipment: {
      items: items.length,
      totalUnits: items.reduce((s, e) => s + e.quantity, 0),
      unitsOnLoan: items.reduce((s, e) => s + e.unitsOnLoan, 0),
      unitsLeft: items.reduce((s, e) => s + e.unitsLeft, 0),
      outOfStock: items.filter((e) => e.unitsLeft === 0).map((e) => ({ id: e.id, name: e.name })),
    },
    loans: { byStatus: loansByStatus, total: Object.values(loansByStatus).reduce((a, b) => a + b, 0) },
    payments: { loanAmountSet: amountSet, amountPaid, outstanding: round2(amountSet - amountPaid) },
    recentLoans: recent.rows.map(toLoan),
    links: {
      equipment: '/api/equipment',
      availabilityChanges: '/api/availability/changes',
      loans: '/api/loans',
      errors: '/api/meta/errors',
      events: '/api/meta/events',
    },
  });
});
