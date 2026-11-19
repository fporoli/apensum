#!/usr/bin/env node
// CI (job core-only): the core must work without any plugin. Run against an API started with an
// empty APENSUM_PLUGINS_DIR on a migrated and seeded database. Checks that the core's endpoints
// answer and that nothing of the bundled plugins (expenses, cases) is left: no routes, no permissions,
// no modules, no report, no team view, no payroll column.
//
//   API_URL (default http://localhost:8001/api/v1), ORG_ID (default the seed's Acme)
const API = process.env.API_URL ?? 'http://localhost:8001/api/v1';
const ORG = process.env.ORG_ID ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${API}/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const login = await (await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@acme.com', password: 'admin' }),
})).json();
check(typeof login.token === 'string', 'admin signs in');
const headers = { Authorization: `Bearer ${login.token}` };
const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};

const perms = await get(`/organizations/${ORG}/me/permissions`);
check(perms.body?.ok && perms.body.permissions.length > 0, 'permissions load');
check(!perms.body?.permissions?.some((p) => p.startsWith('nav.expense')), 'no permissions of the missing expenses plugin');
check(!perms.body?.permissions?.some((p) => p.startsWith('nav.cases')), 'no permissions of the missing cases plugin');

const modules = await get(`/organizations/${ORG}/modules`);
check(modules.body?.ok && !modules.body.catalogue.some((m) => m.id === 'expenses'), 'no expenses module');
check(modules.body?.ok && !modules.body.catalogue.some((m) => m.id === 'cases'), 'no cases module');
check((await get(`/organizations/${ORG}/cases`)).status === 404, 'no cases routes');
check((await get(`/organizations/${ORG}/ai-settings`)).body?.ok === true, 'AI limit and spend (core)');

check((await get(`/organizations/${ORG}/expenses`)).status === 404, 'no expense routes');
check((await get(`/organizations/${ORG}/reports/expenses?from=2026-01&to=2026-02`)).body?.error === 'unknown-report', 'no expenses report');
check((await get(`/organizations/${ORG}/reports/projectHours?from=2026-01&to=2026-02`)).body?.ok === true, 'core reports run');
check((await get(`/organizations/${ORG}/team-overview?kind=expenses&month=2026-01`)).body?.error === 'invalid-kind', 'no expenses team view');
check((await get(`/organizations/${ORG}/documents`)).body?.ok === true, 'documents list');
check(Array.isArray((await get('/workflows/assigned-to-me')).body), 'workflow inbox');
const payroll = await get(`/organizations/${ORG}/export/payroll?month=2026-01`);
check(payroll.body?.ok && Array.isArray(payroll.body.items) && payroll.body.items.length === 0, 'payroll without plugin columns');

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe core works without plugins.');
