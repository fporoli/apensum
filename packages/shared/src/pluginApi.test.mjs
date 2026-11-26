import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLUGIN_API_VERSION, pluginApiMismatch, inPluginOrder, pluginOrder } from './pluginApi.ts';

test('a plugin must state the plugin API version of this core', () => {
  assert.equal(pluginApiMismatch('demo', PLUGIN_API_VERSION), null);
  assert.match(pluginApiMismatch('demo', undefined), /demo: package.json apensum.apensumApi is missing/);
  assert.match(pluginApiMismatch('demo', PLUGIN_API_VERSION + 1), /built for plugin API \d+, this core provides \d+/);
  assert.match(pluginApiMismatch('demo', String(PLUGIN_API_VERSION)), /built for plugin API/, 'a number, not a string');
});

test("a plugin's names start with its id", async () => {
  const { namespaceMismatch, namespaceViolations } = await import('./pluginApi.ts');
  const ok = ['cases', 'cases_documents', 'casesArchive', 'cases.approve', 'nav.cases', 'nav.casesTemplates', 'section.cases.notes', 'cases-x'];
  assert.deepEqual(namespaceViolations('cases', ok.map((name) => ({ kind: 'x', name }))), []);
  const bad = ['case_documents', 'casesarchive', 'documents', 'nav.time', 'section.basicdata.cases', 'expense.approve'];
  assert.deepEqual(namespaceViolations('cases', bad.map((name) => ({ kind: 'x', name }))).map((n) => n.name), bad);
  assert.match(namespaceMismatch('cases', [{ kind: 'table', name: 'documents' }], undefined), /must start with "cases".*table documents/);
  assert.equal(namespaceMismatch('cases', [{ kind: 'table', name: 'documents' }], true), null, 'legacyNames: carved out of the core');
  assert.equal(namespaceMismatch('cases', [{ kind: 'table', name: 'cases_x' }], undefined), null);
});

test('plugins load after the plugins they require, else by id; a missing or circular one is an error', () => {
  assert.deepEqual(pluginOrder([{ id: 'notes' }, { id: 'billing', requires: ['expenses'] }, { id: 'expenses' }, { id: 'cases' }]), { order: ['cases', 'expenses', 'billing', 'notes'] });
  assert.deepEqual(pluginOrder([{ id: 'b' }, { id: 'a' }]), { order: ['a', 'b'] }, 'without requires: by id, as before');
  assert.deepEqual(pluginOrder([{ id: 'c', requires: ['b'] }, { id: 'b', requires: ['a'] }, { id: 'a' }]), { order: ['a', 'b', 'c'] });
  assert.match(pluginOrder([{ id: 'billing', requires: ['expenses'] }]).error, /billing requires expenses, which is not installed/);
  assert.match(pluginOrder([{ id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }]).error, /circle: a -> b -> a/);
  assert.match(pluginOrder([{ id: 'a', requires: 'b' }]).error, /must be a list/);
  assert.match(pluginOrder([{ id: 'a', requires: ['a'] }]).error, /itself/);
  const sorted = inPluginOrder([{ manifest: { id: 'billing', requires: ['expenses'] }, dir: 'x' }, { manifest: { id: 'expenses' }, dir: 'y' }]);
  assert.deepEqual(sorted.map((p) => p.dir), ['y', 'x']);
  assert.throws(() => inPluginOrder([{ manifest: { id: 'billing', requires: ['expenses'] } }]), /not installed/);
});
