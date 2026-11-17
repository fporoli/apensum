// Exports Apensum's Superset dashboards from the dev Superset into infra/superset/assets/ (YAML,
// committed): dashboard, charts, datasets and the database connection, with Superset's uuids so an
// import in another environment updates the same objects. superset-setup.mjs imports them.
//
//   npm run dev:superset:export      after changing a dashboard in http://localhost:8088
//
// The files are normalized for readable diffs: no export timestamp, no environment ids in file
// names. The database password is masked by Superset (XXXXXXXXXX) and never written.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSuperset } from './lib/superset.mjs';
import { readZip } from './lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'infra/superset/assets');
/** The dashboards that belong to Apensum, by slug. */
const SLUGS = (process.env.SUPERSET_DASHBOARD_SLUGS || process.env.SUPERSET_DASHBOARD_SLUG || 'apensum-overview').split(',');

const superset = await connectSuperset({
  url: process.env.SUPERSET_URL || 'http://localhost:8088',
  password: process.env.SUPERSET_ADMIN_PASSWORD || 'admin_dev_only',
});

const ids = [];
for (const slug of SLUGS) {
  const dash = await superset.call('GET', `/api/v1/dashboard/${slug}`);
  if (dash.status !== 200) throw new Error(`dashboard "${slug}" not found`);
  ids.push(dash.json.result.id);
}
const files = readZip(await superset.download(`/api/v1/dashboard/export/?q=!(${ids.join(',')})`));

rmSync(ASSETS, { recursive: true, force: true });
const written = new Set();
for (const { name, data } of files) {
  // dashboard_export_<timestamp>/charts/Name_12.yaml -> charts/Name.yaml (the number stays when two share a name)
  const full = name.split('/').slice(1).join('/');
  const short = full.replace(/_\d+\.yaml$/, '.yaml');
  const rel = written.has(short) ? full : short;
  written.add(rel);
  let text = data.toString('utf8');
  if (rel === 'metadata.yaml') text = text.replace(/^timestamp: .*$/m, "timestamp: '2000-01-01T00:00:00+00:00'");
  mkdirSync(dirname(join(ASSETS, rel)), { recursive: true });
  writeFileSync(join(ASSETS, rel), text);
}
console.log(`superset: ${files.length} files exported to infra/superset/assets (${SLUGS.join(', ')}); review and commit them`);
