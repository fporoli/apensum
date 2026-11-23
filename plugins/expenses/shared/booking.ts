/**
 * How an expense's booked amount is worked out (expenses.controller.ts books with it, the expense
 * form previews with it, so both always agree):
 *   - a receipt in the reporting currency: the amount as is;
 *   - a receipt in another currency: amount x the organization's exchange rate in force on the
 *     expense date (exchange_rates, kept by hand with history); none = the expense is refused;
 *     unless the person overrides the booked amount (valueOverride): then that amount, with the
 *     effective rate (amount / receipt amount) kept;
 *   - mileage (category MILEAGE_CATEGORY): km x the rate per km in force on that date (static_data
 *     expenses/mileage_rate: key = valid from, value = rate; global default, org copy overrides);
 *   - a flat-rate allowance (category ALLOWANCE_CATEGORY, sub-category = its type): count x the
 *     organization's amount for that type in force on the date (static_data expenses/allowance:
 *     {type: {validFrom: amount}}; the global row has the types without amounts).
 * The rate used is stored with the expense, so later rate changes never change booked expenses.
 * Plain erasable TypeScript: imported by the browser, the API and Node tests.
 */

/** Category key of a mileage expense (quantity = km). Not in any category list: the form offers it itself. */
export const MILEAGE_CATEGORY = 'mileage';

/** Most km one mileage expense may claim (a typo guard, not a policy). */
export const MAX_MILEAGE_KM = 10_000;

/** Category key of a flat-rate allowance (Pauschalspesen; sub_category = type, quantity = count). Offered by the form itself. */
export const ALLOWANCE_CATEGORY = 'allowance';

/** Most allowances one expense may claim (a typo guard, not a policy). */
export const MAX_ALLOWANCE_COUNT = 100;

/** Categories whose amount comes from a rate, not from a receipt (no receipt amount, no receipt needed). */
export function isRateCategory(category: string | null | undefined): boolean {
  return category === MILEAGE_CATEGORY || category === ALLOWANCE_CATEGORY;
}

/** The amount of allowance `type` in force on `date` from the static_data values {type: {validFrom: amount}}, or null. */
export function allowanceRateOn(values: Readonly<Record<string, unknown>> | null | undefined, type: string, date: string): number | null {
  const rates = values?.[type];
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? mileageRateOn(rates as Record<string, unknown>, date) : null;
}

/** The allowance types with an amount in force on `date` (the ones the form offers then). */
export function allowanceTypesOn(values: Readonly<Record<string, unknown>> | null | undefined, date: string): string[] {
  return Object.keys(values ?? {}).filter((type) => allowanceRateOn(values, type, date) !== null);
}

export interface ExchangeRate {
  currency: string;
  targetCurrency: string;
  /** YYYY-MM-DD */
  validFrom: string;
  rate: number;
}

/** Money as booked: rounded to 0.01 (half away from zero, without binary float drift). */
export function roundMoney(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100;
}

/** The rate of `currency` -> `target` in force on `date` (latest valid_from on or before it), or null. */
export function exchangeRateOn(rates: readonly ExchangeRate[], currency: string, target: string, date: string): number | null {
  let best: ExchangeRate | null = null;
  for (const r of rates) {
    if (r.currency !== currency || r.targetCurrency !== target || r.validFrom > date) continue;
    if (!best || r.validFrom > best.validFrom) best = r;
  }
  return best ? best.rate : null;
}

/** The rate per km in force on `date` from the static_data values {validFrom: rate}, or null. */
export function mileageRateOn(values: Readonly<Record<string, unknown>> | null | undefined, date: string): number | null {
  let bestDate: string | null = null;
  let best: number | null = null;
  for (const [from, raw] of Object.entries(values ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > date) continue;
    const rate = Number(typeof raw === 'string' ? raw.replace(',', '.') : raw);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (bestDate === null || from > bestDate) {
      bestDate = from;
      best = rate;
    }
  }
  return best;
}

export interface BookingInput {
  category: string | null;
  expenseDate: string;
  /** Amount and currency on the receipt. */
  originalValue: number | null;
  originalCurrency: string | null;
  /** Amount entered directly (no receipt amount), in the reporting currency. */
  value: number | null;
  /** km for a mileage expense, the count of an allowance. */
  quantity: number | null;
  /** The allowance type (an allowance's sub-category). */
  subCategory?: string | null;
  /**
   * A receipt in another currency whose booked amount the person entered by hand (e.g. from the card
   * statement) instead of taking the rate: `value` is booked, the effective rate is stored with it.
   */
  valueOverride?: boolean;
}

export interface Booking {
  value: number;
  currency: string;
  exchangeRate: number | null;
  unitRate: number | null;
}

export type BookingResult = { ok: true; booking: Booking } | { ok: false; error: string };

