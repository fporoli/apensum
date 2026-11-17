// Brings a Superset up to date with Apensum's dashboards (trial; dev: compose profile `bi`):
//   1. the reporting views and the read-only user superset_reader (infra/superset/reporting.sql),
//   2. imports infra/superset/assets (dashboards, charts, datasets, database connection; exported
//      from dev by superset-export.mjs) with overwrite: same uuids, so objects are updated in place,
//   3. makes sure every chart has its saved query (embedded viewers may run nothing else) and every
//      dashboard is embeddable (the API finds it by slug).
//
//   npm run dev:superset               # start the dev Superset and run this
//   npm run dev:superset -- --reset    # delete the Apensum dashboards and their charts first
//
// Per environment: SUPERSET_URL, SUPERSET_ADMIN_PASSWORD, SUPERSET_READER_PASSWORD and
// SUPERSET_READER_HOST (the Postgres host as Superset sees it; dev: `pg`, the compose service).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSuperset } from './lib/superset.mjs';
import { writeZip } from './lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'infra/superset/assets');
const SUPERSET = process.env.SUPERSET_URL || 'http://localhost:8088';
const ADMIN_PASSWORD = process.env.SUPERSET_ADMIN_PASSWORD || 'admin_dev_only';
const READER_PASSWORD = process.env.SUPERSET_READER_PASSWORD || 'superset_reader_dev_only';
const READER_HOST = process.env.SUPERSET_READER_HOST || 'pg:5432';
const RESET = process.argv.includes('--reset');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. the reporting layer (dev: through the compose stack's Postgres) ------------------------
const psql = spawnSync(
  'docker',
  ['compose', '-f', join(ROOT, 'compose/docker-compose.dev.yml'), 'exec', '-T', 'pg',
    'psql', '-U', 'worktime', 'worktime', '-v', 'ON_ERROR_STOP=1', '-v', `reader_password=${READER_PASSWORD}`, '-q', '-f', '-'],
  { input: readFileSync(join(ROOT, 'infra/superset/reporting.sql')), encoding: 'utf8' },
);
if (psql.status !== 0) throw new Error(`reporting.sql failed:\n${psql.stderr || psql.stdout}`);
console.log('superset: reporting views and superset_reader ready');

// --- 2. import the assets --------------------------------------------------------------------------
const superset = await connectSuperset({ url: SUPERSET, password: ADMIN_PASSWORD });

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.yaml')) files.push(relative(ASSETS, path).split('\\').join('/'));
  }
})(ASSETS);
if (!files.includes('metadata.yaml')) throw new Error('infra/superset/assets is empty: export a dashboard first (npm run dev:superset:export)');

const slugs = files
  .filter((f) => f.startsWith('dashboards/'))
  .map((f) => readFileSync(join(ASSETS, f), 'utf8').match(/^slug: (.+)$/m)?.[1]?.trim())
  .filter(Boolean);

if (RESET) {
  for (const slug of slugs) {
    const dash = await superset.call('GET', `/api/v1/dashboard/${slug}`);
    if (dash.status !== 200) continue;
    const charts = (await superset.call('GET', `/api/v1/dashboard/${slug}/charts`)).json.result ?? [];
    for (const c of charts) await superset.call('DELETE', `/api/v1/chart/${c.id}`);
    await superset.call('DELETE', `/api/v1/dashboard/${dash.json.result.id}`);
    console.log(`superset: ${slug} and its ${charts.length} charts deleted`);
  }
}

// The database connection is this environment's: host from SUPERSET_READER_HOST, password passed
// separately (the committed YAML only has Superset's mask).
const passwords = {};
const bundle = writeZip(files.map((f) => {
  let text = readFileSync(join(ASSETS, f), 'utf8');
  if (f.startsWith('databases/')) {
    text = text.replace(/^sqlalchemy_uri: .*$/m, `sqlalchemy_uri: postgresql+psycopg2://superset_reader:XXXXXXXXXX@${READER_HOST}/worktime`);
    passwords[f] = READER_PASSWORD;
  }
  return { name: `apensum_assets/${f}`, data: Buffer.from(text) };
}));
const form = new FormData();
form.append('formData', new Blob([bundle], { type: 'application/zip' }), 'apensum_assets.zip');
form.append('overwrite', 'true');
form.append('passwords', JSON.stringify(passwords));
await superset.upload('/api/v1/dashboard/import/', form);
console.log(`superset: imported ${files.length - 1} objects (${slugs.join(', ')})`);

// --- 3. saved queries and embedding ----------------------------------------------------------------
// The export carries each chart's query_context. A chart without one (made in Superset but never
// saved from its editor) gets it the way the editor does: from the request Superset's own frontend
// sends, recorded while an admin opens the dashboard once.
for (const slug of slugs) {
  const charts = (await superset.call('GET', `/api/v1/dashboard/${slug}/charts`)).json.result ?? [];
  const missing = [];
  for (const c of charts) {
    if (!(await superset.call('GET', `/api/v1/chart/${c.id}`)).json.result.query_context) missing.push(c.id);
  }
  if (missing.length) {
    // Playwright is installed for the site's videos (apps/site/videos).
    const { chromium } = createRequire(join(ROOT, 'apps/site/videos/record.mjs'))('playwright');
    const browser = await chromium.launch();
    const recorded = new Map();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
      page.on('request', (r) => {
        if (r.method() !== 'POST' || !r.url().includes('/api/v1/chart/data')) return;
        const body = r.postDataJSON?.();
        const id = body?.form_data?.slice_id;
        if (id && missing.includes(id)) recorded.set(id, body);
      });
      await page.goto(`${SUPERSET}/login/`);
      await page.fill('#username, input[name=username]', 'admin');
      await page.fill('#password, input[name=password]', ADMIN_PASSWORD);
      await page.keyboard.press('Enter');
      await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
      await page.goto(`${SUPERSET}/superset/dashboard/${slug}/`);
      for (let i = 0; i < 60 && recorded.size < missing.length; i++) await sleep(500);
    } finally {
      await browser.close();
    }
    for (const [id, body] of recorded) {
      await superset.call('PUT', `/api/v1/chart/${id}`, { query_context: JSON.stringify(body), query_context_generation: true });
    }
    console.log(`superset: ${slug}: saved the queries of ${recorded.size} of ${missing.length} charts (export again to keep them)`);
  }

  const dashboardId = (await superset.call('GET', `/api/v1/dashboard/${slug}`)).json.result.id;
  let embedded = await superset.call('GET', `/api/v1/dashboard/${dashboardId}/embedded`);
  if (embedded.status !== 200) embedded = await superset.call('POST', `/api/v1/dashboard/${dashboardId}/embedded`, { allowed_domains: [] });
  console.log(`superset: ${slug} ready: ${SUPERSET}/superset/dashboard/${slug}/ (embedded as ${embedded.json.result.uuid})`);
}
