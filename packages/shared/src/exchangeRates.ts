// Exchange rates an organization keeps by hand, with history (exchange_rates), over the defaults for every
// organization (organization_id NULL, from changesets; read-only). Amounts in another currency are converted
// to the organization's reporting currency with the rate in force on their date (e.g. the expenses plugin
// books expenses with it). Pure, for the API, the web app and plugins.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export interface ExchangeRate {
  currency: string;
  targetCurrency: string;
  /** YYYY-MM-DD */
  validFrom: string;
  rate: number;
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
