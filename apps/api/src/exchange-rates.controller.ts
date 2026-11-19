import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { validateExchangeRate } from '@worktime3/shared/expenses';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { bookingContext } from './expense-booking';

/**
 * Exchange rates an organization keeps by hand, with history (exchange_rates, 077): read by every
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
    if (!db) return { ok: true, offline: true, rates: [], reportingCurrency: null, mileageRates: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: true, rates: [], reportingCurrency: null, mileageRates: {} };
    const ctx = await bookingContext(db, orgId);
    const rows = await db.execute(sql`
      SELECT id, currency, target_currency, valid_from::text AS valid_from, rate::float8 AS rate
      FROM exchange_rates WHERE organization_id = ${orgId}::uuid
      ORDER BY currency, valid_from DESC
    `);
    const editable = await can(db, orgId, callerId, 'nav.orgSettings', 'edit');
    return {
      ok: true,
      reportingCurrency: ctx.reportingCurrency,
      mileageRates: ctx.mileageRates,
      editable,
      rates: (rows.rows as { id: string; currency: string; target_currency: string; valid_from: string; rate: number }[]).map((r) => ({
        id: r.id, currency: r.currency, targetCurrency: r.target_currency, validFrom: r.valid_from, rate: Number(r.rate),
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
}
