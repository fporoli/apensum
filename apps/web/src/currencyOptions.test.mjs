import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyOptions } from './currencyOptions.ts';

const values = { USD: 'US dollar', CHF: 'Swiss franc', EUR: 'Euro' };
const translation = { de: { CHF: 'Schweizer Franken', USD: 'US-Dollar' } };

test('default currency first, the rest by code, names in the language', () => {
  assert.deepEqual(currencyOptions(values, translation, 'de', 'CHF'), [
    { value: 'CHF', label: 'CHF – Schweizer Franken' },
    { value: 'EUR', label: 'EUR – Euro' },
    { value: 'USD', label: 'USD – US-Dollar' },
  ]);
});

test('codes to keep are added when the list lacks them', () => {
  const opts = currencyOptions(values, {}, 'en', 'CHF', ['jpy', '', 'EUR']);
  assert.deepEqual(opts.map((o) => o.value), ['CHF', 'EUR', 'JPY', 'USD']);
  assert.equal(opts.find((o) => o.value === 'JPY').label, 'JPY');
});

test('an empty list still offers the default currency', () => {
  assert.deepEqual(currencyOptions({}, {}, 'en', 'CHF'), [{ value: 'CHF', label: 'CHF' }]);
});

test('a currency list whose values carry properties takes its names from the translations', () => {
  assert.deepEqual(
    currencyOptions({ CHF: {}, EUR: { rounding: '0.05' } }, { en: { CHF: 'Swiss franc', EUR: 'Euro' }, de: { EUR: 'Euro (DE)' } }, 'de', 'CHF'),
    [{ value: 'CHF', label: 'CHF – Swiss franc' }, { value: 'EUR', label: 'EUR – Euro (DE)' }],
  );
});
