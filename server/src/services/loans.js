import { round2 } from '../validate.js';

export const LOAN_SELECT = `
  SELECT l.*, e.name AS equipment_name,
         u.email AS student_email, u.name AS student_name, u.firebase_uid AS student_uid,
         COALESCE((SELECT SUM(p.amount) FROM loan_payments p WHERE p.loan_id = l.id), 0) AS amount_paid
  FROM loans l
  JOIN equipment e ON e.id = l.equipment_id
  JOIN users u ON u.id = l.student_id`;

export const toLoan = (r) => ({
  id: r.id,
  equipmentId: r.equipment_id,
  equipmentName: r.equipment_name,
  studentId: r.student_id,
  studentEmail: r.student_email,
  studentName: r.student_name,
  quantity: r.quantity,
  status: r.status,
  notes: r.notes,
  loanAmount: r.loan_amount,
  amountPaid: r.amount_paid,
  remaining: round2(r.loan_amount - r.amount_paid),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  confirmedAt: r.confirmed_at,
  completedAt: r.completed_at,
  cancelledAt: r.cancelled_at,
});

// Returns the loan plus the owner's Firebase uid (used only to route live events).
export async function findLoan(db, id) {
  const { rows } = await db.query(`${LOAN_SELECT} WHERE l.id = $1`, [id]);
  return rows[0] ? { loan: toLoan(rows[0]), studentUid: rows[0].student_uid } : null;
}

// Rule 4: forward only.
export const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const STATUSES = Object.keys(TRANSITIONS);
