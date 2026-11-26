import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Every handler authorizes itself (CLAUDE.md, "API conventions"): each HTTP handler, unless it is @Public(), must call an
// access helper (callerUserId, can, isOrgMember, ...), directly or through a method of its own file that does (any
// depth), whether the organization is in the route, in a row it loads (`expenses/:id`) or nowhere. A check forgotten in
// a new endpoint fails here, not in production. The few that need none are listed in NO_CHECK, with the reason. The core
// alone (CI, without the private plugins) has some 220 handlers, some 160 of them with `orgId` in the route.
const REPO = join(__dirname, '../..');
const ROOTS = [join(REPO, 'apps/api/src'), join(REPO, 'plugins')];
const CHECKS = /\b(callerUserId|can|isOrgMember|isOperator|canSeeUserData|canEditUserData|listableUserIds|reachesAll|isOrgOwner|isManagerOf|canManageItem|canEditBeyondOwn)\(/;
/** Handlers that read nothing of anyone's (`file handler`). */
const NO_CHECK = new Map([
  ['apps/api/src/about.controller.ts about', 'build and server facts, behind the login'],
  ['apps/api/src/roles.controller.ts list', 'the global roles one can invite to (names and descriptions)'],
  ['apps/api/src/users.controller.ts me', 'the caller from their own token'],
]);
const HANDLER = /@(Get|Post|Put|Patch|Delete)\([^)]*\)\s*\n((?:\s*@[^\n]*\n)*)\s*(?:async\s+)?(\w+)\(/g;
const METHOD = /^ {2}(?:private |protected |public )?(?:static )?(?:async )?(\w+)\s*(?:<[^>]*>)?\(/gm;

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist', 'web', 'test', '.git'].includes(name)) return [];
    if (statSync(path).isDirectory()) return controllers(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * Where a method's body starts: after its parameters (from `paren`, the opening parenthesis) and its return type, which
 * may hold braces itself (`Promise<{ ok: boolean }>`, `: { ok: true }`): the first `{` outside brackets not opening a type.
 */
function bodyStart(src: string, paren: number): number {
  let depth = 0;
  let i = paren;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  depth = 0;
  let prev = ')';
  for (i = i + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' && depth === 0 && prev !== ':' && prev !== '|' && prev !== '&' && prev !== ',') return i;
    if ('<([{'.includes(ch)) depth++;
    else if ('>)]}'.includes(ch) && depth > 0) depth--;
    if (!/\s/.test(ch)) prev = ch;
  }
  return -1;
}

/** The text of the block that starts at `open` (an opening brace), braces matched. */
function block(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

test('every handler checks who calls (directly or through its own helpers)', () => {
  const unchecked: string[] = [];
  let count = 0;
  let withOrg = 0;
  for (const file of ROOTS.flatMap(controllers)) {
    const src = readFileSync(file, 'utf8');
    // The file's methods by name, and which of them check (directly, or by calling one that does).
    const bodies = new Map<string, string>();
    for (const m of src.matchAll(METHOD)) {
      const open = bodyStart(src, m.index! + m[0].length - 1);
      if (open > 0 && !bodies.has(m[1])) bodies.set(m[1], block(src, open));
    }
    const checking = new Set([...bodies].filter(([, b]) => CHECKS.test(b)).map(([n]) => n));
    for (let grew = true; grew;) {
      grew = false;
      for (const [name, body] of bodies) {
        if (checking.has(name)) continue;
        if ([...body.matchAll(/this\.(\w+)\(/g)].some((c) => checking.has(c[1]))) { checking.add(name); grew = true; }
      }
    }
    for (const m of src.matchAll(HANDLER)) {
      const before = src.slice(Math.max(0, m.index! - 120), m.index!);
      if (/@Public\(\)/.test(m[2]) || /@Public\(\)\s*$/.test(before)) continue;
      const paren = m.index! + m[0].length - 1;
      const open = bodyStart(src, paren);
      if (open < 0) continue;
      count++;
      if (/\borgId\b/.test(src.slice(paren, open))) withOrg++;
      const body = block(src, open);
      const ok = CHECKS.test(body) || [...body.matchAll(/this\.(\w+)\(/g)].some((c) => checking.has(c[1]));
      // Relative to the repository, whatever folder it is checked out in (a plugin's CI: apensum-<plugin>/).
      const name = `${relative(REPO, file).split(sep).join('/')} ${m[3]}`;
      if (!ok && !NO_CHECK.has(name)) unchecked.push(name);
    }
  }
  assert.ok(count > 180 && withOrg > 120, `found only ${count} handlers (${withOrg} with orgId): the scan is broken`);
  assert.deepEqual(unchecked, [], `handlers without an access check:\n${unchecked.join('\n')}`);
});
