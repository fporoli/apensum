const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { drizzle } = require('drizzle-orm/node-postgres');
const { cantonHolidays } = require('@worktime3/shared/worktime');
const { BalancesService } = require('../../apps/api/dist/balances.service');
const { WorkTimeModelService, localDate } = require('../../apps/api/dist/work-time-model.service');

const zone = 'Europe/Zurich';
const today = localDate(new Date(), zone);
const year = Number(today.slice(0, 4));
const lastMonth = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
const password = randomBytes(32).toString('base64url');
const adminPassword = 'admin';
const api = `http://127.0.0.1:${process.env.API_PORT ?? 8001}/api/v1/`;
const note = 'Dolphin/Whale test simulation';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const balance = new BalancesService(new WorkTimeModelService(), { record: async () => {} });

async function request(path, auth, body, method) {
  const t = performance.now();
  const response = await fetch(api + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return { data: JSON.parse(text), ms: Math.round(performance.now() - t), bytes: Buffer.byteLength(text) };
}

async function ok(path, auth, body, method) {
  const { data } = await request(path, auth, body, method);
  assert(data?.ok && !data.offline, `${path}: ${data?.error ?? 'invalid or offline response'}`);
  return data;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Europe/Zurich'");
    await client.query('CREATE TEMP TABLE sim_holidays(day date PRIMARY KEY) ON COMMIT DROP');
    const holidays = Array.from({ length: year - 1995 + 1 }, (_, i) => cantonHolidays(1995 + i, 'ZH').map(h => h.date)).flat();
    await client.query('INSERT INTO sim_holidays SELECT DISTINCT unnest($1::date[])', [holidays]);
    await client.query(readFileSync(`${__dirname}/history.sql`, 'utf8'));
    const hashes = await Promise.all(Array.from({ length: 8 }, () => bcrypt.hash(password, 10)));
    const adminHash = await bcrypt.hash(adminPassword, 10);
    await client.query(`INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash)
      SELECT person, 'password', email, CASE WHEN n = 1 THEN $2::text ELSE ($1::text[])[
        (CASE slug WHEN 'dolphin' THEN 0 ELSE 4 END) +
        (CASE n WHEN leaders + 3 THEN 4 ELSE n END)] END
      FROM sim_people WHERE n IN (1, 2, 3, leaders + 3)`, [hashes, adminHash]);
    const { rows } = await client.query('SELECT org, slug, person, n, hired::text, leaders, email FROM sim_people ORDER BY slug, n');
    await client.query('COMMIT');
    return rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function pending(auth, org, source) {
  const { data } = await request(`workflows/assigned-to-me?orgId=${org}`, auth);
  const row = data.find(r => r.source_table_uuid === source);
  assert(row, 'Expected approval was not assigned');
  return row.id;
}

function upcomingWorkday(offset) {
  const date = new Date(`${today}T00:00:00Z`);
  while (offset > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    if (date.getUTCDay() % 6 !== 0 && !cantonHolidays(date.getUTCFullYear(), 'ZH').some(h => h.date === day)) offset--;
  }
  return date.toISOString().slice(0, 10);
}

async function exercise(people, other) {
  const [owner, hr, manager] = people;
  const employee = people.find(p => p.n === p.leaders + 3);
  const org = employee.org;
  const base = `organizations/${org}`;
  const login = async ({ email }) => (await ok('auth/login', null, {
    email,
    password: email.startsWith('admin@') ? adminPassword : password,
  })).token;
  const workerToken = await login(employee);
  const managerToken = await login(manager);
  const hrToken = await login(hr);
  const adminToken = await login(owner);

  const absence = async (offset, halfDay) => {
    const date = upcomingWorkday(offset);
    return (await ok(`${base}/absences`, workerToken, { dateStart: date, dateEnd: date, absenceType: 'vacation', halfDay, note })).id;
  };
  const original = await absence(26, false);
  const deniedWorkflow = await pending(managerToken, org, original);
  const foreign = await request(`organizations/${other}/directory`, workerToken);
  assert.equal(foreign.data.error, 'forbidden');
  assert.deepEqual(foreign.data.people, []);
  const unassigned = await request(`workflows/${deniedWorkflow}/approve`, workerToken, {});
  assert.equal(unassigned.data.ok, false, 'Employee must not approve own request');
  await ok(`workflows/${deniedWorkflow}/reject`, managerToken, { note: 'Please choose the following day and request half a day.' });
  const revised = await absence(27, true);
  await ok(`workflows/${await pending(managerToken, org, revised)}/approve`, managerToken, { note });
  await absence(35, false);

  const submitted = await ok(`${base}/timesheet-periods/submit`, workerToken, { periodStart: lastMonth, note });
  await ok(`timesheet-periods/${submitted.id}/reject`, managerToken, { note: 'Clarify the attendance entry.' });
  const { rows: [entry] } = await pool.query(`SELECT id FROM work_times WHERE organization_id = $1 AND user_id = $2
    AND (check_in AT TIME ZONE 'Europe/Zurich')::date >= $3::date
    AND (check_in AT TIME ZONE 'Europe/Zurich')::date < $3::date + interval '1 month' ORDER BY check_in DESC LIMIT 1`, [org, employee.person, lastMonth]);
  assert(entry, 'Expected attendance in the last month');
  await ok(`work-time/${entry.id}`, workerToken, { comment: 'Corrected: includes customer handover' }, 'PATCH');
  await ok(`${base}/timesheet-periods/submit`, workerToken, { periodStart: lastMonth, note: 'Attendance entry clarified.' });
  await ok(`timesheet-periods/${submitted.id}/approve`, managerToken, { note });

  const expense = await ok(`${base}/expenses`, workerToken, { expenseDate: today, category: 'supplies', originalValue: 37.5, originalCurrency: 'CHF', currency: 'CHF', comment: note });
  const { id: report } = await ok(`${base}/expense-reports`, workerToken, {});
  await ok(`expense-reports/${report}/items`, workerToken, { expenseId: expense.id });
  await ok(`expense-reports/${report}/submit`, workerToken, { note });
  await ok(`expense-reports/${report}/reject`, managerToken, { note: 'Remove the personal item.' });
  await ok(`expenses/${expense.id}`, workerToken, { originalValue: 29.5, comment: 'Office supplies only, personal item removed' }, 'PATCH');
  await ok(`expense-reports/${report}/submit`, workerToken, { note: 'Amount corrected.' });
  await ok(`expense-reports/${report}/approve`, managerToken, { note });
  const res = await ok(`${base}/expense-processing/process`, hrToken, { reportIds: [report] });
  assert.equal(res.processed, 1);
  const draft = await ok(`${base}/expense-reports`, workerToken, {});
  console.log(`${employee.slug}: verified employee/manager reject → correct → resubmit → approve on absence, timesheet and expense; HR processed expense`);
  return { adminToken, managerToken, hrToken, workerToken, employee, draftId: draft.id };
}

async function closeYears(people, hrToken) {
  const hr = people.find(p => p.n === 2);
  const example = people.find(p => p.n === 3);
  const start = performance.now();
  let closed = 0;
  const queue = people.filter(p => p !== example);
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const person = queue.shift();
      const first = Number(person.hired.slice(0, 4));
      for (let y = Math.max(2000, first); y < year; y++) {
        if (y === 2000 && first < 2000) {
          // 1995–1999 have real month snapshots, but the year-closing table accepts 2000 onwards.
          const status = await balance.yearStatus(db, person.org, person.person, y);
          assert(status.ended && !status.notEmployed && !status.openMonths.length, '2000 requires approved months');
          await pool.query(`INSERT INTO balance_years (organization_id, user_id, year, overtime_minutes, legal_overtime_minutes, vacation_days, closed_by_user_id)
            VALUES ($1, $2, 2000, $3, $4, $5, $6)`, [person.org, person.person, Math.round(status.values.overtime), Math.round(status.values.legalOvertime), status.values.vacation, hr.person]);
        } else {
          const result = await balance.closeYear(db, person.org, person.person, y, hr.person, false);
          assert(result.ok, `${person.slug}/${person.n}/${y}: ${result.error} ${result.months ?? ''}`);
        }
        closed++;
      }
      await balance.year(db, person.org, person.person, year);
    }
  }));
  const error = workers.find(w => w.status === 'rejected');
  if (error) throw error.reason;
  const { results } = await ok(`organizations/${hr.org}/balance-years/close`, hrToken, { year: year - 1, userIds: [example.person] });
  assert(results[0]?.ok, `HR year-end close: ${results[0]?.error}`);
  closed += year - Number(example.hired.slice(0, 4));
  console.log(`${hr.slug}: ${closed} closed person-years (${Math.round(performance.now() - start)} ms); verified HR year-end close via API`);
}

