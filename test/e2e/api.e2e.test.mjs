// End to end against a running API on a migrated and seeded database (CI: job `build`, after db:seed; locally:
// `npm run dev:resetdb`, `npm run dev:api`, then `npm run test:e2e`). Real HTTP, real SQL, the seed's people:
// what the unit tests with mocks cannot show. Each run uses fresh dates and texts, so it can run again on the same
// database. API_URL (default http://localhost:8001/api/v1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL ?? 'http://localhost:8001/api/v1';
const ACME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GLOBX = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const run = Date.now().toString(36);

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

const tokens = new Map();
async function login(name) {
  if (!tokens.has(name)) {
    const r = await call(null, 'POST', '/auth/login', { email: `${name}@acme.com`, password: name });
    assert.equal(typeof r.body?.token, 'string', `${name} signs in: ${JSON.stringify(r.body)}`);
    tokens.set(name, r.body.token);
  }
  return tokens.get(name);
}

/** A weekday some months ahead, different per run (an absence must not overlap an earlier run's). */
function futureWeekday(offsetDays) {
  const d = new Date(Date.now() + (120 + (parseInt(run.slice(-3), 36) % 200) + offsetDays) * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.before(async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no API at ${API}`);
});

test('signing in: a session works, another organization stays closed, a wrong token is refused', async () => {
  const ueli = await login('ueli');
  const perms = await call(ueli, 'GET', `/organizations/${ACME}/me/permissions`);
  assert.equal(perms.status, 200);
  assert.ok(perms.body.permissions.includes('nav.absences:edit:own'));
  // Ueli is not a member of Globx: nothing of it.
  const other = await call(ueli, 'GET', `/organizations/${GLOBX}/me/permissions`);
  assert.ok(!other.body?.permissions?.length, `no rights in another organization: ${JSON.stringify(other.body)}`);
  const bad = await call('not-a-token', 'GET', `/organizations/${ACME}/me/permissions`);
  assert.equal(bad.status, 401);
});

test('failed logins are limited per account and address', async () => {
  const email = `nobody-${run}@acme.com`;
  const errors = [];
  for (let i = 0; i < 11; i++) errors.push((await call(null, 'POST', '/auth/login', { email, password: 'wrong' })).body?.error);
  assert.deepEqual(errors.slice(0, 10), Array(10).fill('invalid-credentials'));
  assert.equal(errors[10], 'too-many-attempts');
});

test('an absence goes to the manager, who approves it; the person sees it approved', async () => {
  const ueli = await login('ueli');
  const marco = await login('marco');
  const day = futureWeekday(0);
  const created = await call(ueli, 'POST', `/organizations/${ACME}/absences`, { absenceType: 'vacation', dateStart: day, dateEnd: day, note: `e2e ${run}` });
  assert.equal(created.body?.ok, true, JSON.stringify(created.body));
  const inbox = await call(marco, 'GET', `/workflows/assigned-to-me?scope=assigned&status=pending&orgId=${ACME}`);
  const item = (inbox.body ?? []).find((w) => w.source_table === 'absences' && w.source_table_uuid === created.body.id);
  assert.ok(item, 'Marco (Ueli\'s manager) has it to decide');
  // Someone else's manager does not.
  const marta = await login('marta');
  const other = await call(marta, 'GET', `/workflows/assigned-to-me?scope=assigned&status=pending&orgId=${ACME}`);
  assert.ok(!(other.body ?? []).some((w) => w.source_table_uuid === created.body.id), 'not in Marta\'s inbox');
  const approved = await call(marco, 'POST', `/workflows/${item.id}/approve`, {});
  assert.equal(approved.body?.ok, true, JSON.stringify(approved.body));
  const mine = await call(ueli, 'GET', `/organizations/${ACME}/absences`);
  assert.equal((mine.body ?? []).find((a) => a.id === created.body.id)?.status, 'approved');
});

test('a note: shared with a colleague, changed by its author only, hidden by the colleague', async () => {
  const ueli = await login('ueli');
  const marta = await login('marta');
  const dir = await call(ueli, 'GET', `/organizations/${ACME}/directory`);
  const martaId = dir.body.people.find((p) => p.email === 'marta@acme.com').userId;
  const note = await call(ueli, 'POST', `/organizations/${ACME}/notes`, { text: `## e2e ${run}\n- eins` });
  assert.equal(note.body?.ok, true, JSON.stringify(note.body));
  const id = note.body.note.id;
  assert.equal((await call(ueli, 'POST', `/organizations/${ACME}/notes/${id}/share`, { userIds: [martaId] })).body?.added, 1);
  const seen = await call(marta, 'GET', `/organizations/${ACME}/notes`);
  assert.ok(seen.body.shared.some((n) => n.id === id), 'Marta sees it shared');
  assert.equal((await call(marta, 'PUT', `/organizations/${ACME}/notes/${id}`, { text: 'fremd' })).body?.error, 'not-found', 'not hers to change');
  assert.equal((await call(ueli, 'PUT', `/organizations/${ACME}/notes/${id}`, { text: `## e2e ${run}\n- zwei` })).body?.ok, true);
  const again = await call(marta, 'GET', `/organizations/${ACME}/notes`);
  assert.match(again.body.shared.find((n) => n.id === id).text, /zwei/);
  assert.equal((await call(marta, 'DELETE', `/organizations/${ACME}/notes/${id}/share/me`)).body?.ok, true);
  assert.ok(!(await call(marta, 'GET', `/organizations/${ACME}/notes`)).body.shared.some((n) => n.id === id), 'hidden');
  assert.equal((await call(ueli, 'DELETE', `/organizations/${ACME}/notes/${id}`)).body?.ok, true);
});

test('raw SQL paths answer: balances, the team overviews, the directory, the flows', async () => {
  const ulla = await login('ulla');
  const month = new Date().toISOString().slice(0, 7);
  const year = new Date().getUTCFullYear();
  const checks = [
    ['GET', `/organizations/${ACME}/directory`],
    ['GET', `/organizations/${ACME}/team-overview?kind=absences&month=${month}`],
    ['GET', `/organizations/${ACME}/team-overview?kind=workTime&month=${month}`],
    ['GET', `/organizations/${ACME}/balances?year=${year}`],
    ['GET', `/workflows/assigned-to-me?scope=mine&status=all&orgId=${ACME}`],
  ];
  for (const [method, path] of checks) {
    const r = await call(ulla, method, path);
    assert.equal(r.status < 500, true, `${path}: ${r.status}`);
    assert.notEqual(r.body?.ok, false, `${path}: ${JSON.stringify(r.body).slice(0, 160)}`);
  }
});
