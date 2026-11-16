import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { StatusBadge, formatDate, formatMoney } from './ui.jsx';

// Rule 4: forward only. Which buttons each role sees for each status.
const STAFF_NEXT = {
  pending: [['confirmed', 'Confirm'], ['cancelled', 'Cancel']],
  confirmed: [['completed', 'Complete'], ['cancelled', 'Cancel']],
  completed: [],
  cancelled: [],
};
const STUDENT_NEXT = {
  pending: [['cancelled', 'Cancel']],
  confirmed: [['cancelled', 'Cancel']],
  completed: [],
  cancelled: [],
};

export default function LoansPage({ me, loans, upsertLoan, reloadLoans, reloadEquipment, toast }) {
  const isStaff = me.role === 'staff' || me.role === 'admin';
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null); // loan id with payments panel open

  useEffect(() => {
    reloadLoans();
  }, [reloadLoans]);

  const shown = status ? loans.filter((l) => l.status === status) : loans;

  const move = async (loan, to) => {
    try {
      const updated = await api(`/loans/${loan.id}/status`, { method: 'PATCH', body: { status: to } });
      upsertLoan(updated);
      toast(`Loan #${loan.id} is now ${to}`, to === 'cancelled' ? 'warn' : 'success');
      if (to === 'completed' || to === 'cancelled') reloadEquipment();
    } catch (err) {
      toast(err.status === 409 ? `409 – ${err.message}` : err.message, 'error');
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{isStaff ? 'All Loans' : 'My Loans'}</h2>
          <p className="muted">
            {isStaff
              ? 'Move loans forward: pending → confirmed → completed (or cancelled). Set the loan amount and record payments.'
              : 'Only your own loans are shown. You can cancel a pending or confirmed loan. Updates arrive live.'}
          </p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Equipment</th>
              {isStaff && <th>Student</th>}
              <th>Units</th>
              <th>Status</th>
              <th>Booked</th>
              <th>Loan amount</th>
              <th>Paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <Fragment key={l.id}>
                <tr>
                  <td>{l.id}</td>
                  <td>{l.equipmentName}</td>
                  {isStaff && <td className="ellipsis">{l.studentEmail}</td>}
                  <td>{l.quantity}</td>
                  <td>
                    <StatusBadge status={l.status} />
                  </td>
                  <td>{formatDate(l.createdAt)}</td>
                  <td>{formatMoney(l.loanAmount)}</td>
                  <td>
                    {formatMoney(l.amountPaid)}
                    {l.loanAmount > 0 && (
                      <small className={l.remaining === 0 ? 'ok' : 'muted'}>
                        {l.remaining === 0 ? ' paid' : ` (${formatMoney(l.remaining)} left)`}
                      </small>
                    )}
                  </td>
                  <td className="row-actions">
                    {(isStaff ? STAFF_NEXT : STUDENT_NEXT)[l.status].map(([to, label]) => (
                      <button
                        key={to}
                        className={`small ${to === 'cancelled' ? 'danger' : ''}`}
                        onClick={() => move(l, to)}
                      >
                        {label}
                      </button>
                    ))}
                    <button className="small ghost" onClick={() => setOpen(open === l.id ? null : l.id)}>
                      {open === l.id ? 'Close' : 'Payments'}
                    </button>
                  </td>
                </tr>
                {open === l.id && (
                  <tr className="details">
                    <td colSpan={isStaff ? 9 : 8}>
                      <Payments loan={l} isStaff={isStaff} upsertLoan={upsertLoan} toast={toast} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="muted center">
                  No loans yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// "Loan set by staff" + "How much loan paid"
function Payments({ loan, isStaff, upsertLoan, toast }) {
  const [summary, setSummary] = useState(null);
  const [amount, setAmount] = useState(loan.loanAmount);
  const [payment, setPayment] = useState('');

  useEffect(() => {
    api(`/loans/${loan.id}/payments`)
      .then(setSummary)
      .catch((e) => toast(e.message, 'error'));
  }, [loan.id, loan.amountPaid, loan.loanAmount, toast]);

  const setLoanAmount = async (e) => {
    e.preventDefault();
    try {
      upsertLoan(await api(`/loans/${loan.id}/amount`, { method: 'PATCH', body: { amount: Number(amount) } }));
      toast(`Loan amount set to ${amount}`, 'success');
    } catch (err) {
      toast(err.status === 409 ? `409 – ${err.message}` : err.message, 'error');
    }
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    try {
      upsertLoan(await api(`/loans/${loan.id}/payments`, { method: 'POST', body: { amount: Number(payment) } }));
      setPayment('');
      toast(`Payment of ${payment} recorded`, 'success');
    } catch (err) {
      toast(err.status === 409 ? `409 – ${err.message}` : err.message, 'error');
    }
  };

  if (!summary) return <p className="muted">Loading…</p>;
  return (
    <div className="payments">
      <div className="stats small-stats">
        <div>
          <span>Loan amount (set by staff)</span>
          <strong>{formatMoney(summary.loanAmount)}</strong>
        </div>
        <div>
          <span>Paid</span>
          <strong>{formatMoney(summary.amountPaid)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{formatMoney(summary.remaining)}</strong>
        </div>
      </div>

      {isStaff && (
        <div className="payment-forms">
          <form onSubmit={setLoanAmount}>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="small">Set loan amount</button>
          </form>
          <form onSubmit={recordPayment}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount received"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              required
            />
            <button className="small">Record payment</button>
          </form>
        </div>
      )}

      {summary.payments.length > 0 ? (
        <table className="mini">
          <thead>
            <tr>
              <th>Paid on</th>
              <th>Amount</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {summary.payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.createdAt)}</td>
                <td>{formatMoney(p.amount)}</td>
                <td>{p.recordedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No payments yet.</p>
      )}
    </div>
  );
}
