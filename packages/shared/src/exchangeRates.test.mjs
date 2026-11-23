import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeRateOn, validateExchangeRate } from './exchangeRates.ts';

const rates = [
  { currency: 'EUR', targetCurrency: 'CHF', validFrom: '2026-01-01', rate: 0.94 },
  { currency: 'EUR', targetCurrency: 'CHF', validFrom: '2026-11-01', rate: 0.93 },
  { currency: 'EUR', targetCurrency: 'USD', validFrom: '2026-01-01', rate: 1.1 },
];

test('the rate in force on a date: the latest valid from on or before it, for that pair', () => {
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2026-10-31'), 0.94);
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2026-11-01'), 0.93);
  assert.equal(exchangeRateOn(rates, 'EUR', 'CHF', '2025-12-31'), null, 'before the first rate');
  assert.equal(exchangeRateOn(rates, 'GBP', 'CHF', '2026-11-15'), null);
  assert.equal(exchangeRateOn(rates, 'EUR', 'USD', '2026-11-15'), 1.1);
});

test('a rate as entered: a three-letter currency other than the reporting one, a date, a positive rate', () => {
  assert.deepEqual(validateExchangeRate({ currency: 'eur', validFrom: '2026-11-01', rate: 0.931234567891 }, 'CHF'),
    { ok: true, value: { currency: 'EUR', validFrom: '2026-11-01', rate: 0.93123457 } });
  assert.deepEqual(validateExchangeRate({ currency: 'CHF', validFrom: '2026-11-01', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-same-currency' });
  assert.deepEqual(validateExchangeRate({ currency: 'EU', validFrom: '2026-11-01', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-currency' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-13-45', rate: 1 }, 'CHF'), { ok: false, error: 'exchange-rate-date' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-11-01', rate: 0 }, 'CHF'), { ok: false, error: 'exchange-rate-rate' });
  assert.deepEqual(validateExchangeRate({ currency: 'EUR', validFrom: '2026-11-01', rate: '0.9' }, 'CHF'), { ok: false, error: 'exchange-rate-rate' });
});
