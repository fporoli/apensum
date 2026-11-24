#!/usr/bin/env node
// One command line for every environment:
//
//   npm run stack -- <env> <steps...> [--reset] [--yes]
//
//   env    dev | local            this machine (.env.dev / .env.local, scripts/with-env.mjs)
//          prod | preprod | test  a VPS instance (any GitHub Environment except azure)
//          azure                  Azure Container Apps
//   steps  push   git push the current branch, then the plugin repositories cloned into plugins/ (commit
//                 first; uncommitted changes are not pushed)
//          build  dev: npm run build. local: build the Docker images.
//                 remote: wait for the GHCR images of HEAD (build-push), dispatching it off main; on main
//                 the push's own build, built again only if it missed a plugin commit pushed after it
//          reset  DESTRUCTIVE: drop the public schema, migrate, load the demo seed
//                 (VPS: `reset-seed`, backed up first; Azure: drop and re-create the Postgres
//                 server, which also resets Keycloak)
//          start  dev: services in Docker + API and web on the host (Ctrl-C stops them).
//                 local: the whole Docker stack. remote: deploy HEAD's images (migrations run first).
//          stop   dev / local only: docker compose down
//          all    push build start (add --reset to also reset and seed)
//   --reset  include the destructive reset when using "all"
//   --yes  skip the typed confirmation of a remote reset (for scripts; dev/local never ask)
//
// Steps always run in the order push, build, reset, start (stop alone), whatever order they are
// given in. On remote environments start comes before reset, so the reset runs the new
// migrations and seed; on a VPS instance start and reset are one run (vps.yml deploy-reset). Examples:
//
//   npm run stack -- dev reset start       fresh demo database, then API + web
//   npm run stack -- local all             push, rebuild images, bring the stack up
//   npm run stack -- local all --reset     also reset and seed the local database
//   npm run stack -- test push build start deploy HEAD to the `test` VPS instance
//   npm run stack -- prod start            deploy HEAD's images (already built) to prod
//
// Remote steps only trigger the GitHub workflows (vps.yml, azure.yml, azure-deploy.yml,
// build-push.yml) with the gh CLI and wait for them; config stays in GitHub Environments.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const shell = process.platform === 'win32';
const ORDER = ['push', 'build', 'reset', 'start', 'stop'];
const LOCAL = new Set(['dev', 'local']);

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error('Usage: npm run stack -- <dev|local|prod|preprod|test|azure|...> <push|build|reset|start|stop|all>... [--reset] [--yes]');
  process.exit(1);
}

function run(command, args, { capture = false, allowFail = false } = {}) {
  if (!capture) console.log(`\n$ ${[command, ...args].join(' ')}`);
  // Captured output may be a whole run log (missedPlugins): far above Node's default 1 MB.
  const result = spawnSync(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', shell, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0 && !allowFail) {
    console.error(`\n${command} ${args[0] ?? ''} failed (exit ${result.status}).`);
    process.exit(result.status || 1);
  }
  return capture ? (result.stdout ?? '').trim() : result.status;
}

const git = (...args) => run('git', args, { capture: true });
const gh = (...args) => run('gh', args, { capture: true });
const npm = (...args) => run('npm', args);
const withEnv = (env, ...args) => run('node', ['scripts/with-env.mjs', env, ...args]);
const compose = (env, ...args) => withEnv(env, 'docker', 'compose', '-f', `compose/docker-compose.${env}.yml`, ...args);

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Arguments

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const includeReset = args.includes('--reset');
const [env, ...rest] = args.filter((a) => a !== '--yes' && a !== '--reset');
if (!env) usage();
if (includeReset && !rest.includes('all')) usage('"--reset" requires "all"; use "reset" as a step directly.');
const requested = new Set(rest.flatMap((s) => (
  s === 'all' ? ['push', 'build', ...(includeReset ? ['reset'] : []), 'start'] : [s]
)));
if (requested.size === 0) usage('Name at least one step.');
for (const s of requested) if (!ORDER.includes(s)) usage(`Unknown step "${s}".`);
if (requested.has('stop') && requested.size > 1) usage('"stop" runs on its own.');
// Production holds real customers: the demo seed (Acme users with known passwords) never goes there.
if (env === 'prod' && requested.has('reset')) usage('prod is never reset or seeded: use "npm run stack -- prod push build start".');

