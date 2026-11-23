import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewVersion, mainScriptOf } from './appVersion.ts';

const page = (hash) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script></head></html>`;

test('the main file of a built start page; none on the development server', () => {
  assert.equal(mainScriptOf(page('Vvj2ENSh')), '/assets/index-Vvj2ENSh.js');
  assert.equal(mainScriptOf('<script type="module" src="/src/main.tsx"></script>'), null);
});

test('a new version is another main file on the server; nothing when unknown', () => {
  assert.equal(isNewVersion('/assets/index-old.js', page('new')), true);
  assert.equal(isNewVersion('/assets/index-same.js', page('same')), false);
  assert.equal(isNewVersion(null, page('new')), false, 'development: the running app has no built main file');
  assert.equal(isNewVersion('/assets/index-old.js', '<html>maintenance</html>'), false, 'a page that is not ours');
});