/**
 * The booked amount of an expense. `rates` are the organization's exchange rates, `mileageRates`
 * its effective static_data expenses/mileage_rate values. Errors are API error codes.
 */
export function bookExpense(
  input: BookingInput,
  reportingCurrency: string,
  rates: readonly ExchangeRate[],
  mileageRates: Readonly<Record<string, unknown>> | null | undefined,
  allowanceRates?: Readonly<Record<string, unknown>> | null,
): BookingResult {
  if (input.category === ALLOWANCE_CATEGORY) {
    const type = input.subCategory ?? '';
    if (!type) return { ok: false, error: 'allowance-type-required' };
    const count = input.quantity;
    if (count === null || !Number.isInteger(count) || count <= 0 || count > MAX_ALLOWANCE_COUNT) return { ok: false, error: 'allowance-count-required' };
    const rate = allowanceRateOn(allowanceRates, type, input.expenseDate);
    if (rate === null) return { ok: false, error: 'allowance-rate-missing' };
    return { ok: true, booking: { value: roundMoney(count * rate), currency: reportingCurrency, exchangeRate: null, unitRate: rate } };
  }
  if (input.category === MILEAGE_CATEGORY) {
    const km = input.quantity;
    if (km === null || !Number.isFinite(km) || km <= 0 || km > MAX_MILEAGE_KM) return { ok: false, error: 'mileage-km-required' };
    const rate = mileageRateOn(mileageRates, input.expenseDate);
    if (rate === null) return { ok: false, error: 'mileage-rate-missing' };
    return { ok: true, booking: { value: roundMoney(km * rate), currency: reportingCurrency, exchangeRate: null, unitRate: rate } };
  }
  if (input.originalValue !== null && input.originalCurrency) {
    if (input.originalCurrency === reportingCurrency) {
      return { ok: true, booking: { value: roundMoney(input.originalValue), currency: reportingCurrency, exchangeRate: null, unitRate: null } };
    }
    if (input.valueOverride) {
      if (input.value === null || !Number.isFinite(input.value) || input.value <= 0 || input.originalValue <= 0) return { ok: false, error: 'amount-required' };
      const value = roundMoney(input.value);
      return { ok: true, booking: { value, currency: reportingCurrency, exchangeRate: Math.round((value / input.originalValue) * 1e8) / 1e8, unitRate: null } };
    }
    const rate = exchangeRateOn(rates, input.originalCurrency, reportingCurrency, input.expenseDate);
    if (rate === null) return { ok: false, error: 'exchange-rate-missing' };
    return { ok: true, booking: { value: roundMoney(input.originalValue * rate), currency: reportingCurrency, exchangeRate: rate, unitRate: null } };
  }
  if (input.value === null || !Number.isFinite(input.value) || input.value < 0) return { ok: false, error: 'amount-required' };
  return { ok: true, booking: { value: roundMoney(input.value), currency: reportingCurrency, exchangeRate: null, unitRate: null } };
}

/** An expense still booked in another currency than the reporting one (stored before conversion existed). */
export function isUnconverted(row: { currency: string }, reportingCurrency: string): boolean {
  return !!reportingCurrency && row.currency !== reportingCurrency;
}

/** Checks one allowance amount as entered (Organization settings); the error is an API code. */
export function validateAllowanceRate(raw: unknown, types: readonly string[]): { ok: true; value: { type: string; validFrom: string; amount: number } } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const type = typeof o.type === 'string' ? o.type : '';
  if (!types.includes(type)) return { ok: false, error: 'allowance-type' };
  const validFrom = typeof o.validFrom === 'string' ? o.validFrom : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(`${validFrom}T00:00:00Z`))) return { ok: false, error: 'allowance-date' };
  const amount = typeof o.amount === 'number' ? o.amount : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return { ok: false, error: 'allowance-amount' };
  return { ok: true, value: { type, validFrom, amount: roundMoney(amount) } };
}

/** Checks one exchange rate as entered (Organization settings); the error is an API code. */
export function validateExchangeRate(raw: unknown, reportingCurrency: string): { ok: true; value: Omit<ExchangeRate, 'targetCurrency'> } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const currency = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'exchange-rate-currency' };
  if (currency === reportingCurrency) return { ok: false, error: 'exchange-rate-same-currency' };
  const validFrom = typeof o.validFrom === 'string' ? o.validFrom : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(`${validFrom}T00:00:00Z`))) return { ok: false, error: 'exchange-rate-date' };
  const rate = typeof o.rate === 'number' ? o.rate : Number.NaN;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) return { ok: false, error: 'exchange-rate-rate' };
  return { ok: true, value: { currency, validFrom, rate: Math.round(rate * 1e8) / 1e8 } };
}
