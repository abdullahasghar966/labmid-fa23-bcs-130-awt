import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { StatusBadge, formatDate } from './ui.jsx';

// Application diagram:
//   Open website -> View lab equipments (name + quantities)
//   Student: Book -> conflict?  yes -> Rejection (409 not enough units left) -> notify when available
//                               no  -> Acceptance -> Cancel
//   Staff: full CRUD on equipment + list loans of one equipment
export default function EquipmentPage({ me, equipment, flash, reloadEquipment, upsertLoan, toast }) {
  const isStaff = me.role === 'staff' || me.role === 'admin';
  const [search, setSearch] = useState('');

  const shown = equipment.filter((e) =>
    `${e.name} ${e.description}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Lab Equipment</h2>
          <p className="muted">
            {isStaff
              ? 'Add, edit and remove equipment. Units left update live for everyone.'
              : 'Choose how many units you need and book. Units left update live.'}
          </p>
        </div>
        <input
          className="search"
          placeholder="Search equipment…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isStaff && <AddEquipment onAdded={reloadEquipment} toast={toast} />}

      <div className="grid">
        {shown.map((e) => (
          <EquipmentCard
            key={e.id}
            equipment={e}
            isStaff={isStaff}
            flashedAt={flash[e.id]}
            reloadEquipment={reloadEquipment}
            upsertLoan={upsertLoan}
            toast={toast}
          />
        ))}
        {shown.length === 0 && <p className="muted">No equipment found.</p>}
      </div>
    </section>
  );
}

function AddEquipment({ onAdded, toast }) {
  const [form, setForm] = useState({ name: '', description: '', quantity: 1 });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/equipment', { method: 'POST', body: { ...form, quantity: Number(form.quantity) } });
      toast(`Added ${form.name}`, 'success');
      setForm({ name: '', description: '', quantity: 1 });
      onAdded();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card add-form" onSubmit={submit}>
      <strong>Add equipment</strong>
      <input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input
        placeholder="Description"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <input
        type="number"
        min="0"
        required
        value={form.quantity}
        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        aria-label="Quantity"
      />
      <button type="submit">Add</button>
      {error && <span className="error inline">{error}</span>}
    </form>
  );
}

function EquipmentCard({ equipment: e, isStaff, flashedAt, reloadEquipment, upsertLoan, toast }) {
  const [qty, setQty] = useState(1);
  const [result, setResult] = useState(null); // accepted | rejected | waiting
  const [editing, setEditing] = useState(false);
  const [showLoans, setShowLoans] = useState(false);
  const [busy, setBusy] = useState(false);

  const pct = e.quantity ? Math.round((e.unitsLeft / e.quantity) * 100) : 0;

  const book = async () => {
    setBusy(true);
    try {
      const loan = await api('/loans', { method: 'POST', body: { equipmentId: e.id, quantity: Number(qty) } });
      setResult({ kind: 'accepted', loan });
      upsertLoan(loan);
      reloadEquipment();
    } catch (err) {
      if (err.status === 409) setResult({ kind: 'rejected', message: err.message, wanted: Number(qty) });
      else toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      const loan = await api(`/loans/${result.loan.id}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
      upsertLoan(loan);
      setResult(null);
      toast(`Loan #${loan.id} cancelled`, 'warn');
      reloadEquipment();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const notify = async () => {
    try {
      const res = await api(`/equipment/${e.id}/notify`, { method: 'POST', body: { units: result.wanted } });
      setResult({ kind: 'waiting', message: res.message });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${e.name}? This also deletes its finished loan history.`)) return;
    try {
      await api(`/equipment/${e.id}`, { method: 'DELETE' });
      toast(`Deleted ${e.name}`, 'warn');
      reloadEquipment();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (editing) {
    return (
      <EditEquipment
        equipment={e}
        onDone={() => {
          setEditing(false);
          reloadEquipment();
        }}
        toast={toast}
      />
    );
  }

  return (
    <article className="card equipment">
      <div className="eq-head">
        <h3>{e.name}</h3>
        {/* re-mounts on each live change so the pulse animation replays */}
        <span key={flashedAt ?? 0} className={`units ${e.unitsLeft === 0 ? 'none' : ''} ${flashedAt ? 'pulse' : ''}`}>
          {e.unitsLeft} / {e.quantity} left
        </span>
      </div>
      {e.description && <p className="muted">{e.description}</p>}
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>

      {!isStaff && (
        <div className="book">
          <input
            type="number"
            min="1"
            max={e.quantity}
            value={qty}
            onChange={(ev) => setQty(ev.target.value)}
            aria-label={`Units of ${e.name}`}
          />
          <button onClick={book} disabled={busy || Number(qty) < 1}>
            Book
          </button>
        </div>
      )}

      {result?.kind === 'accepted' && (
        <div className="outcome accepted">
          <strong>Acceptance</strong> Loan #{result.loan.id} for {result.loan.quantity} unit(s) is{' '}
          <StatusBadge status={result.loan.status} />
          <button className="small danger" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {result?.kind === 'rejected' && (
        <div className="outcome rejected">
          <strong>Rejection (409)</strong> {result.message}
          <button className="small" onClick={notify}>
            Notify me when available
          </button>
        </div>
      )}
      {result?.kind === 'waiting' && <div className="outcome waiting">🔔 {result.message}</div>}

      {isStaff && (
        <div className="actions">
          <button className="small" onClick={() => setEditing(true)}>Edit</button>
          <button className="small" onClick={() => setShowLoans((s) => !s)}>
            {showLoans ? 'Hide loans' : 'Loans'}
          </button>
          <button className="small danger" onClick={remove}>Delete</button>
        </div>
      )}
      {isStaff && showLoans && <NestedLoans equipmentId={e.id} unitsOnLoan={e.unitsOnLoan} />}
    </article>
  );
}

function EditEquipment({ equipment, onDone, toast }) {
  const [form, setForm] = useState({
    name: equipment.name,
    description: equipment.description,
    quantity: equipment.quantity,
  });
  const [error, setError] = useState('');

  const save = async (ev) => {
    ev.preventDefault();
    setError('');
    try {
      await api(`/equipment/${equipment.id}`, {
        method: 'PUT',
        body: { ...form, quantity: Number(form.quantity) },
      });
      toast(`Saved ${form.name}`, 'success');
      onDone();
    } catch (err) {
      setError(err.status === 409 ? `409 – ${err.message}` : err.message);
    }
  };

  return (
    <form className="card equipment editing" onSubmit={save}>
      <label>
        Name
        <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Description
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label>
        Quantity (on loan now: {equipment.unitsOnLoan})
        <input
          type="number"
          min="0"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit">Save</button>
        <button type="button" className="ghost" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

// Rule 3: GET /api/equipment/:id/loans (nested URI)
function NestedLoans({ equipmentId, unitsOnLoan }) {
  const [loans, setLoans] = useState(null);
  const [error, setError] = useState('');

  // refetch whenever the units on loan change live
  useEffect(() => {
    let active = true;
    api(`/equipment/${equipmentId}/loans`)
      .then((list) => active && setLoans(list))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [equipmentId, unitsOnLoan]);

  if (error) return <p className="error">{error}</p>;
  if (!loans) return <p className="muted">Loading loans…</p>;
  if (loans.length === 0) return <p className="muted">No loans for this equipment yet.</p>;
  return (
    <table className="mini">
      <thead>
        <tr>
          <th>#</th>
          <th>Student</th>
          <th>Units</th>
          <th>Status</th>
          <th>Booked</th>
        </tr>
      </thead>
      <tbody>
        {loans.map((l) => (
          <tr key={l.id}>
            <td>{l.id}</td>
            <td>{l.studentEmail}</td>
            <td>{l.quantity}</td>
            <td>
              <StatusBadge status={l.status} />
            </td>
            <td>{formatDate(l.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
