import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { ADJUSTMENT_KINDS, BALANCE_KINDS, BalancesService, employedFrom, type AdjustmentKind, type BalanceKind } from './balances.service';
import { callerUserId, canEditBeyondOwn, canSeeUserData, isOrgMember, isYearClosed, listableUserIds, permissionIdsOf, visibleUserIds } from './access';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { organization_memberships, users } from './db/schema';
import type { AuthenticatedRequest } from './jwt.guard';
import { isTimeNotRecorded } from './time-recording';
import { isIsoDate } from '@worktime3/shared/worktime';
import { NotificationsService } from './notifications.service';
import { yearClosedNotice, yearReopenedNotice } from './year-closing-notice';
import { clock } from './clock';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

/** Others' balances are behind the "Time balances" page; one's own are always visible. */
const OBJECT = 'nav.balances';

function parseYear(value: string | undefined): number {
  return /^\d{4}$/.test(value ?? '') ? Number(value) : clock.now().getFullYear();
}

@Controller()
export class BalancesController {
  constructor(
    private readonly db: DbService,
    private readonly balances: BalancesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Headline numbers for the Home and Work time pages: overtime booked and pending, vacation left this year. */
  @Get('organizations/:orgId/balances')
  async get(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string) {
    const db = this.db.getDb();
    if (!db) return null;
    const target = await this.target(db, orgId, req, userId);
    if (!target) return null;
    const year = await this.balances.year(db, orgId, target, clock.now().getFullYear());
    return {
      overtimeMinutes: year.overtime.bookedMinutes,
      pendingOvertimeMinutes: year.overtime.pendingMinutes,
      pendingSince: year.overtime.pendingSince,
      vacationDays: year.vacation.remaining,
      vacationPlannedDays: year.vacation.planned,
      timeRecorded: !(await isTimeNotRecorded(db, orgId, target, clock.now())),
    };
  }

  /** A person's year: months with target, attendance and balance; vacation; adjustments. */
  @Get('organizations/:orgId/balances/year')
  async year(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('userId') userId?: string, @Query('year') yearParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    const target = await this.target(db, orgId, req, userId);
    if (!callerId || !target) return { ok: false, error: 'forbidden' };
    const balances = await this.balances.year(db, orgId, target, parseYear(yearParam));
    const canEdit = await canEditBeyondOwn(db, orgId, callerId, OBJECT, target);
    // How the entitlement comes about tells the age: for the person and HR, not for the reporting line.
    const seesBasis = canEdit || target === callerId;
    return { ok: true, ...balances, vacation: seesBasis ? balances.vacation : { ...balances.vacation, basis: null }, canEdit };
  }

  /** Everyone the caller may see for a month (`YYYY-MM`), with over/under-budget and timesheet alerts. */
  @Get('organizations/:orgId/balances/report')
  async report(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('month') monthParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rows: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', rows: [] };
    if (!/^\d{4}-\d{2}$/.test(monthParam ?? '') || !isIsoDate(`${monthParam}-01`)) return { ok: false, error: 'invalid-month', rows: [] };
    const ids = await listableUserIds(db, orgId, callerId, OBJECT);
    return { ok: true, rows: await this.balances.report(db, orgId, ids, `${monthParam}-01`) };
  }

  /** Books an opening balance, correction or payout (minutes for overtime, days for vacation). */
  @Post('organizations/:orgId/balances/adjustments')
  async addAdjustment(
    @Param('orgId') orgId: string,
    @Body() body: { userId?: string; balance?: string; kind?: string; effectiveDate?: string; amount?: number; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.userId || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, body.userId))) return { ok: false, error: 'forbidden' };
    const error = validateAdjustment(body);
    if (error) return { ok: false, error };
    // A closed year is not changed: a correction goes into the next open year, or the year is reopened.
    if (await isYearClosed(db, orgId, body.userId, Number((body.effectiveDate as string).slice(0, 4)))) return { ok: false, error: 'year-closed' };
    const id = await this.balances.addAdjustment(db, {
      organizationId: orgId,
      userId: body.userId,
      balance: body.balance as BalanceKind,
      kind: body.kind as AdjustmentKind,
      effectiveDate: body.effectiveDate as string,
      amount: body.amount as number,
      note: body.note?.trim() || null,
      actorUserId: callerId,
    });
    return { ok: true, id };
  }

  @Delete('organizations/:orgId/balances/adjustments/:id')
  async deleteAdjustment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'not-found' };
    const row = await this.balances.findAdjustment(db, id);
    if (!row || row.organization_id !== orgId) return { ok: false, error: 'not-found' };
    if (!(await canEditBeyondOwn(db, orgId, callerId, OBJECT, row.user_id))) return { ok: false, error: 'forbidden' };
    if (await isYearClosed(db, orgId, row.user_id, Number(row.effective_date.slice(0, 4)))) return { ok: false, error: 'year-closed' };
    await this.balances.deleteAdjustment(db, id, callerId);
    return { ok: true };
  }

  /** A person's vacation days for a year; `days: null` returns to the organization's default. */
  @Put('organizations/:orgId/balances/entitlements')
  async setEntitlement(
    @Param('orgId') orgId: string,
    @Body() body: { userId?: string; year?: number; days?: number | null; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.userId || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, body.userId))) return { ok: false, error: 'forbidden' };
    if (!Number.isInteger(body.year) || (body.year as number) < 2000 || (body.year as number) > 2100) return { ok: false, error: 'invalid-year' };
    const days = body.days ?? null;
    if (days !== null && !(typeof days === 'number' && Number.isFinite(days) && days >= 0 && days <= 366)) return { ok: false, error: 'invalid-days' };
    if (await isYearClosed(db, orgId, body.userId, body.year as number)) return { ok: false, error: 'year-closed' };
    await this.balances.setEntitlement(db, orgId, body.userId, body.year as number, days === null ? null : Math.round(days * 100) / 100, body.note?.trim() || null, callerId);
    return { ok: true };
  }

  /**
   * The year-end closing for a year: every active member the caller may see on the balances page, with
   * where their year stands (`BalancesService.yearStatus`) and whether the caller may close or reopen it
   * (an edit grant beyond own, like adjustments: HR and admin).
   */
  @Get('organizations/:orgId/balance-years')
  async closingOverview(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('year') yearParam?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rows: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', rows: [] };
    const year = parseYear(yearParam ?? String(clock.now().getFullYear() - 1));
    const ids = await listableUserIds(db, orgId, callerId, OBJECT);
    if (ids !== 'all' && ids.length === 0) return { ok: true, year, rows: [] };
    // Who left before the year began has nothing in it to close.
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.is_active, true), employedFrom(`${year}-01-01`)];
    if (ids !== 'all') conditions.push(inArray(organization_memberships.user_id, ids));
    const people = await db
      .select({ id: users.id, name: users.display_name, email: users.email, timezone: users.timezone, membershipStatus: organization_memberships.status })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    const [statuses, editable] = await Promise.all([
      this.balances.yearStatuses(db, orgId, people, year),
      this.yearEditors(db, orgId, callerId, people.some(p => p.membershipStatus !== 'active')),
    ]);
    const rows = people.flatMap((p, i) => {
      const status = statuses[i];
      if (status.notEmployed) return [];
      const canEdit = (editable.allActive && p.membershipStatus === 'active') || editable.others.has(p.id);
      return [{ userId: p.id, displayName: p.name, email: p.email, ...status, canEdit }];
    });
    return { ok: true, year, rows };
  }

  /**
   * Closes the year for the people given: for each, any open earlier year of their employment first
   * (years close in order), then this one. Without `force`, a person with months whose timesheet is not
   * approved stays open and is reported with those months. One result per person.
   */
  @Post('organizations/:orgId/balance-years/close')
  async closeYears(@Param('orgId') orgId: string, @Body() body: { year?: number; userIds?: string[]; force?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, results: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', results: [] };
    const year = body.year;
    if (!Number.isInteger(year) || (year as number) < 2000 || (year as number) > 2100) return { ok: false, error: 'invalid-year', results: [] };
    const userIds = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((u): u is string => typeof u === 'string'))].slice(0, 2000) : [];
    const results: Array<{ userId: string; ok: boolean; error?: string; year?: number; months?: string[] }> = [];
    for (const userId of userIds) {
      if (!(await isOrgMember(db, orgId, userId)) || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, userId))) {
        results.push({ userId, ok: false, error: 'forbidden' });
        continue;
      }
      results.push({ userId, ...(await this.closeThrough(db, orgId, userId, year as number, callerId, body.force === true)) });
    }
    return { ok: true, results };
  }

  /** Reopens a person's year; only their newest closed year. */
  @Post('organizations/:orgId/balance-years/reopen')
  async reopenYear(@Param('orgId') orgId: string, @Body() body: { year?: number; userId?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.userId || !(await isOrgMember(db, orgId, body.userId)) || !(await canEditBeyondOwn(db, orgId, callerId, OBJECT, body.userId))) return { ok: false, error: 'forbidden' };
    if (!Number.isInteger(body.year)) return { ok: false, error: 'invalid-year' };
    const res = await this.balances.reopenYear(db, orgId, body.userId, body.year as number, callerId);
    if (!res.ok) return res;
    void this.notifyPerson(db, orgId, body.userId, res.id, (locale) => yearReopenedNotice(locale, body.year as number)).catch(() => {});
    return { ok: true };
  }

  private async yearEditors(db: Db, orgId: string, callerId: string, includeInactive: boolean) {
    const held = await permissionIdsOf(db, orgId, callerId);
    held.delete(`${OBJECT}:edit:own`);
    const allActive = held.delete(`${OBJECT}:edit:all`);
    const others = allActive && !includeInactive ? new Set<string>() : await visibleUserIds(db, orgId, callerId, OBJECT, 'edit', held);
    return { allActive, others: others === 'all' ? new Set<string>() : others };
  }

  /** Closes every open year of the person's employment up to `year`, oldest first; stops at the first that can't close. */
  private async closeThrough(db: Db, orgId: string, userId: string, year: number, callerId: string, force: boolean) {
    const status = await this.balances.yearStatus(db, orgId, userId, year);
    if (status.closing) return { ok: false, error: 'year-closed' };
    const start = Number((await this.balances.year(db, orgId, userId, year)).start.slice(0, 4));
    const closed = new Set((await this.balances.closings(db, orgId, userId)).map((c) => c.year));
    for (let y = start; y <= year; y++) {
      if (closed.has(y)) continue;
      const res = await this.balances.closeYear(db, orgId, userId, y, callerId, force);
      if (!res.ok) return { ...res, year: y };
      void this.notifyPerson(db, orgId, userId, res.id, (locale) => yearClosedNotice(locale, y, res.values)).catch(() => {});
    }
    return { ok: true };
  }

  /** The person hears that their year was closed or reopened, in their language (best effort, never fails the action). */
  private async notifyPerson(db: Db, orgId: string, userId: string, id: string, text: (locale: string | null) => { title: string; body: string }) {
    const [person] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
    const { title, body } = text(person?.locale ?? null);
    await this.notifications.notifyMany({
      organizationId: orgId,
      recipientUserIds: [userId],
      type: 'balance-year',
      title,
      body,
      sourceTable: 'balance_years',
      sourceTableUuid: id,
    });
  }

  /** The caller, or someone whose data they may see on the balances page (manager: their reports). */
  private async target(db: Db, orgId: string, req: AuthenticatedRequest, userId: string | undefined): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;
    if (!userId || userId === callerId) return callerId;
    return (await canSeeUserData(db, orgId, callerId, OBJECT, userId)) ? userId : null;
  }
}

/** Error code for an invalid adjustment, or null. */
export function validateAdjustment(body: { balance?: string; kind?: string; effectiveDate?: string; amount?: number }): string | null {
  if (!(BALANCE_KINDS as readonly string[]).includes(body.balance ?? '')) return 'invalid-balance';
  if (!(ADJUSTMENT_KINDS as readonly string[]).includes(body.kind ?? '')) return 'invalid-kind';
  if (!isIsoDate(body.effectiveDate)) return 'invalid-date';
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return 'invalid-amount';
  const limit = body.balance === 'vacation' ? 1000 : 100000 * 60;
  if (Math.abs(amount) > limit) return 'invalid-amount';
  return null;
}
