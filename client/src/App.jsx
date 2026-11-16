import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase.js';
import { api, devSession } from './api.js';
import { subscribeLive, subscribeRole, isLiveEnabled } from './live.js';
import Login from './components/Login.jsx';
import EquipmentPage from './components/EquipmentPage.jsx';
import LoansPage from './components/LoansPage.jsx';
import OverviewPage from './components/OverviewPage.jsx';
import UsersPage from './components/UsersPage.jsx';

export default function App() {
  const [signedIn, setSignedIn] = useState(undefined); // undefined = still checking
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (devSession.get()) {
      setSignedIn(true);
      return undefined;
    }
    if (!auth) {
      setSignedIn(false);
      return undefined;
    }
    return onAuthStateChanged(auth, (user) => setSignedIn(Boolean(user)));
  }, []);

  const loadMe = useCallback(() => {
    setError('');
    return api('/auth/me')
      .then(setMe)
      .catch((err) => {
        setMe(null);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (signedIn) loadMe();
    else setMe(null);
  }, [signedIn, loadMe]);

  const logOut = async () => {
    devSession.clear();
    if (auth?.currentUser) await signOut(auth);
    setSignedIn(false);
  };

  if (signedIn === undefined) return <div className="splash">Loading…</div>;
  if (!signedIn || !me) {
    return (
      <Login
        error={error}
        busy={signedIn && !me && !error}
        onDevLogin={(email) => {
          devSession.set(email);
          setSignedIn(true);
          loadMe();
        }}
        onSignOut={logOut}
      />
    );
  }
  return <Dashboard key={`${me.id}-${me.role}`} me={me} reloadMe={loadMe} onSignOut={logOut} />;
}

const byName = (a, b) => a.name.localeCompare(b.name);
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

function Dashboard({ me, reloadMe, onSignOut }) {
  const liveEnabled = isLiveEnabled();
  const isStaff = me.role === 'staff' || me.role === 'admin';
  const [tab, setTab] = useState('equipment');
  const [equipment, setEquipment] = useState([]);
  const [loans, setLoans] = useState([]);
  const [flash, setFlash] = useState({}); // equipmentId -> time it changed live
  const [toasts, setToasts] = useState([]);
  const [liveTick, setLiveTick] = useState(0);
  const toastId = useRef(0);

  const toast = useCallback((message, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const reloadEquipment = useCallback(
    () => api('/equipment').then((list) => setEquipment([...list].sort(byName))).catch((e) => toast(e.message, 'error')),
    [toast],
  );
  const reloadLoans = useCallback(
    () => api('/loans').then(setLoans).catch((e) => toast(e.message, 'error')),
    [toast],
  );
  const upsertLoan = useCallback((loan) => {
    setLoans((list) => [loan, ...list.filter((l) => l.id !== loan.id)].sort(byNewest));
  }, []);

  useEffect(() => {
    reloadEquipment();
    reloadLoans();
  }, [reloadEquipment, reloadLoans]);

  // Live events (Rule 7)
  useEffect(
    () =>
      subscribeLive(me, (event) => {
        setLiveTick((n) => n + 1);

        if (event.type === 'availability:changed') {
          const eq = event.equipment;
          setEquipment((list) => {
            const rest = list.filter((e) => e.id !== eq.id);
            return event.action === 'deleted' ? rest : [...rest, eq].sort(byName);
          });
          setFlash((f) => ({ ...f, [eq.id]: Date.now() }));
        }

        if (event.type === 'loan:created' || event.type === 'loan:updated') {
          upsertLoan(event.loan);
          const l = event.loan;
          if (!isStaff && event.change === 'status') {
            toast(`Your loan #${l.id} (${l.equipmentName}) is now ${l.status}`, l.status === 'cancelled' ? 'warn' : 'success');
          } else if (!isStaff && event.change === 'amount') {
            toast(`Staff set the loan amount for #${l.id} to ${l.loanAmount}`);
          } else if (!isStaff && event.change === 'payment') {
            toast(`Payment recorded on loan #${l.id}: ${l.amountPaid} paid, ${l.remaining} remaining`);
          } else if (isStaff && event.type === 'loan:created') {
            toast(`New loan request #${l.id}: ${l.quantity} × ${l.equipmentName} by ${l.studentEmail}`);
          }
        }

        if (event.type === 'equipment:available') {
          toast(
            `Good news! ${event.equipment.name} is available again (${event.equipment.unitsLeft} left). Book it now.`,
            'success',
          );
        }
      }),
    [me, isStaff, toast, upsertLoan],
  );

  // If an admin changes my role, switch views live.
  useEffect(
    () =>
      subscribeRole(me.uid, (role) => {
        if (role && role !== me.role) reloadMe();
      }),
    [me.uid, me.role, reloadMe],
  );

  const tabs = [
    ['equipment', 'Lab Equipment'],
    ['loans', isStaff ? 'All Loans' : 'My Loans'],
    ['overview', 'Overview'],
    ...(me.role === 'admin' ? [['users', 'Users & Roles']] : []),
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚗</span>
          <div>
            <strong>Lab Equipment Loans</strong>
            <small>Advanced Web Technologies · Variant 0</small>
          </div>
        </div>
        <div className="who">
          <span className={`live-dot ${liveEnabled ? 'on' : ''}`} title={liveEnabled ? 'Live updates on' : 'Live updates off'} />
          <span className="email">{me.email}</span>
          <span className={`role role-${me.role}`}>{me.role}</span>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {!liveEnabled && (
        <p className="banner">Live updates are off (Firebase Realtime Database not configured). Data still loads; refresh to see others' changes.</p>
      )}

      <main>
        {tab === 'equipment' && (
          <EquipmentPage
            me={me}
            equipment={equipment}
            flash={flash}
            reloadEquipment={reloadEquipment}
            upsertLoan={upsertLoan}
            toast={toast}
          />
        )}
        {tab === 'loans' && (
          <LoansPage
            me={me}
            loans={loans}
            upsertLoan={upsertLoan}
            reloadLoans={reloadLoans}
            reloadEquipment={reloadEquipment}
            toast={toast}
          />
        )}
        {tab === 'overview' && <OverviewPage me={me} liveTick={liveTick} loansCount={loans.length} />}
        {tab === 'users' && <UsersPage me={me} toast={toast} />}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}
