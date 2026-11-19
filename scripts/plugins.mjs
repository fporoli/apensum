#!/usr/bin/env node
// Builds and tests the plugins under plugins/<id> (docs/PLUGINS.md). Plugins are not npm
// workspaces: they have no dependencies of their own and resolve everything (React, Nest, the
// core's contracts) from the repository's node_modules, so a private plugin cloned into the folder
// changes neither package-lock.json nor `npm ci`.
//
//   node scripts/plugins.mjs list    the installed plugins
//   node scripts/plugins.mjs build   compiles each plugin's api/ to dist/api (after the API build,
//                                    whose declarations it compiles against)
//   node scripts/plugins.mjs test    runs each plugin's test/*.test.ts (tsx, like test/api) and
//                                    test/*.test.mjs (node --test)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.env.APENSUM_PLUGINS_DIR?.trim() || join(root, 'plugins');
const command = process.argv[2] ?? 'list';

function plugins() {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => join(dir, e.name))
    .filter((p) => existsSync(join(p, 'package.json')))
    .map((p) => ({ dir: p, manifest: JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).apensum }))
    .filter((p) => p.manifest)
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, NODE_PATH: join(root, 'apps/api/node_modules') } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const list = plugins();
if (command === 'list') {
  for (const p of list) console.log(`${p.manifest.id}\t${p.dir}`);
} else if (command === 'build') {
  for (const p of list) {
    if (!p.manifest.api) continue;
    console.log(`plugin ${p.manifest.id}: building api`);
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(p.dir, 'tsconfig.api.json')], root);
  }
} else if (command === 'test') {
  for (const p of list) {
    const testDir = join(p.dir, 'test');
    if (!existsSync(testDir)) continue;
    const files = readdirSync(testDir);
    const ts = files.filter((f) => f.endsWith('.test.ts')).map((f) => join(testDir, f));
    const mjs = files.filter((f) => f.endsWith('.test.mjs')).map((f) => join(testDir, f));
    console.log(`plugin ${p.manifest.id}: ${ts.length + mjs.length} test files`);
    // tsx takes compiler options (decorators) from the tsconfig it is given, not from the file's folder.
    const tsconfig = existsSync(join(p.dir, 'tsconfig.json')) ? ['--tsconfig', join(p.dir, 'tsconfig.json')] : [];
    if (ts.length) run(join(root, 'node_modules/.bin/tsx'), [...tsconfig, '--conditions=source', '--test', ...ts], join(root, 'apps/api'));
    if (mjs.length) run(process.execPath, ['--conditions=source', '--test', ...mjs], root);
  }
} else {
  console.error(`Unknown command "${command}" (list, build or test).`);
  process.exit(2);
}
