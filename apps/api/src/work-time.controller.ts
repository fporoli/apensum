import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { WorkTimeService } from './work-time.service';
import { VersionsService } from './versions.service';
import { addDays, isLongSession } from '@worktime3/shared/worktime';
import { callerUserId, canEditUserData, canSeeUserData, editableUserIds, isOrgMember, isPeriodLocked, listableUserIds, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { absences, organization_memberships, users, work_times } from './db/schema';
import { clientIp } from './client-ip';
import { crossesMonthEnd, dayContextFrom, dayContextTo, dayFindings, overlappingSessions, splitAtMonthEnds } from './work-time-day';
import { WorkTimeModelService } from './work-time-model.service';
import { zonedTime } from './report-schedule';

/** A session as the API returns it: everything but `client_ip`, which is stored and never shown (085). */
const { client_ip: _hiddenIp, ...SESSION_COLUMNS } = getTableColumns(work_times);

/** A session's values for the version history, without the client's address. */
function historyValues<T extends { client_ip?: unknown }>(values: T): Omit<T, 'client_ip'> {
  const { client_ip: _ip, ...rest } = values;
  return rest;
}

/** The refusal for a session that overlaps another of the person's (open sessions run until closed). */
function overlapError(other: { id: string; check_in: string; check_out: string | null }) {
  return { ok: false as const, error: 'overlap', overlap: { id: other.id, checkIn: other.check_in, checkOut: other.check_out } };
}

/** The permission object behind each page's time records (`time-record-people?kind=`). */
export const TIME_RECORD_OBJECTS: Record<string, string> = {
  workTime: 'nav.workTime',
  time: 'nav.time',
  timesheet: 'nav.timesheet',
  projectTimesheet: 'nav.projectTimesheet',
};

@Controller()
export class WorkTimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: WorkTimeService,
    private readonly versions: VersionsService,
    private readonly model: WorkTimeModelService,
  ) {}

  /** Starts a new session. Only one may be open (no `check_out`) per person at a time, across every org. */
  @Post('organizations/:orgId/work-time/check-in')
  async checkIn(@Param('orgId') orgId: string, @Body() body: { comment?: string; homeOffice?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };

    const now = new Date().toISOString();
    if (await isPeriodLocked(db, orgId, userId, now)) return { ok: false, error: 'period-locked' };

    const open = await this.findOpenSession(db, userId);
    if (open) return { ok: false, error: 'already-checked-in' };
    // A session that runs from now on must not meet one recorded later (an entry added by hand).
    const clash = await this.overlapping(db, orgId, userId, now, null);
    if (clash) return overlapError(clash);

    const values = {
      user_id: userId, organization_id: orgId, check_in: now, comment: body.comment ?? null,
      home_office: body.homeOffice === true && (await this.model.settings(db, orgId)).homeOffice, client_ip: clientIp(req),
    };
    const [row] = await db.insert(work_times).values(values).returning({ id: work_times.id });
    void this.versions.record('work_times', row.id, 'insert', userId, { id: row.id, ...historyValues(values) }).catch(() => {});
    return { ok: true, id: row.id, checkIn: now };
  }

  /**
   * Closes the caller's one open session, wherever it is — no org param needed. A session open
   * longer than LONG_SESSION_MINUTES (usually a forgotten check-out) answers `long-session-confirm`
   * with its check-in until resent with `{ acknowledgeLongSession: true }`.
   */
  @Post('work-time/check-out')
  async checkOut(@Body() body: { acknowledgeLongSession?: boolean } | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };

    const open = await this.findOpenSession(db, userId);
    if (!open) return { ok: false, error: 'not-checked-in' };

    const now = new Date().toISOString();
    if (isLongSession(open.check_in, now) && !body?.acknowledgeLongSession) {
      return { ok: false, error: 'long-session-confirm', checkIn: open.check_in };
    }
    // A session past a month end is cut there (each month is its own timesheet): the open row ends at
    // midnight of the 1st, the rest becomes a session of the new month, home office and comment kept.
    const pieces = splitAtMonthEnds(open.check_in, now, await this.model.timeZone(db, userId));
    const patch = { check_out: pieces[0].end };
    await db.update(work_times).set(patch).where(eq(work_times.id, open.id));
    void this.versions.record('work_times', open.id, 'update_delta', userId, patch).catch(() => {});
    for (const piece of pieces.slice(1)) {
      const values = {
        user_id: userId, organization_id: open.organization_id, check_in: piece.start, check_out: piece.end,
        comment: open.comment, home_office: open.home_office, client_ip: clientIp(req),
      };
      const [row] = await db.insert(work_times).values(values).returning({ id: work_times.id });
      void this.versions.record('work_times', row.id, 'insert', userId, { id: row.id, ...historyValues(values) }).catch(() => {});
    }
    return { ok: true, id: open.id, checkOut: now, ...(pieces.length > 1 ? { splitAtMonthEnd: pieces.length - 1 } : {}) };
  }

  /** The caller's currently-open session, if any — drives the frontend button's initial state. */
  @Get('work-time/status')
  async status(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return null;
    return this.findOpenSession(db, userId);
  }

  /**
   * A completed entry added by hand (a forgotten check-in, a correction): by the person, their
   * designated manager or HR (`nav.workTime` edit beyond own), only while the month is open.
   */
  @Post('organizations/:orgId/users/:userId/work-time')
  async addEntry(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: { checkIn?: string; checkOut?: string; comment?: string; homeOffice?: boolean; acknowledgeLongSession?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, targetUserId))) return { ok: false, error: 'unknown-user' };
    if (!(await canEditUserData(db, orgId, callerId, 'nav.workTime', targetUserId))) return { ok: false, error: 'forbidden' };
    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : '';
    const checkOut = typeof body.checkOut === 'string' ? body.checkOut : '';
    if (Number.isNaN(Date.parse(checkIn)) || Number.isNaN(Date.parse(checkOut)) || Date.parse(checkOut) <= Date.parse(checkIn)) {
      return { ok: false, error: 'invalid-range' };
    }
    // Every month the session touches must be open (a night shift on the 31st reaches the 1st).
    if (await isPeriodLocked(db, orgId, targetUserId, checkIn, checkOut)) return { ok: false, error: 'period-locked' };
    if (crossesMonthEnd(checkIn, checkOut, await this.model.timeZone(db, targetUserId))) return { ok: false, error: 'crosses-month' };
    const clash = await this.overlapping(db, orgId, targetUserId, checkIn, checkOut);
    if (clash) return overlapError(clash);
    if (isLongSession(checkIn, checkOut) && !body.acknowledgeLongSession) return { ok: false, error: 'long-session-confirm' };
    const values = {
      user_id: targetUserId, organization_id: orgId, check_in: checkIn, check_out: checkOut, comment: body.comment?.trim() || null,
      home_office: body.homeOffice === true && (await this.model.settings(db, orgId)).homeOffice, client_ip: clientIp(req),
    };
    const [row] = await db.insert(work_times).values(values).returning({ id: work_times.id });
    void this.versions.record('work_times', row.id, 'insert', callerId, { id: row.id, ...historyValues(values) }).catch(() => {});
    return { ok: true, id: row.id };
  }

  /**
   * The people whose time records the caller may change on a page (`kind`: work time, project
   * time, or either monthly timesheet): themselves, their direct reports, and whoever an edit
   * grant beyond own covers (HR: everyone). Drives the person picker on those pages.
   */
  @Get('organizations/:orgId/time-record-people')
  async timeRecordPeople(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('kind') kind?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', people: [] };
    const object = TIME_RECORD_OBJECTS[kind ?? ''];
    if (!object) return { ok: false, error: 'invalid-kind', people: [] };
    // Everyone whose records the caller may see (the whole reporting line below them, grants), each
    // flagged `editable` when they may also change them (self, direct reports, HR); the page is
    // read-only for the others.
    const [editable, visible] = await Promise.all([editableUserIds(db, orgId, callerId, object), listableUserIds(db, orgId, callerId, object)]);
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active')];
    if (visible !== 'all' && editable !== 'all') conditions.push(inArray(organization_memberships.user_id, [...new Set([...visible, ...editable])]));
    const rows = await db
      .select({ id: users.id, name: users.display_name, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    return { ok: true, people: rows.map((r) => ({ ...r, editable: editable === 'all' || editable.has(r.id) })) };
  }

  @Get('organizations/:orgId/work-time')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('view') view?: 'daily' | 'weekly' | 'monthly',
  ) {
    const db = this.db.getDb();
    if (!db) return { entries: [], summary: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { entries: [], summary: {} };

    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!(await canSeeUserData(db, orgId, callerId, 'nav.workTime', targetUserId))) {
        return { entries: [], summary: {} };
      }
    } else if (!targetUserId && !(await reachesAll(db, orgId, callerId, 'nav.workTime'))) {
      // No person asked for: everyone's entries only for grants reaching all; otherwise one's own.
      targetUserId = callerId;
    }

    const conditions = [eq(work_times.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(work_times.user_id, targetUserId));
    if (from) conditions.push(gte(work_times.check_in, from));
    if (to) conditions.push(lt(work_times.check_in, to));

    const rows = await db
      .select(SESSION_COLUMNS)
      .from(work_times)
      .where(and(...conditions))
      .orderBy(asc(work_times.check_in));

    const closed = rows.filter((r) => r.check_out);
    const summary = this.wt.bucket(
      closed.map((r) => ({ startTime: r.check_in, endTime: r.check_out as string })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('work-time/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { checkIn?: string; checkOut?: string | null; comment?: string; homeOffice?: boolean; acknowledgeLongSession?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;

    const checkIn = body.checkIn ?? owned.entry.check_in;
    const checkOut = body.checkOut !== undefined ? body.checkOut : owned.entry.check_out;
    const moved = checkIn !== owned.entry.check_in || checkOut !== owned.entry.check_out;
    if (moved) {
      if (Number.isNaN(Date.parse(checkIn)) || (checkOut && (Number.isNaN(Date.parse(checkOut)) || Date.parse(checkOut) <= Date.parse(checkIn)))) {
        return { ok: false, error: 'invalid-range' };
      }
      // Where the session ends up must be open too, over every day it covers.
      if (owned.entry.organization_id && (await isPeriodLocked(db, owned.entry.organization_id, owned.entry.user_id, checkIn, checkOut))) {
        return { ok: false, error: 'period-locked' };
      }
      if (checkOut && crossesMonthEnd(checkIn, checkOut, await this.model.timeZone(db, owned.entry.user_id))) return { ok: false, error: 'crosses-month' };
      if (owned.entry.organization_id) {
        const clash = await this.overlapping(db, owned.entry.organization_id, owned.entry.user_id, checkIn, checkOut, id);
        if (clash) return overlapError(clash);
      }
      if (checkOut && isLongSession(checkIn, checkOut) && !body.acknowledgeLongSession) return { ok: false, error: 'long-session-confirm' };
    }

    const patch: Partial<typeof work_times.$inferInsert> = {};
    if (body.checkIn !== undefined) patch.check_in = body.checkIn;
    if (body.checkOut !== undefined) patch.check_out = body.checkOut;
    if (body.comment !== undefined) patch.comment = body.comment;
    // The mark only changes while the organization uses it (work-time settings `homeOffice`).
    if (typeof body.homeOffice === 'boolean' && owned.entry.organization_id && (await this.model.settings(db, owned.entry.organization_id)).homeOffice) {
      patch.home_office = body.homeOffice;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    await db.update(work_times).set({ ...patch, client_ip: clientIp(req) }).where(eq(work_times.id, id));
    void this.versions.record('work_times', id, 'update_delta', owned.userId, patch).catch(() => {});
    return { ok: true };
  }

  @Delete('work-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableEntry(db, id, req);
    if ('error' in owned) return owned;
    await db.delete(work_times).where(eq(work_times.id, id));
    void this.versions.record('work_times', id, 'delete', owned.userId, owned.entry).catch(() => {});
    return { ok: true };
  }

  /**
   * What the entry dialog shows under a session of `date` (the person's local day) while it is edited:
   * the day's sessions, the person's absences that day, which sessions the draft (`checkIn`/`checkOut`,
   * empty end = still running; `excludeId` = the session being edited) overlaps, which refuses a save,
   * and the Working Hours Act hints for the day with the draft in place (work-time-day.ts). Read access
   * as for the person's work time.
   */
  @Get('organizations/:orgId/users/:userId/work-time/day')
  async day(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Req() req: AuthenticatedRequest,
    @Query('date') date?: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const empty = { entries: [], absences: [], holiday: null, overlaps: [], findings: [] };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, ...empty };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', ...empty };
    if (targetUserId !== callerId && !(await canSeeUserData(db, orgId, callerId, 'nav.workTime', targetUserId))) return { ok: false, error: 'forbidden', ...empty };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid-date', ...empty };
    const draft = checkIn && !Number.isNaN(Date.parse(checkIn))
      ? { id: excludeId || null, checkIn, checkOut: checkOut && !Number.isNaN(Date.parse(checkOut)) ? checkOut : null }
      : null;

    const [settings, timeZone, holidays] = await Promise.all([
      this.model.settings(db, orgId),
      this.model.timeZone(db, targetUserId),
      this.model.holidays(db, orgId, date, addDays(date, 1), { userId: targetUserId }),
    ]);
    const [sessions, dayAbsences] = await Promise.all([
      db
        .select({ id: work_times.id, check_in: work_times.check_in, check_out: work_times.check_out, comment: work_times.comment, home_office: work_times.home_office })
        .from(work_times)
        .where(and(
          eq(work_times.organization_id, orgId),
          eq(work_times.user_id, targetUserId),
          gte(work_times.check_in, `${dayContextFrom(date)}T00:00:00Z`),
          lt(work_times.check_in, `${addDays(dayContextTo(date), 1)}T00:00:00Z`),
        ))
        .orderBy(asc(work_times.check_in)),
      db
        .select({ id: absences.id, absence_type: absences.absence_type, status: absences.status, half_day: absences.half_day, date_start: absences.date_start, date_end: absences.date_end })
        .from(absences)
        .where(and(
          eq(absences.organization_id, orgId),
          eq(absences.user_id, targetUserId),
          lte(absences.date_start, date),
          gte(absences.date_end, date),
          inArray(absences.status, ['pending', 'approved']),
        )),
    ]);
    // The day's sessions: those that start on it or reach into it, in the person's zone.
    const dayStart = zonedTime(date, 0, timeZone).getTime();
    const dayEnd = zonedTime(addDays(date, 1), 0, timeZone).getTime();
    const entries = sessions.filter((x) => Date.parse(x.check_in) < dayEnd && (x.check_out === null || Date.parse(x.check_out) > dayStart) && x.id !== draft?.id);
    // An open session that began before the loaded weeks still meets the draft.
    const open = await this.findOpenSession(db, targetUserId);
    const candidates = open && open.organization_id === orgId && !sessions.some((x) => x.id === open.id) ? [...sessions, open] : sessions;
    const overlaps = draft ? overlappingSessions(candidates, draft.checkIn, draft.checkOut, draft.id).map((x) => x.id) : [];
    const findings = dayFindings(sessions, draft, date, {
      timeZone,
      maxWeeklyMinutes: settings.legalMaxWeeklyMinutes,
      yearLimitMinutes: settings.legalOvertimeYearLimitMinutes,
    });
    return { ok: true, timeZone, entries, absences: dayAbsences, holiday: holidays.get(date) ?? null, overlaps, findings };
  }

  /** The person's first session in this organization that [start, end) overlaps (end null = still running), `excludeId` left out. */
  private async overlapping(db: Db, orgId: string, userId: string, start: string, end: string | null, excludeId?: string) {
    // Shared time of a minute or more (MIN_OVERLAP_MS): seconds from check-in/check-out don't count.
    const conditions = [
      eq(work_times.organization_id, orgId),
      eq(work_times.user_id, userId),
      or(isNull(work_times.check_out), gt(work_times.check_out, sql`${start}::timestamptz + interval '1 minute'`)),
    ];
    if (end !== null) conditions.push(lt(work_times.check_in, sql`${end}::timestamptz - interval '1 minute'`));
    conditions.push(sql`least(coalesce(${work_times.check_out}, 'infinity'::timestamptz), ${end ?? 'infinity'}::timestamptz) - greatest(${work_times.check_in}, ${start}::timestamptz) >= interval '1 minute'`);
    if (excludeId) conditions.push(ne(work_times.id, excludeId));
    const [row] = await db
      .select({ id: work_times.id, check_in: work_times.check_in, check_out: work_times.check_out })
      .from(work_times)
      .where(and(...conditions))
      .orderBy(asc(work_times.check_in))
      .limit(1);
    return row ?? null;
  }

  private async findOpenSession(db: Db, userId: string) {
    const [row] = await db
      .select(SESSION_COLUMNS)
      .from(work_times)
      .where(and(eq(work_times.user_id, userId), isNull(work_times.check_out)));
    return row ?? null;
  }

  /**
   * Entries are editable by the person they belong to, their designated manager and HR
   * (`nav.workTime` edit beyond own), and only outside a submitted/approved timesheet period:
   * a locked month has to be reopened first. Returns `{error}` when disallowed,
   * or the entry (plus caller id) when the edit may proceed.
   */
  private async assertEditableEntry(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; entry: { user_id: string; organization_id: string | null; check_in: string; check_out: string | null } }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db
      .select({ user_id: work_times.user_id, organization_id: work_times.organization_id, check_in: work_times.check_in, check_out: work_times.check_out })
      .from(work_times)
      .where(eq(work_times.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId && !(row.organization_id && (await canEditUserData(db, row.organization_id, userId, 'nav.workTime', row.user_id)))) {
      return { ok: false, error: 'forbidden' };
    }
    if (row.organization_id && (await isPeriodLocked(db, row.organization_id, row.user_id, row.check_in, row.check_out))) {
      return { ok: false, error: 'period-locked' };
    }
    return { userId, entry: row };
  }
}
