import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { StatusBadge, formatDate, formatMoney } from './ui.jsx';

// Uses the "interconnection" API (GET /api/overview) plus the error + event catalogues.
export default function OverviewPage({ me, liveTick, loansCount }) {
  const isStaff = me.role === 'staff' || me.role === 'admin';
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState([]);
  const [events, setEvents] = useState([]);
  const [cacheStats, setCacheStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/overview').then(setData).catch((e) => setError(e.message));
    if (isStaff) api('/cache/stats').then(setCacheStats).catch(() => {});
  }, [liveTick, loansCount, isStaff]);

  useEffect(() => {
    api('/meta/errors').then(setErrors).catch(() => {});
    api('/meta/events').then(setEvents).catch(() => {});
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Overview</h2>
          <p className="muted">Everything connected in one call: equipment, {data.scope}, payments.</p>
        </div>
      </div>

      <div className="stats">
        <div className="card">
          <span>Equipment types</span>
          <strong>{data.equipment.items}</strong>
        </div>
        <div className="card">
          <span>Units left / total</span>
          <strong>
            {data.equipment.unitsLeft} / {data.equipment.totalUnits}
          </strong>
        </div>
        <div className="card">
          <span>{isStaff ? 'All loans' : 'My loans'}</span>
          <strong>{data.loans.total}</strong>
        </div>
        <div className="card">
          <span>Loan amount paid / set</span>
          <strong>
            {formatMoney(data.payments.amountPaid)} / {formatMoney(data.payments.loanAmountSet)}
          </strong>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Loans by status</h3>
          <ul className="plain">
            {Object.entries(data.loans.byStatus).map(([s, n]) => (
              <li key={s}>
                <StatusBadge status={s} /> <strong>{n}</strong>
              </li>
            ))}
          </ul>
          <h3>Out of stock</h3>
          {data.equipment.outOfStock.length ? (
            <ul className="plain">
              {data.equipment.outOfStock.map((e) => (
                <li key={e.id}>{e.name}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing — every item has units left.</p>
          )}
        </div>
        <div className="card">
          <h3>Recent loans</h3>
          {data.recentLoans.length ? (
            <ul className="plain">
              {data.recentLoans.map((l) => (
                <li key={l.id}>
                  #{l.id} {l.quantity} × {l.equipmentName} <StatusBadge status={l.status} />
                  <small className="muted"> {formatDate(l.createdAt)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No loans yet.</p>
          )}
          {cacheStats && (
            <>
              <h3>Equipment cache</h3>
              <p className="muted">
                {cacheStats.hits} hits · {cacheStats.misses} misses · {cacheStats.invalidations} invalidations · TTL{' '}
                {cacheStats.ttlSeconds}s
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Error API</h3>
        <table className="mini">
          <thead>
            <tr>
              <th>Status</th>
              <th>Code</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e) => (
              <tr key={e.code}>
                <td>{e.status}</td>
                <td>
                  <code>{e.code}</code>
                </td>
                <td>{e.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Real-time event catalogue</h3>
        <table className="mini">
          <thead>
            <tr>
              <th>Event</th>
              <th>Who receives it</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.name}>
                <td>
                  <code>{e.name}</code>
                </td>
                <td>{e.audience}</td>
                <td>{e.trigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
