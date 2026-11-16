import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffLink, parseReceiptHash } from './receiptHash.ts';

test('the QR link opens the phone page for its token, in the language it was made in', () => {
  const link = handoffLink('https://wt.example.ch', '/', 'aB3_x-9', 'fr');
  assert.equal(link, 'https://wt.example.ch/#/receipt/aB3_x-9?lang=fr');
  assert.deepEqual(parseReceiptHash(new URL(link).hash), { token: 'aB3_x-9', lang: 'fr' });
  assert.deepEqual(parseReceiptHash('#/receipt/abc'), { token: 'abc', lang: null });
  assert.equal(parseReceiptHash('#/expenses'), null);
  assert.equal(parseReceiptHash('#/receipt/'), null);
  assert.equal(parseReceiptHash('#/receipt/a/b'), null);
});

import { infoUrl } from './infoUrl.ts';

test('"More about Apensum" opens the website in the app language', () => {
  assert.equal(infoUrl('fr'), 'https://www.apensum.ch/fr/');
  assert.equal(infoUrl('de', 'https://example.ch/'), 'https://example.ch/de/');
});
