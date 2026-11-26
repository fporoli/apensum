import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MODULES, licensedIn, registerModule, resolveModules, validateModules, withoutDisabledModules } from './modules.ts';
import { permissionObject } from './permissions.ts';

test('every module object is in the permission catalogue', () => {
  for (const m of MODULES) for (const o of m.objects) assert.ok(permissionObject(o), `${m.id}: ${o}`);
});

test('modules take their default unless the organization chose', () => {
  // The core's modules; plugins add theirs (registerModule, e.g. cases: default off).
  assert.deepEqual(resolveModules(undefined), { flows: true, reports: true, news: true });
  assert.deepEqual(resolveModules({ flows: false, gone: true }), { flows: false, reports: true, news: true });
  assert.deepEqual(resolveModules({ flows: 'no', reports: false, cases: true }), { flows: true, reports: false, news: true });
});

test('a modules patch takes known ids with boolean values only', () => {
  assert.deepEqual(validateModules({ flows: false }), { ok: true, modules: { flows: false } });
  assert.deepEqual(validateModules({ chat: true }), { ok: false, error: 'unknown-module' });
  assert.deepEqual(validateModules({ flows: 1 }), { ok: false, error: 'invalid-modules' });
  assert.deepEqual(validateModules([]), { ok: false, error: 'invalid-modules' });
});

test('a switched-off module takes its permissions away', () => {
  const held = new Set(['nav.flows:edit:own', 'nav.time:edit:own']);
  assert.deepEqual([...withoutDisabledModules(held, { flows: false })], ['nav.time:edit:own']);
  assert.equal(withoutDisabledModules(held, { flows: true }), held);
});

test('a licensed module is off by default and named by licensedIn', () => {
  assert.throws(() => registerModule({ id: 'paid', caption: 'modules.paid', defaultEnabled: true, objects: [], licensed: true }), /off by default/);
  registerModule({ id: 'paid', caption: 'modules.paid', defaultEnabled: false, objects: [], licensed: true });
  try {
    assert.equal(resolveModules(undefined).paid, false);
    assert.equal(resolveModules({ paid: true }).paid, false, 'switched on without a license');
    assert.equal(resolveModules({ paid: true }, ['paid']).paid, true);
    assert.equal(resolveModules({ paid: false }, ['paid']).paid, false, 'licensed and switched off');
    assert.equal(resolveModules(undefined, ['paid']).paid, false, 'a license alone switches nothing on');
    assert.deepEqual(licensedIn({ paid: true, flows: false }), ['paid']);
    assert.deepEqual(licensedIn({ flows: false }), []);
  } finally {
    MODULES.splice(MODULES.findIndex((m) => m.id === 'paid'), 1);
  }
});
