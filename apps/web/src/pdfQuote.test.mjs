import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuote, normalizeQuote } from './pdfQuote.ts';

test('a quote is normalized like the evidence check', () => {
  assert.equal(normalizeQuote('  «Er kommt» – zu   spät!  '), '"er kommt" - zu spät');
  assert.equal(normalizeQuote('Grüsse, Strasse'), 'grüsse strasse');
  assert.equal(normalizeQuote('Grüße'), 'grüsse');
});

test('a quote inside one item', () => {
  assert.deepEqual(findQuote([['Lena liest gerne und beteiligt sich']], 'liest gerne'), [{ page: 0, item: 0, start: 5, end: 16 }]);
});

test('a quote across items, line breaks and pages, ignoring case and punctuation', () => {
  const pages = [['Am 4. November weinte', 'sie deswegen.'], ['Die Mutter holt Lena']];
  assert.deepEqual(findQuote(pages, 'weinte sie deswegen die mutter'), [
    { page: 0, item: 0, start: 15, end: 21 },
    { page: 0, item: 1, start: 0, end: 12 },
    { page: 1, item: 0, start: 0, end: 10 },
  ]);
});

test('ß in the text matches ss in the quote, and spaces of the text are not counted twice', () => {
  assert.deepEqual(findQuote([['Freundliche  Grüße']], 'freundliche grüsse'), [{ page: 0, item: 0, start: 0, end: 18 }]);
});

test('nothing for a missing or empty quote', () => {
  assert.deepEqual(findQuote([['abc']], 'xyz'), []);
  assert.deepEqual(findQuote([['abc']], ' … '), []);
});
