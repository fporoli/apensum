import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLUGIN_API_VERSION, pluginApiMismatch } from './pluginApi.ts';

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