async function verify(people, tokens) {
  const { org, slug } = people[0];
  const base = `organizations/${org}`;
  const { rows: [counts] } = await pool.query(`SELECT
    (SELECT count(*)::int FROM organization_memberships WHERE organization_id=$1) AS people,
    (SELECT count(*)::int FROM projects WHERE organization_id=$1) AS projects,
    (SELECT count(*)::int FROM work_times WHERE organization_id=$1) AS attendance,
    (SELECT count(*)::int FROM project_times WHERE organization_id=$1) AS project_time,
    (SELECT count(*)::int FROM absences WHERE organization_id=$1) AS absences,
    (SELECT count(*)::int FROM expenses WHERE organization_id=$1) AS expenses,
    (SELECT count(*)::int FROM expense_reports WHERE organization_id=$1) AS expense_reports,
    (SELECT count(*)::int FROM work_time_months WHERE organization_id=$1) AS closed_months,
    (SELECT count(*)::int FROM project_time_periods WHERE organization_id=$1 AND status='approved') AS closed_project_months,
    (SELECT count(*)::int FROM balance_years WHERE organization_id=$1) AS closed_years,
    (SELECT count(*)::int FROM timesheet_periods t WHERE organization_id=$1 AND status='approved'
      AND NOT EXISTS (SELECT 1 FROM work_time_months m WHERE m.timesheet_period_id=t.id)) AS unmatched_months,
    (SELECT count(*)::int FROM project_times t JOIN projects p ON p.id=t.project_id
      WHERE t.organization_id=$1 AND p.organization_id<>t.organization_id) AS foreign_project_bookings,
    (SELECT count(*)::int FROM expense_report_items i JOIN expenses e ON e.id=i.expense_id
      JOIN expense_reports r ON r.id=i.expense_report_id
      WHERE i.organization_id=$1 AND (e.organization_id<>i.organization_id OR r.organization_id<>i.organization_id OR r.user_id<>e.user_id)) AS mismatched_expense_items,
    (SELECT min(check_in AT TIME ZONE 'Europe/Zurich')::date::text FROM work_times WHERE organization_id=$1) AS history_from`, [org]);
  assert.equal(counts.people, people.length);
  assert.equal(counts.projects, people[0].leaders + 1);
  assert.equal(counts.unmatched_months, 0);
  assert.equal(counts.foreign_project_bookings, 0);
  assert.equal(counts.mismatched_expense_items, 0);
  assert(counts.closed_years > 0 && counts.expense_reports > counts.people);
  console.log(`${slug}: ${JSON.stringify(counts)}`);

  for (const path of ['expenses', 'expense-reports']) {
    const { data: legacy } = await request(`${base}/${path}`, tokens.adminToken);
    const total = (Array.isArray(legacy) ? legacy : legacy.entries).length;
    const { data: first } = await request(`${base}/${path}?page=0&pageSize=25`, tokens.adminToken);
    const { data: second } = await request(`${base}/${path}?page=1&pageSize=25`, tokens.adminToken);
    const { data: last } = await request(`${base}/${path}?page=${Math.ceil(total / 25) - 1}&pageSize=25`, tokens.adminToken);
    assert.equal(first.entries.length, 25);
    assert.equal(second.entries.length, 25);
    assert.equal(new Set([...first.entries, ...second.entries].map(r => r.id)).size, 50);
    assert.equal(first.hasMore, true);
    assert.equal(last.entries.length, total % 25 || 25);
    assert.equal(last.hasMore, false);
  }
  const personQuery = `userId=${tokens.employee.person}&pageSize=2`;
  const { data: reportFirst } = await request(`${base}/expense-reports?${personQuery}&page=0`, tokens.workerToken);
  const { data: reportSecond } = await request(`${base}/expense-reports?${personQuery}&page=1`, tokens.workerToken);
  assert.equal(reportFirst.draft?.id, tokens.draftId);
  assert.equal(reportSecond.draft?.id, reportFirst.draft.id);
  assert([...reportFirst.entries, ...reportSecond.entries].every(r => r.id !== reportFirst.draft.id));

  for (const [name, path, token, rows] of [
    ['directory', `${base}/directory`, tokens.adminToken, d => d.people.length],
    ['monthly balances', `${base}/balances/report?month=${lastMonth.slice(0, 7)}`, tokens.hrToken, d => d.rows.length],
    ['year-end overview', `${base}/balance-years?year=${year - 1}`, tokens.hrToken, d => d.rows.length],
    ['manager approvals', `workflows/assigned-to-me?orgId=${org}&status=all`, tokens.managerToken, d => d.length],
    ['timesheet list', `${base}/timesheet-periods`, tokens.adminToken, d => d.length],
    ['expense-report list (25 per page)', `${base}/expense-reports?page=0&pageSize=25`, tokens.adminToken, d => d.entries.length],
  ]) {
    const samples = [];
    let count, bytes;
    for (let i = 0; i < 3; i++) {
      const result = await request(path, token);
      count = rows(result.data);
      bytes = result.bytes;
      assert(count > 0, `${slug} ${name}: no rows`);
      samples.push(result.ms);
    }
    console.log(`${slug} ${name}: ${samples.join('/')} ms, ${count} rows, ${bytes} B uncompressed (loopback, serial)`);
  }
}

async function main() {
  assert(process.env.DATABASE_URL, 'Missing DATABASE_URL');
  assert(['vps-test', 'vps-preprod', 'local-check'].includes(process.argv[2]), 'Explicit simulation target required');
  const { data: health } = await request('health');
  assert.equal(health.status, 'ok', 'API is not healthy');
  if (process.argv[2] === 'vps-test' || process.argv[2] === 'vps-preprod') {
    const environment = process.argv[2].slice('vps-'.length);
    assert.equal(new URL(process.env.DATABASE_URL).hostname, `apensum-${environment}-pg`);
  } else {
    assert.equal(new URL(process.env.DATABASE_URL).pathname, '/apensum_simulation_check');
  }
  const people = await seed();
  const groups = ['dolphin', 'whale'].map(slug => people.filter(person => person.slug === slug));
  for (const [i, group] of groups.entries()) {
    const tokens = await exercise(group, groups[1 - i][0].org);
    await closeYears(group, tokens.hrToken);
    await verify(group, tokens);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
