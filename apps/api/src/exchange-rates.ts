import { sql } from 'drizzle-orm';
import type { ExchangeRate } from '@worktime3/shared/exchangeRates';
import type { Executor } from './access';

/** Reporting currency when an organization has no `settings.defaultCurrency` (as orgs.controller.ts). */
export const FALLBACK_REPORTING_CURRENCY = 'CHF';

/**
 * The exchange rates in force for an organization: its own, and the defaults for every organization
 * (organization_id NULL, from changesets) for each currency pair it keeps none of. `r` is the row alias.
 */
export function effectiveRates(orgId: string) {
  return sql`(r.organization_id = ${orgId}::uuid OR (r.organization_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM exchange_rates o WHERE o.organization_id = ${orgId}::uuid AND o.currency = r.currency AND o.target_currency = r.target_currency)))`;
}

/** The organization's reporting currency (`settings.defaultCurrency`), else CHF. */
export async function reportingCurrencyOf(db: Executor, orgId: string): Promise<string> {
  const rows = await db.execute(sql`SELECT settings->>'defaultCurrency' AS currency FROM organizations WHERE id = ${orgId}::uuid`);
  const currency = (rows.rows[0] as { currency?: string | null } | undefined)?.currency;
  return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : FALLBACK_REPORTING_CURRENCY;
}

/** The rates in force for an organization (`exchangeRateOn` picks the one for a date). */
export async function exchangeRatesOf(db: Executor, orgId: string): Promise<ExchangeRate[]> {
  const rows = await db.execute(sql`
    SELECT currency, target_currency, valid_from::text AS valid_from, rate::float8 AS rate
    FROM exchange_rates r WHERE ${effectiveRates(orgId)}`);
  return (rows.rows as { currency: string; target_currency: string; valid_from: string; rate: number }[]).map((r) => ({
    currency: r.currency, targetCurrency: r.target_currency, validFrom: r.valid_from, rate: Number(r.rate),
  }));
}