const remote = !LOCAL.has(env);
if (remote) {
  if (requested.has('stop')) usage('"stop" is for dev and local only (to pause Azure, run the azure workflow\'s freeze).');
  const environments = gh('api', 'repos/{owner}/{repo}/environments', '--jq', '.environments[].name').split('\n').filter(Boolean);
  if (!environments.includes(env)) usage(`"${env}" is neither dev/local nor a GitHub Environment (${environments.join(', ')}).`);
}

// ---------------------------------------------------------------------------------------------
// Steps shared by every environment

/** The plugin repositories cloned into plugins/ (the private ones; the bundled example is part of this one). */
function pluginRepos() {
  const dir = 'plugins';
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, '.git'))).map((id) => ({ id, path: join(dir, id) }));
}

function push() {
  if (git('status', '--porcelain')) console.warn('\nNote: there are uncommitted changes; they are not pushed (or deployed).');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  run('git', ['push', 'origin', branch]);
  // The core first, then the plugins right after it, so the build the push starts already finds them.
  for (const { id, path } of pluginRepos()) {
    if (git('-C', path, 'status', '--porcelain')) console.warn(`\nNote: plugin ${id} has uncommitted changes; they are not pushed.`);
    const ahead = run('git', ['-C', path, 'rev-list', '--count', '@{u}..HEAD'], { capture: true, allowFail: true });
    if (ahead && ahead !== '0') run('git', ['-C', path, 'push']);
  }
}

function headInfo() {
  const sha = git('rev-parse', 'HEAD');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('fetch', '--quiet', 'origin');
  const onRemote = run('git', ['branch', '-r', '--contains', sha], { capture: true, allowFail: true });
  if (!onRemote) {
    console.error(`\nHEAD ${sha.slice(0, 7)} is not on GitHub yet: add the "push" step (or git push first).`);
    process.exit(1);
  }
  return { sha, branch, tag: `sha-${sha.slice(0, 7)}` };
}

