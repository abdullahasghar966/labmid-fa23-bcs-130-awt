// End-to-end checks of the 7 rules against a real PostgreSQL database.
// Needs the database running (npm run db:local). WIPES the database.
//   npm test
process.env.AUTH_DEV_BYPASS = 'true';
process.env.ADMIN_EMAILS = 'admin@test.edu';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = ''; // no real Firebase during tests
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { cache } = await import('../src/cache.js');
const { recentEvents } = await import('../src/services/events.js');
const { resetDatabase } = await import('../scripts/db-reset.js');

let server;
let base;

async function call(who, method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(who && { Authorization: `Bearer dev:${who}` }),
      ...(body && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const textBody = await res.text();
  return { status: res.status, headers: res.headers, body: textBody ? JSON.parse(textBody) : null };
}

const ADMIN = 'admin@test.edu';
const STAFF = 'staff@test.edu';
const ALI = 'ali@student.edu';
const SARA = 'sara@student.edu';
let scopeId; // equipment created during the tests

before(async () => {
  await resetDatabase({ seed: true });
  cache.clear();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;

  // everyone signs in once; admin promotes the staff member
  for (const who of [ADMIN, STAFF, ALI, SARA]) await call(who, 'GET', '/api/auth/me');
  const users = await call(ADMIN, 'GET', '/api/users');
  const staffUser = users.body.find((u) => u.email === STAFF);
  const promoted = await call(ADMIN, 'PATCH', `/api/users/${staffUser.id}/role`, { role: 'staff' });
  assert.equal(promoted.body.role, 'staff');
});

after(async () => {
  server.close();
  await pool.end();
});

test('auth: no token -> 401, admin from ADMIN_EMAILS, new users are students', async () => {
  assert.equal((await call(null, 'GET', '/api/equipment')).status, 401);
  assert.equal((await call(ADMIN, 'GET', '/api/auth/me')).body.role, 'admin');
  assert.equal((await call(ALI, 'GET', '/api/auth/me')).body.role, 'student');
  assert.equal((await call(ALI, 'GET', '/api/users')).status, 403);
});

test('Rule 1: staff do full CRUD on equipment, students can only read', async () => {
  const created = await call(STAFF, 'POST', '/api/equipment', { name: 'Logic Analyzer', quantity: 3 });
  assert.equal(created.status, 201);
  assert.equal(created.body.unitsLeft, 3);
  scopeId = created.body.id;

  const updated = await call(STAFF, 'PUT', `/api/equipment/${scopeId}`, { quantity: 2, description: '8ch' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.quantity, 2);

  assert.equal((await call(ALI, 'GET', '/api/equipment')).status, 200);
  assert.equal((await call(ALI, 'GET', `/api/equipment/${scopeId}`)).status, 200);
  assert.equal((await call(ALI, 'POST', '/api/equipment', { name: 'X', quantity: 1 })).status, 403);
  assert.equal((await call(ALI, 'PUT', `/api/equipment/${scopeId}`, { quantity: 9 })).status, 403);
  assert.equal((await call(ALI, 'DELETE', `/api/equipment/${scopeId}`)).status, 403);

  const temp = await call(ADMIN, 'POST', '/api/equipment', { name: 'Temp', quantity: 1 });
  assert.equal((await call(ADMIN, 'DELETE', `/api/equipment/${temp.body.id}`)).status, 204);
});

test('Rule 6: equipment browsing is cached (HIT/MISS, ETag 304, invalidated on change)', async () => {
  cache.clear();
  const first = await call(ALI, 'GET', '/api/equipment');
  assert.equal(first.headers.get('x-cache'), 'MISS');
  const second = await call(SARA, 'GET', '/api/equipment');
  assert.equal(second.headers.get('x-cache'), 'HIT');

  const etag = second.headers.get('etag');
  const notModified = await call(ALI, 'GET', '/api/equipment', null, { 'If-None-Match': etag });
  assert.equal(notModified.status, 304);

  await call(STAFF, 'PUT', `/api/equipment/${scopeId}`, { description: 'changed' });
  const afterChange = await call(ALI, 'GET', '/api/equipment');
  assert.equal(afterChange.headers.get('x-cache'), 'MISS');
  assert.equal(afterChange.body.find((e) => e.id === scopeId).description, 'changed');
});

test('Rule 2 + 5: students book; not enough units left -> 409; then notify when available', async () => {
  const loan = await call(ALI, 'POST', '/api/loans', { equipmentId: scopeId, quantity: 2 });
  assert.equal(loan.status, 201);
  assert.equal(loan.body.status, 'pending');

  const rejected = await call(SARA, 'POST', '/api/loans', { equipmentId: scopeId, quantity: 1 });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, 'NOT_ENOUGH_UNITS');
  assert.equal(rejected.body.error.details.unitsLeft, 0);

  assert.equal((await call(STAFF, 'POST', '/api/loans', { equipmentId: scopeId })).status, 403);

  const left = await call(SARA, 'GET', `/api/equipment/${scopeId}/availability`);
  assert.deepEqual([left.body.unitsLeft, left.body.available], [0, false]);

  const notify = await call(SARA, 'POST', `/api/equipment/${scopeId}/notify`, { units: 1 });
  assert.equal(notify.status, 201);

  // staff cannot shrink below what is on loan, or delete it -> 409
  const shrink = await call(STAFF, 'PUT', `/api/equipment/${scopeId}`, { quantity: 1 });
  assert.equal(shrink.status, 409);
  assert.equal(shrink.body.error.code, 'CAPACITY_CONFLICT');
  const del = await call(STAFF, 'DELETE', `/api/equipment/${scopeId}`);
  assert.equal(del.body.error.code, 'EQUIPMENT_HAS_ACTIVE_LOANS');
});

test('Rule 2: a student reads/cancels only their own loans', async () => {
  const aliLoans = await call(ALI, 'GET', '/api/loans');
  const saraLoans = await call(SARA, 'GET', '/api/loans');
  assert.equal(aliLoans.body.length, 1);
  assert.equal(saraLoans.body.length, 0);

  const aliLoanId = aliLoans.body[0].id;
  assert.equal((await call(SARA, 'GET', `/api/loans/${aliLoanId}`)).status, 403);
  assert.equal(
    (await call(SARA, 'PATCH', `/api/loans/${aliLoanId}/status`, { status: 'cancelled' })).status,
    403,
  );
  // a student cannot confirm, even their own
  assert.equal(
    (await call(ALI, 'PATCH', `/api/loans/${aliLoanId}/status`, { status: 'confirmed' })).status,
    403,
  );
});

test('Rule 3: staff list all loans and loans of one equipment via nested URI', async () => {
  const all = await call(STAFF, 'GET', '/api/loans');
  assert.ok(all.body.length >= 1);
  const nested = await call(STAFF, 'GET', `/api/equipment/${scopeId}/loans`);
  assert.equal(nested.status, 200);
  assert.ok(nested.body.every((l) => l.equipmentId === scopeId));
  assert.equal((await call(ALI, 'GET', `/api/equipment/${scopeId}/loans`)).status, 403);
});

test('Rule 4: loans move forward only; Rule 7: live events reach the right people', async () => {
  const aliLoan = (await call(ALI, 'GET', '/api/loans')).body[0];
  const start = recentEvents.length;

  const confirmed = await call(STAFF, 'PATCH', `/api/loans/${aliLoan.id}/status`, { status: 'confirmed' });
  assert.equal(confirmed.body.status, 'confirmed');
  const back = await call(STAFF, 'PATCH', `/api/loans/${aliLoan.id}/status`, { status: 'pending' });
  assert.equal(back.status, 409);
  assert.equal(back.body.error.code, 'INVALID_STATUS_TRANSITION');

  const cancelled = await call(ALI, 'PATCH', `/api/loans/${aliLoan.id}/status`, { status: 'cancelled' });
  assert.equal(cancelled.body.status, 'cancelled');
  const revive = await call(STAFF, 'PATCH', `/api/loans/${aliLoan.id}/status`, { status: 'confirmed' });
  assert.equal(revive.status, 409);

  const events = recentEvents.slice(start);
  const aliUid = 'dev-ali_student_edu';
  const saraUid = 'dev-sara_student_edu';
  // Ali (owner) got his loan updates, Sara did not
  assert.ok(events.some((e) => e.channel === `users/${aliUid}` && e.type === 'loan:updated'));
  assert.ok(!events.some((e) => e.channel === `users/${saraUid}` && e.type === 'loan:updated'));
  // staff see every loan change
  assert.ok(events.some((e) => e.channel === 'staff' && e.type === 'loan:updated'));
  // everyone sees the availability change
  const avail = events.find((e) => e.channel === 'public' && e.type === 'availability:changed');
  assert.equal(avail.equipment.unitsLeft, 2);
  // Sara asked to be notified -> she gets equipment:available
  assert.ok(events.some((e) => e.channel === `users/${saraUid}` && e.type === 'equipment:available'));
});

test('Rule 5 under load: parallel bookings never overbook', async () => {
  const eq = await call(STAFF, 'POST', '/api/equipment', { name: 'Race Test', quantity: 3 });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      call(`racer${i}@student.edu`, 'POST', '/api/loans', { equipmentId: eq.body.id, quantity: 1 }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
});

test('Loan set by staff + how much loan paid', async () => {
  const loan = await call(SARA, 'POST', '/api/loans', { equipmentId: scopeId, quantity: 1 });
  const id = loan.body.id;

  assert.equal((await call(SARA, 'PATCH', `/api/loans/${id}/amount`, { amount: 500 })).status, 403);
  assert.equal((await call(STAFF, 'PATCH', `/api/loans/${id}/amount`, { amount: 500 })).body.loanAmount, 500);

  assert.equal((await call(STAFF, 'POST', `/api/loans/${id}/payments`, { amount: 200 })).status, 201);
  const over = await call(STAFF, 'POST', `/api/loans/${id}/payments`, { amount: 400 });
  assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_BALANCE');
  const below = await call(STAFF, 'PATCH', `/api/loans/${id}/amount`, { amount: 100 });
  assert.equal(below.body.error.code, 'AMOUNT_BELOW_PAID');

  const paid = await call(SARA, 'GET', `/api/loans/${id}/payments`);
  assert.deepEqual(
    [paid.body.loanAmount, paid.body.amountPaid, paid.body.remaining, paid.body.payments.length],
    [500, 200, 300, 1],
  );
  assert.equal((await call(ALI, 'GET', `/api/loans/${id}/payments`)).status, 403);
});

test('availability changed or not, overview, error + event catalogues', async () => {
  const first = await call(ALI, 'GET', '/api/availability/changes');
  assert.equal(first.body.changed, true);
  const again = await call(ALI, 'GET', `/api/availability/changes?since=${encodeURIComponent(first.body.checkedAt)}`);
  assert.equal(again.body.changed, false);
  await call(ALI, 'POST', '/api/loans', { equipmentId: scopeId, quantity: 1 });
  const later = await call(ALI, 'GET', `/api/availability/changes?since=${encodeURIComponent(first.body.checkedAt)}`);
  assert.equal(later.body.changed, true);
  assert.equal(later.body.equipment[0].id, scopeId);

  const mine = await call(ALI, 'GET', '/api/overview');
  assert.equal(mine.body.scope, 'my loans');
  const all = await call(STAFF, 'GET', '/api/overview');
  assert.ok(all.body.loans.total > mine.body.loans.total);

  const errors = await call(null, 'GET', '/api/meta/errors');
  assert.ok(errors.body.some((e) => e.code === 'NOT_ENOUGH_UNITS' && e.status === 409));
  const eventsCat = await call(null, 'GET', '/api/meta/events');
  assert.ok(eventsCat.body.some((e) => e.name === 'availability:changed'));
});
