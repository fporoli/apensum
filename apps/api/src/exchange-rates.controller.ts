import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { validateExchangeRate } from '@worktime3/shared/exchangeRates';
import { callerUserId, can, isOrgMember } from './access';
import { DbService } from './db.service';
import { effectiveRates, reportingCurrencyOf } from './exchange-rates';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';

/**
 * Exchange rates an organization keeps by hand, with history (exchange_rates), over the defaults for every
 * organization (organization_id NULL, changesets; read-only): read by every member (forms preview converted
 * amounts with them), changed with Organization settings rights (`nav.orgSettings:edit`). Whatever was converted
 * keeps the rate it was converted with. Modules use them through the plugin contract (exchange-rates.ts).
 */
@Controller('organizations/:orgId/exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rates: [], reportingCurrency: null, editable: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: true, rates: [], reportingCurrency: null, editable: false };
    const rows = await db.execute(sql`
      SELECT id, currency, target_currency, valid_from::text AS valid_from, rate::float8 AS rate, (organization_id IS NULL) AS standard
      FROM exchange_rates r WHERE ${effectiveRates(orgId)}
      ORDER BY currency, valid_from DESC`);
    return {
      ok: true,
      reportingCurrency: await reportingCurrencyOf(db, orgId),
      editable: await can(db, orgId, callerId, 'nav.orgSettings', 'edit'),
      // `standard`: a default for every organization (read-only), in force while this one keeps none for the currency.
      rates: (rows.rows as { id: string; currency: string; target_currency: string; valid_from: string; rate: number; standard: boolean }[]).map((r) => ({
        id: r.id, currency: r.currency, targetCurrency: r.target_currency, validFrom: r.valid_from, rate: Number(r.rate), standard: r.standard === true,
      })),
    };
  }

  /** Adds a rate, or replaces the one of the same currency and date. */
  @Post()
  async upsert(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const reportingCurrency = await reportingCurrencyOf(db, orgId);
    const checked = validateExchangeRate(body, reportingCurrency);
    if (!checked.ok) return checked;
    const { currency, validFrom, rate } = checked.value;
    const rows = await db.execute(sql`
      INSERT INTO exchange_rates (organization_id, currency, target_currency, valid_from, rate)
      VALUES (${orgId}::uuid, ${currency}, ${reportingCurrency}, ${validFrom}::date, ${rate})
      ON CONFLICT (organization_id, currency, target_currency, valid_from) DO UPDATE SET rate = EXCLUDED.rate
      RETURNING id`);
    const id = String((rows.rows[0] as { id: string }).id);
    void this.versions.record('exchange_rates', id, 'update_delta', callerId, { organization_id: orgId, currency, target_currency: reportingCurrency, valid_from: validFrom, rate }).catch(() => {});
    return { ok: true, id };
  }

  @Delete(':id')
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
}