// ---------------------------------------------------------------------------------------------
// GitHub Actions helpers

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Waits for a run to appear (newest first), then follows it until it ends; fails the script if it fails. Returns its id. */
async function watch(listArgs, label) {
  let id = '';
  for (let i = 0; i < 60 && !id; i++) {
    id = gh('run', 'list', ...listArgs, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // empty');
    if (!id) await sleep(5000);
  }
  if (!id) {
    console.error(`\nNo ${label} run showed up on GitHub.`);
    process.exit(1);
  }
  console.log(`\n${label}: following run ${id}`);
  run('gh', ['run', 'watch', id, '--exit-status', '--interval', '5']);
  return id;
}

/** Dispatches a workflow and follows the run it created. */
async function dispatch(workflow, fields, label, ref) {
  const since = new Date(Date.now() - 5000).toISOString();
  const flags = Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
  run('gh', ['workflow', 'run', workflow, ...(ref ? ['--ref', ref] : []), ...flags]);
  return watch(['--workflow', workflow, '--event', 'workflow_dispatch', '--created', `>=${since}`], label);
}

async function confirmReset(what) {
  if (yes) return;
  console.log(`\n${what}`);
  const answer = await ask(`Type the environment name (${env}) to continue: `);
  if (answer !== env) {
    console.error('Not confirmed; nothing was reset.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
// dev / local

function localBuild() {
  if (env === 'dev') npm('run', 'build');
  else compose('local', 'build');
}

function localReset() {
  // The database container must run.
  if (env === 'dev') npm('run', 'dev:up');
  else compose('local', 'up', '-d', 'pg');
  npm('run', `${env}:resetdb`);
}

async function localStart() {
  if (env === 'local') {
    npm('run', 'local:up');
    console.log('\nLocal stack: web http://localhost:3002, API http://localhost:8002');
    return;
  }
  npm('run', 'dev:up');
  console.log('\nStarting API (:8001) and web (:3001); Ctrl-C stops both.');
  const children = ['dev:api', 'dev:web'].map((script) => spawn('npm', ['run', script], { stdio: 'inherit', shell }));
  const stopAll = () => children.forEach((c) => c.exitCode === null && c.kill('SIGINT'));
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  const codes = await Promise.all(
    children.map((c) => new Promise((resolve) => c.on('exit', (code) => { stopAll(); resolve(code ?? 0); }))),
  );
  process.exit(Math.max(...codes));
}

// ---------------------------------------------------------------------------------------------
// VPS instances and Azure

async function remoteBuild() {
  const { sha, branch } = headInfo();
  const existing = gh('run', 'list', '--workflow', 'build-push.yml', '--commit', sha, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // empty');
  if (existing || branch === 'main') {
    // A push to main builds by itself (sha-<commit> and latest), cloning the private plugins' HEADs as it starts.
    const id = await watch(['--workflow', 'build-push.yml', '--commit', sha], 'build-push');
    const stale = missedPlugins(id);
    if (stale.length > 0) {
      // A plugin commit came after that build (or only plugins changed): build again, which retags sha-<commit>.
      console.log(`\nThe build has older plugin commits (${stale.join(', ')}): building again.`);
      const again = await dispatch('build-push.yml', { image_tag: 'latest' }, 'build-push (plugins)', 'main');
      const still = missedPlugins(again);
      if (still.length > 0) {
        console.error(`\nThe images still lack plugin commits: ${still.join(', ')} (pushed?).`);
        process.exit(1);
      }
    }
  } else {
    // Off main: build this branch, tagged by branch name (and sha-<commit>), leaving latest alone.
    await dispatch('build-push.yml', { image_tag: branch.replace(/[^A-Za-z0-9_.-]/g, '-') }, 'build-push', branch);
  }
}

/** The plugins whose commit in a build-push run's log (`plugin <id>: <repo>@<sha>`) is not the local HEAD. */
function missedPlugins(runId) {
  const log = run('gh', ['run', 'view', runId, '--log'], { capture: true, allowFail: true }) ?? '';
  const built = Object.fromEntries([...log.matchAll(/plugin ([\w-]+): \S+@([0-9a-f]{7,})/g)].map((m) => [m[1], m[2]]));
  if (Object.keys(built).length === 0 && pluginRepos().length > 0) {
    console.warn(`\nCould not read the plugin commits of build ${runId}: check the images' Information screen after the deploy.`);
  }
  return pluginRepos().flatMap(({ id, path }) => {
    if (!built[id]) return [];
    const local = git('-C', path, 'rev-parse', 'HEAD');
    return local.startsWith(built[id]) ? [] : [`${id} ${built[id]} instead of ${local.slice(0, 7)}`];
  });
}

async function remoteStart() {
  // Dispatched on the current branch, so the migrations and seed shipped match the images.
  const { tag, branch } = headInfo();
  if (env === 'azure') await dispatch('azure-deploy.yml', { image_tag: tag }, 'azure-deploy', branch);
  else await dispatch('vps.yml', { action: 'deploy', environment: env, image_tag: tag }, `vps deploy ${env}`, branch);
}

/** VPS: deploy and reset in one run (the migrations run once, on the emptied database). */
async function remoteDeployReset() {
  const { tag, branch } = headInfo();
  await confirmReset(`This deploys ${tag} to ${env} and drops its public schema (backed up on the server first unless RESET_BACKUP=false), then loads the demo seed.`);
  await dispatch('vps.yml', { action: 'deploy-reset', environment: env, image_tag: tag, confirmation: 'RESET worktime3 public schema' }, `vps deploy-reset ${env}`, branch);
}

async function remoteReset() {
  const { tag, branch } = headInfo();
  if (env === 'azure') {
    const server = gh('variable', 'get', 'AZURE_PG_SERVER_NAME', '--env', 'azure');
    await confirmReset(`This DELETES the Azure Postgres server ${server} (all data, Keycloak's too) and creates a new one with the demo seed and image ${tag}. It takes a while.`);
    await dispatch('azure.yml', { action: 'dropdb', confirm: server }, 'azure dropdb', branch);
    await dispatch('azure.yml', { action: 'initdb', seed: 'true', image_tag: tag }, 'azure initdb', branch);
    return;
  }
  await confirmReset(`This drops the public schema of ${env} (backed up on the server first), migrates and loads the demo seed.`);
  await dispatch('vps.yml', { action: 'reset-seed', environment: env, image_tag: tag, confirmation: 'RESET worktime3 public schema' }, `vps reset-seed ${env}`, branch);
}

// ---------------------------------------------------------------------------------------------

const has = (s) => requested.has(s);

if (has('stop')) {
  npm('run', `${env}:down`);
  process.exit(0);
}
if (has('push')) push();
if (!remote) {
  if (has('build')) localBuild();
  if (has('reset')) localReset();
  if (has('start')) await localStart();
} else {
  if (has('build')) await remoteBuild();
  if (env !== 'azure' && has('start') && has('reset')) {
    await remoteDeployReset();
  } else {
    // Azure's reset creates the apps with the new images itself, so it replaces the deploy.
    if (has('start') && !(env === 'azure' && has('reset'))) await remoteStart();
    if (has('reset')) await remoteReset();
  }
}
console.log(`\nDone: ${env} ${ORDER.filter(has).join(' ')}.`);
