import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MILEAGE_CATEGORY, bookExpense, exchangeRateOn, isUnconverted, mileageRateOn, roundMoney, validateExchangeRate } from './expenses.ts';

const rates = [
  { currency: 'EUR', targetCurrency: 'CHF', validFrom: '2026-01-01', rate: 0.94 },
  { currency: 'EUR', targetCurrency: 'CHF', validFrom: '2026-11-01', rate: 0.93 },
  { currency: 'USD', targetCurrency: 'CHF', validFrom: '2026-01-01', rate: 0.8 },
  { currency: 'EUR', targetCurrency: 'USD', validFrom: '2026-01-01', rate: 1.1 },
];
const mileage = { '2000-01-01': '0.70', '2027-01-01': '0.75', 'bogus': '9', '2026-06-01': '-1' };
const base = { category: 'meals', expenseDate: '2026-11-15', originalValue: null, originalCurrency: null, value: null, quantity: null };

test('money rounds to 0.01 without float drift', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(10), 10);
});

test('the exchange rate in force on the date, for that pair only', () => {
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2026-10-31'), 0.94);
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2026-11-01'), 0.93);
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2025-12-31'), null, 'before the first rate');
  assert.equal(exchangeRateOn(rates, 'GBP', 'CHF', '2026-11-15'), null);
  assert.equal(exchangeRateOn(rates, 'EUR', 'USD', '2026-11-15'), 1.1);
});

test('the rate per km in force on the date; malformed or non-positive entries are ignored', () => {
  assert.equal(mileageRateOn(mileage, '2026-12-31'), 0.7);
  assert.equal(mileageRateOn(mileage, '2027-01-01'), 0.75);
  assert.equal(mileageRateOn({ '2026-01-01': '0,68' }, '2026-02-01'), 0.68, 'decimal comma');
  assert.equal(mileageRateOn({}, '2026-01-01'), null);
  assert.equal(mileageRateOn(null, '2026-01-01'), null);
});

test('booking: receipt in the reporting currency, in a foreign one, or the amount entered directly', () => {
  assert.deepEqual(bookExpense({ ...base, originalValue: 42.5, originalCurrency: 'CHF' }, 'CHF', rates, mileage),
    { ok: true, booking: { value: 42.5, currency: 'CHF', exchangeRate: null, unitRate: null } });
  assert.deepEqual(bookExpense({ ...base, originalValue: 100, originalCurrency: 'EUR' }, 'CHF', rates, mileage),
    { ok: true, booking: { value: 93, currency: 'CHF', exchangeRate: 0.93, unitRate: null } });
  assert.deepEqual(bookExpense({ ...base, originalValue: 100, originalCurrency: 'GBP' }, 'CHF', rates, mileage), { ok: false, error: 'exchange-rate-missing' });
  assert.deepEqual(bookExpense({ ...base, value: 12.345 }, 'CHF', rates, mileage),
    { ok: true, booking: { value: 12.35, currency: 'CHF', exchangeRate: null, unitRate: null } });
  assert.deepEqual(bookExpense(base, 'CHF', rates, mileage), { ok: false, error: 'amount-required' });
});

test('booking: mileage is km x rate in force, in the reporting currency; the receipt amount is ignored', () => {
  const trip = { ...base, category: MILEAGE_CATEGORY, quantity: 123.4, originalValue: 5, originalCurrency: 'EUR' };
  assert.deepEqual(bookExpense(trip, 'CHF', rates, mileage), { ok: true, booking: { value: 86.38, currency: 'CHF', exchangeRate: null, unitRate: 0.7 } });
  assert.deepEqual(bookExpense({ ...trip, quantity: 0 }, 'CHF', rates, mileage), { ok: false, error: 'mileage-km-required' });
  assert.deepEqual(bookExpense({ ...trip, quantity: 10_001 }, 'CHF', rates, mileage), { ok: false, error: 'mileage-km-required' });
  assert.deepEqual(bookExpense(trip, 'CHF', rates, {}), { ok: false, error: 'mileage-rate-missing' });
});

test('unconverted = booked in another currency than the reporting one', () => {
  assert.equal(isUnconverted({ currency: 'EUR' }, 'CHF'), true);
  assert.equal(isUnconverted({ currency: 'CHF' }, 'CHF'), false);
  assert.equal(isUnconverted({ currency: 'EUR' }, ''), false, 'reporting currency not loaded yet');
});

test('exchange rate entry validation', () => {
  assert.deepEqual(validateExchangeRate({ currency: 'eur', validFrom: '2026-11-01', rate: 0.931234567891 }, 'CHF'),
    { ok: true, value: { currency: 'EUR', validFrom: '2026-11-01', rate: 0.93123457 } });
  assert.deepEqual(validateExchangeRate({ currency: 'CHF', validFrom: '2026-11-01', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-same-currency' });
  assert.deepEqual(validateExchangeRate({ currency: 'EU', validFrom: '2026-11-01', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-currency' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-13-45', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-date' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-11-01', rate: 0 }, 'CHF'), { ok: false, error: 'exchange-rate-rate' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-11-01', rate: '0.9' }, 'CHF'), { ok: false, error: 'exchange-rate-rate' });
});

test('booking: a foreign receipt with the booked amount entered by hand keeps the effective rate, even without a rate', () => {
  const card = { ...base, originalValue: 120, originalCurrency: 'GBP', value: 139.9, valueOverride: true };
  assert.deepEqual(bookExpense(card, 'CHF', rates, mileage), { ok: true, booking: { value: 139.9, currency: 'CHF', exchangeRate: 1.16583333, unitRate: null } });
  assert.deepEqual(bookExpense({ ...card, value: 0 }, 'CHF', rates, mileage), { ok: false, error: 'amount-required' });
  // In the reporting currency there is nothing to override: the receipt amount is booked.
  assert.deepEqual(bookExpense({ ...card, originalCurrency: 'CHF' }, 'CHF', rates, mileage),
    { ok: true, booking: { value: 120, currency: 'CHF', exchangeRate: null, unitRate: null } });
});
