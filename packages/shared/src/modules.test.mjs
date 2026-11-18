import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MODULES, resolveModules, validateModules, withoutDisabledModules } from './modules.ts';
import { permissionObject } from './permissions.ts';

test('every module object is in the permission catalogue', () => {
  for (const m of MODULES) for (const o of m.objects) assert.ok(permissionObject(o), `${m.id}: ${o}`);
});

test('modules take their default unless the organization chose', () => {
  assert.deepEqual(resolveModules(undefined), { requests: true, reports: true, cases: false });
  assert.deepEqual(resolveModules({ requests: false, gone: true }), { requests: false, reports: true, cases: false });
  assert.deepEqual(resolveModules({ requests: 'no', reports: false, cases: true }), { requests: true, reports: false, cases: true });
});

test('a modules patch takes known ids with boolean values only', () => {
  assert.deepEqual(validateModules({ requests: false }), { ok: true, modules: { requests: false } });
  assert.deepEqual(validateModules({ chat: true }), { ok: false, error: 'unknown-module' });
  assert.deepEqual(validateModules({ requests: 1 }), { ok: false, error: 'invalid-modules' });
  assert.deepEqual(validateModules([]), { ok: false, error: 'invalid-modules' });
});

test('a switched-off module takes its permissions away', () => {
  const held = new Set(['nav.requests:edit:own', 'nav.time:edit:own']);
  assert.deepEqual([...withoutDisabledModules(held, { requests: false })], ['nav.time:edit:own']);
  assert.equal(withoutDisabledModules(held, { requests: true }), held);
});
