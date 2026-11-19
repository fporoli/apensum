import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infoUrl } from './infoUrl.ts';

test('"More about Apensum" opens the website in the app language', () => {
  assert.equal(infoUrl('fr'), 'https://www.apensum.ch/fr/');
  assert.equal(infoUrl('de', 'https://example.ch/'), 'https://example.ch/de/');
});

test('the reset e-mail link opens the reset page for its token', async () => {
  const { parseResetHash } = await import('./resetHash.ts');
  assert.deepEqual(parseResetHash('#/reset/eyJ1Ijo.aB3_x-9?lang=it'), { token: 'eyJ1Ijo.aB3_x-9', lang: 'it' });
  assert.deepEqual(parseResetHash('#/reset/eyJ1Ijo.aB3_x-9'), { token: 'eyJ1Ijo.aB3_x-9', lang: null });
  assert.equal(parseResetHash('#/reset/no-dot'), null);
  assert.equal(parseResetHash('#/receipt/abc'), null);
  assert.equal(parseResetHash(''), null);
});
