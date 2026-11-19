import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLUGIN_API_VERSION, pluginApiMismatch } from './pluginApi.ts';

test('a plugin must state the plugin API version of this core', () => {
  assert.equal(pluginApiMismatch('demo', PLUGIN_API_VERSION), null);
  assert.match(pluginApiMismatch('demo', undefined), /demo: package.json apensum.apensumApi is missing/);
  assert.match(pluginApiMismatch('demo', PLUGIN_API_VERSION + 1), /built for plugin API \d+, this core provides \d+/);
  assert.match(pluginApiMismatch('demo', String(PLUGIN_API_VERSION)), /built for plugin API/, 'a number, not a string');
});
