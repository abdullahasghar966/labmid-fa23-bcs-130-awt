import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './ui.jsx';

// Admin only: assign roles (admin / staff / student).
export default function UsersPage({ me, toast }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: '', role: 'staff' });

  const load = useCallback(() => api('/users').then(setUsers).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (user, role) => {
    try {
      await api(`/users/${user.id}/role`, { method: 'PATCH', body: { role } });
      toast(`${user.email} is now ${role}`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: form });
      toast(`${form.email} added as ${form.role}`, 'success');
      setForm({ email: '', role: 'staff' });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Users &amp; Roles</h2>
          <p className="muted">
            Everyone who signs in with Google starts as a student. Promote staff here, or add their email before they
            sign in.
          </p>
        </div>
      </div>

      <form className="card add-form" onSubmit={add}>
        <strong>Add by email</strong>
        <input
          type="email"
          placeholder="name@university.edu"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="staff">staff</option>
          <option value="student">student</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Add</button>
      </form>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name ?? '—'}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => changeRole(u, e.target.value)}>
                    <option value="student">student</option>
                    <option value="staff">staff</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'not yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
