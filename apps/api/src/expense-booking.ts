import { sql } from 'drizzle-orm';
import { MILEAGE_CATEGORY, bookExpense, type BookingResult, type ExchangeRate } from '@worktime3/shared/expenses';
import type { Db } from './db.service';

/** Reporting currency when an org has no `settings.defaultCurrency` (same fallback as orgs.controller.ts). */
export const FALLBACK_REPORTING_CURRENCY = 'CHF';

export interface BookingContext {
  reportingCurrency: string;
  rates: ExchangeRate[];
  /** Effective static_data expenses/mileage_rate values: the org's copy, else the global row. */
  mileageRates: Record<string, unknown>;
}

/** What booking an expense of this organization needs, read in one go. */
export async function bookingContext(db: Db, orgId: string): Promise<BookingContext> {
  const [org, rates, mileage] = await Promise.all([
    db.execute(sql`SELECT settings->>'defaultCurrency' AS currency FROM organizations WHERE id = ${orgId}::uuid`),
    db.execute(sql`
      SELECT currency, target_currency, valid_from::text AS valid_from, rate::float8 AS rate
      FROM exchange_rates WHERE organization_id = ${orgId}::uuid
    `),
    db.execute(sql`
      SELECT "values" FROM static_data
      WHERE entity = 'expenses' AND enum_name = 'mileage_rate' AND (organization_id = ${orgId}::uuid OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1
    `),
  ]);
  const currency = (org.rows[0] as { currency?: string | null } | undefined)?.currency;
  return {
    reportingCurrency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : FALLBACK_REPORTING_CURRENCY,
    rates: (rates.rows as { currency: string; target_currency: string; valid_from: string; rate: number }[]).map((r) => ({
      currency: r.currency, targetCurrency: r.target_currency, validFrom: r.valid_from, rate: Number(r.rate),
    })),
    mileageRates: ((mileage.rows[0] as { values?: Record<string, unknown> } | undefined)?.values) ?? {},
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Columns that decide the booked amount: when a patch touches none of them, an expense is left as booked. */
export const BOOKING_COLUMNS = ['category', 'expense_date', 'original_value', 'original_currency', 'value', 'quantity', 'currency'] as const;

/**
 * Books an expense from its (merged) column values: returns the columns to write on top
 * (value, currency, exchange_rate, unit_rate, and for mileage the receipt amount cleared), or the error.
 */
export function bookColumns(row: Record<string, unknown>, ctx: BookingContext): { ok: true; columns: Record<string, unknown> } | { ok: false; error: string } {
  const result: BookingResult = bookExpense({
    category: typeof row.category === 'string' ? row.category : null,
    expenseDate: String(row.expense_date ?? '').slice(0, 10),
    originalValue: num(row.original_value),
    originalCurrency: typeof row.original_currency === 'string' && row.original_currency ? row.original_currency : null,
    value: num(row.value),
    quantity: num(row.quantity),
  }, ctx.reportingCurrency, ctx.rates, ctx.mileageRates);
  if (!result.ok) return result;
  const b = result.booking;
  const columns: Record<string, unknown> = {
    value: b.value.toFixed(2),
    currency: b.currency,
    exchange_rate: b.exchangeRate === null ? null : String(b.exchangeRate),
    unit_rate: b.unitRate === null ? null : String(b.unitRate),
  };
  if (row.category === MILEAGE_CATEGORY) Object.assign(columns, { original_value: null, original_currency: null });
  return { ok: true, columns };
}
