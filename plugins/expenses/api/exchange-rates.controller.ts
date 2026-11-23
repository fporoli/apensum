import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { validateAllowanceRate, validateExchangeRate } from '../shared/booking';
import { DbService, VersionsService, callerUserId, can, isOrgMember, type AuthenticatedRequest } from '@worktime3/api/plugin';
import { bookingContext, effectiveRates } from './expense-booking';

/**
 * Exchange rates an organization keeps by hand, with history (exchange_rates, 077), over the defaults
 * for every organization (organization_id NULL, changeset 002; read-only): read by every
 * member (the expense form previews the booked amount with them), changed with Organization
 * settings rights (`nav.orgSettings:edit`). Booked expenses keep the rate they were booked with.
 */
@Controller()
export class ExchangeRatesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  @Get('organizations/:orgId/exchange-rates')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rates: [], reportingCurrency: null, mileageRates: {}, allowanceRates: {}, allowanceLabels: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: true, rates: [], reportingCurrency: null, mileageRates: {}, allowanceRates: {}, allowanceLabels: {} };
    const ctx = await bookingContext(db, orgId);
    const rows = await db.execute(sql`
      SELECT id, currency, target_currency, valid_from::text AS valid_from, rate::float8 AS rate, (organization_id IS NULL) AS standard
      FROM exchange_rates r WHERE ${effectiveRates(orgId)}
      ORDER BY currency, valid_from DESC
    `);
    const editable = await can(db, orgId, callerId, 'nav.orgSettings', 'edit');
    return {
      ok: true,
      reportingCurrency: ctx.reportingCurrency,
      mileageRates: ctx.mileageRates,
      // Flat-rate allowances: {type: {validFrom: amount}} and the types' labels per language.
      allowanceRates: ctx.allowanceRates,
      allowanceLabels: ctx.allowanceLabels,
      editable,
      // `standard`: a default for every organization (read-only), in force while this one keeps none for the currency.
      rates: (rows.rows as { id: string; currency: string; target_currency: string; valid_from: string; rate: number; standard: boolean }[]).map((r) => ({
        id: r.id, currency: r.currency, targetCurrency: r.target_currency, validFrom: r.valid_from, rate: Number(r.rate), standard: r.standard === true,
      })),
    };
  }

  /** Adds a rate, or replaces the one of the same currency and date. */
  @Post('organizations/:orgId/exchange-rates')
  async upsert(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const { reportingCurrency } = await bookingContext(db, orgId);
    const checked = validateExchangeRate(body, reportingCurrency);
    if (!checked.ok) return checked;
    const { currency, validFrom, rate } = checked.value;
    const rows = await db.execute(sql`
      INSERT INTO exchange_rates (organization_id, currency, target_currency, valid_from, rate)
      VALUES (${orgId}::uuid, ${currency}, ${reportingCurrency}, ${validFrom}::date, ${rate})
      ON CONFLICT (organization_id, currency, target_currency, valid_from) DO UPDATE SET rate = EXCLUDED.rate
      RETURNING id
    `);
    const id = String((rows.rows[0] as { id: string }).id);
    void this.versions.record('exchange_rates', id, 'update_delta', callerId, { organization_id: orgId, currency, target_currency: reportingCurrency, valid_from: validFrom, rate }).catch(() => {});
    return { ok: true, id };
  }

  @Delete('organizations/:orgId/exchange-rates/:id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: 'not-found' };
    const rows = await db.execute(sql`DELETE FROM exchange_rates WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid RETURNING *`);
    if (rows.rows.length === 0) return { ok: false, error: 'not-found' };
    void this.versions.record('exchange_rates', id, 'delete', callerId, rows.rows[0]).catch(() => {});
    return { ok: true };
  }

  /**
   * Sets the amount of an allowance type from a date (`{type, validFrom, amount}`), or removes it
   * (`amount: null`). Kept in the organization's own copy of static_data expenses/allowance, made
   * from the global row (the types) on the first change.
   */
  @Post('organizations/:orgId/expense-allowances')
  async setAllowance(@Param('orgId') orgId: string, @Body() body: { type?: unknown; validFrom?: unknown; amount?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const { allowanceRates } = await bookingContext(db, orgId);
    const types = Object.keys(allowanceRates);
    const removing = body?.amount === null;
    const checked = validateAllowanceRate(removing ? { ...body, amount: 1 } : body, types);
    if (!checked.ok) return checked;
    const { type, validFrom, amount } = checked.value;
    await db.execute(sql`
      INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
      SELECT ${orgId}::uuid, entity, enum_name, "values", translation FROM static_data
      WHERE organization_id IS NULL AND entity = 'expenses' AND enum_name = 'allowance'
      ON CONFLICT DO NOTHING`);
    const rows = await db.execute(sql`
      UPDATE static_data
      SET "values" = jsonb_set("values", ARRAY[${type}],
        CASE WHEN ${removing} THEN COALESCE("values" -> ${type}, '{}'::jsonb) - ${validFrom}
             ELSE COALESCE("values" -> ${type}, '{}'::jsonb) || jsonb_build_object(${validFrom}::text, ${amount.toFixed(2)}::text) END)
      WHERE organization_id = ${orgId}::uuid AND entity = 'expenses' AND enum_name = 'allowance'
      RETURNING id, "values"`);
    const row = rows.rows[0] as { id: string; values: Record<string, unknown> } | undefined;
    if (!row) return { ok: false, error: 'not-found' };
    void this.versions.record('static_data', row.id, 'update_delta', callerId, { values: row.values }).catch(() => {});
    return { ok: true, allowanceRates: row.values };
  }
}
