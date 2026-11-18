import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { zonedDate, zonedTime } from './report-schedule';
import { zoneFormatter } from './zone-format';
import { absences, org_holidays, organizations, users, work_schedules } from './db/schema';
import {
  DEFAULT_FULL_TIME_WEEKLY_MINUTES,
  DEFAULT_PROJECT_TIME_TOLERANCE_MINUTES,
  DEFAULT_LEGAL_MAX_WEEKLY_MINUTES,
  DEFAULT_VACATION_DAYS_PER_YEAR,
  defaultLegalOvertimeYearLimit,
  isIsoDate,
  addDays,
  dayTargets,
  defaultSchedule,
  holidaysBetween,
  isCanton,
  projectTimeWithinAttendance,
  type AbsenceSpan,
  type Canton,
  type DayTarget,
  type Holiday,
  type OrgHolidayRow,
  type WorkSchedule,
  type WorkTimeModel,
} from '@worktime3/shared/worktime';

export interface WorkTimeSettings {
  /** Minutes of a 100% week, the base for workload percentages and the default schedule. */
  fullTimeWeeklyMinutes: number;
  /** The organization's canton for public holidays; null = only its own holiday rows. */
  holidayRegion: Canton | null;
  /** How far project time on a day may exceed that day's attendance. */
  projectTimeToleranceMinutes: number;
  /** Vacation days of a full-time year (prorated by workload and membership). */
  vacationDaysPerYear: number;
  /** The balance report flags overtime above this many minutes. */
  overtimeAlertMinutes: number;
  /** The balance report flags a deficit beyond this many minutes. */
  undertimeAlertMinutes: number;
  /** Balances count from this date; null = from each person's first recorded activity. */
  balancesStartDate: string | null;
  /** Legal weekly maximum (ArG art. 9): attendance beyond it is Überzeit. 45 h or 50 h. */
  legalMaxWeeklyMinutes: number;
  /** Überzeit allowed per year (ArG art. 12): 170 h at a 45 h maximum, 140 h at 50 h, unless set. */
  legalOvertimeYearLimitMinutes: number;
}

export const DEFAULT_OVERTIME_ALERT_MINUTES = 50 * 60;
export const DEFAULT_UNDERTIME_ALERT_MINUTES = 20 * 60;

/** Reads `organizations.settings` into work-time settings, with defaults. */
export function parseWorkTimeSettings(settings: unknown): WorkTimeSettings {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const weekly = s.fullTimeWeeklyMinutes;
  const tolerance = s.projectTimeToleranceMinutes;
  const nonNegative = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const legalMax = typeof s.legalMaxWeeklyMinutes === 'number' && s.legalMaxWeeklyMinutes > 0 ? s.legalMaxWeeklyMinutes : DEFAULT_LEGAL_MAX_WEEKLY_MINUTES;
  return {
    fullTimeWeeklyMinutes: typeof weekly === 'number' && weekly > 0 ? weekly : DEFAULT_FULL_TIME_WEEKLY_MINUTES,
    holidayRegion: isCanton(s.holidayRegion) ? s.holidayRegion : null,
    projectTimeToleranceMinutes: typeof tolerance === 'number' && tolerance >= 0 ? tolerance : DEFAULT_PROJECT_TIME_TOLERANCE_MINUTES,
    vacationDaysPerYear: nonNegative(s.vacationDaysPerYear, DEFAULT_VACATION_DAYS_PER_YEAR),
    overtimeAlertMinutes: nonNegative(s.overtimeAlertMinutes, DEFAULT_OVERTIME_ALERT_MINUTES),
    undertimeAlertMinutes: nonNegative(s.undertimeAlertMinutes, DEFAULT_UNDERTIME_ALERT_MINUTES),
    balancesStartDate: isIsoDate(s.balancesStartDate) ? s.balancesStartDate : null,
    legalMaxWeeklyMinutes: legalMax,
    legalOvertimeYearLimitMinutes: nonNegative(s.legalOvertimeYearLimitMinutes, defaultLegalOvertimeYearLimit(legalMax)),
  };
}

/** 'YYYY-MM-DD' of an instant in a time zone (falls back to UTC for an unknown zone). */
export function localDate(instant: Date | string, timeZone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  try {
    return zoneFormatter('date', timeZone).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** The zone itself when Intl knows it, else UTC (as `localDate` falls back). */
function validZone(timeZone: string): string {
  try {
    zoneFormatter('date', timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** A stretch of time: a check-in/check-out session or a project-time entry. */
export interface TimeSpan {
  start: Date | string;
  end: Date | string;
}

/**
 * Minutes per local day ('YYYY-MM-DD' in `timeZone`) of `spans`, each split at local midnight, so
 * a night shift from 22:00 to 06:00 counts 2 hours on its first day and 6 on the next. Only days
 * from `from` to `toExclusive` are kept; days with no time are left out. Midnight is taken from the
 * zone, so the split stays right across a daylight saving switch.
 */
export function minutesByLocalDay(spans: readonly TimeSpan[], from: string, toExclusive: string, zone: string): Map<string, number> {
  const timeZone = validZone(zone);
  const ms = new Map<string, number>();
  for (const span of spans) {
    const end = new Date(span.end).getTime();
    let start = new Date(span.start).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    let day = zonedDate(new Date(start), timeZone);
    while (start < end) {
      const nextMidnight = zonedTime(addDays(day, 1), 0, timeZone).getTime();
      const pieceEnd = Math.min(end, nextMidnight);
      if (day >= from && day < toExclusive && pieceEnd > start) ms.set(day, (ms.get(day) ?? 0) + (pieceEnd - start));
      start = nextMidnight;
      day = addDays(day, 1);
      if (day >= toExclusive) break;
    }
  }
  const out = new Map<string, number>();
  for (const [day, total] of ms) {
    const minutes = Math.round(total / 60000);
    if (minutes > 0) out.set(day, minutes);
  }
  return out;
}

/** The local days ('YYYY-MM-DD') a span touches; a span ending at 00:00 does not touch that day. */
export function localDaysOf(span: TimeSpan, zone: string): string[] {
  const timeZone = validZone(zone);
  const start = new Date(span.start);
  const end = new Date(span.end);
  const first = zonedDate(start, timeZone);
  const last = end.getTime() > start.getTime() ? zonedDate(new Date(end.getTime() - 1), timeZone) : first;
  const days = [first];
  while (days[days.length - 1] < last) days.push(addDays(days[days.length - 1], 1));
  return days;
}

export type ProjectTimeCheck =
  | { ok: true }
  | { ok: false; error: 'project-exceeds-attendance'; date: string; projectMinutes: number; attendanceMinutes: number; toleranceMinutes: number };

/**
 * Database side of the work-time model (packages/shared/src/worktime.ts): loads a person's
 * schedules, holidays and approved absences, their attendance per local day, and derives
 * targets, the running overtime balance and the project-time check from them. Callers
 * authorize first; nothing here checks permissions.
 */
@Injectable()
export class WorkTimeModelService {
  async settings(db: Db, orgId: string): Promise<WorkTimeSettings> {
    const [row] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    return parseWorkTimeSettings(row?.settings);
  }

  async timeZone(db: Db, userId: string): Promise<string> {
    const [row] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    return row?.timezone || 'UTC';
  }

  async schedules(db: Db, orgId: string, userId: string): Promise<(WorkSchedule & { id: string })[]> {
    const rows = await db
      .select({ id: work_schedules.id, valid_from: work_schedules.valid_from, workload_percent: work_schedules.workload_percent, day_minutes: work_schedules.day_minutes })
      .from(work_schedules)
      .where(and(eq(work_schedules.organization_id, orgId), eq(work_schedules.user_id, userId)))
      .orderBy(work_schedules.valid_from);
    return rows.map((r) => ({ id: r.id, validFrom: r.valid_from, workloadPercent: Number(r.workload_percent), dayMinutes: r.day_minutes }));
  }

  async orgHolidayRows(db: Db, orgId: string, from?: string, toExclusive?: string): Promise<(OrgHolidayRow & { id: string })[]> {
    const conditions = [eq(org_holidays.organization_id, orgId)];
    if (from) conditions.push(gte(org_holidays.date, from));
    if (toExclusive) conditions.push(lte(org_holidays.date, addDays(toExclusive, -1)));
    const rows = await db
      .select({ id: org_holidays.id, date: org_holidays.date, name: org_holidays.name, fraction: org_holidays.fraction, observed: org_holidays.observed })
      .from(org_holidays)
      .where(and(...conditions))
      .orderBy(org_holidays.date);
    return rows.map((r) => ({ id: r.id, date: r.date, name: r.name, fraction: Number(r.fraction), observed: r.observed }));
  }

  /** The organization's holidays: its canton's, with its own rows applied. */
  async holidays(db: Db, orgId: string, from: string, toExclusive: string): Promise<Map<string, Holiday>> {
    const settings = await this.settings(db, orgId);
    return holidaysBetween(from, toExclusive, settings.holidayRegion, await this.orgHolidayRows(db, orgId, from, toExclusive));
  }

  /** Approved absences of any type overlapping the range: they all count against the target. */
  async approvedAbsences(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<AbsenceSpan[]> {
    const rows = await db
      .select({ date_start: absences.date_start, date_end: absences.date_end, half_day: absences.half_day, absence_type: absences.absence_type })
      .from(absences)
      .where(
        and(
          eq(absences.organization_id, orgId),
          eq(absences.user_id, userId),
          eq(absences.status, 'approved'),
          lte(absences.date_start, addDays(toExclusive, -1)),
          gte(absences.date_end, from),
        ),
      );
    return rows.map((r) => ({ dateStart: r.date_start, dateEnd: r.date_end, halfDay: r.half_day, type: r.absence_type }));
  }

  async model(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<WorkTimeModel> {
    const settings = await this.settings(db, orgId);
    const [schedules, holidays, spans] = await Promise.all([
      this.schedules(db, orgId, userId),
      this.holidays(db, orgId, from, toExclusive),
      this.approvedAbsences(db, orgId, userId, from, toExclusive),
    ]);
    return { schedules, fallback: defaultSchedule(settings.fullTimeWeeklyMinutes), holidays, absences: spans };
  }

  async targets(db: Db, orgId: string, userId: string, from: string, toExclusive: string): Promise<DayTarget[]> {
    return dayTargets(from, toExclusive, await this.model(db, orgId, userId, from, toExclusive));
  }

  /**
   * Attended minutes per local day ('YYYY-MM-DD' in `timeZone`) from check-in/check-out sessions,
   * each split at local midnight (`minutesByLocalDay`): a night shift counts on both days, in both
   * weeks and months it touches. `includeOpen` counts a session still open up to now.
   */
  async attendanceByDay(db: Db, orgId: string, userId: string, from: string, toExclusive: string, timeZone: string, includeOpen: boolean): Promise<Map<string, number>> {
    const result = await db.execute(sql`
      SELECT check_in AS start, COALESCE(check_out, now()) AS end
      FROM work_times
      WHERE organization_id = ${orgId} AND user_id = ${userId}
        AND check_in < (${toExclusive}::date::timestamp AT TIME ZONE ${timeZone})
        AND COALESCE(check_out, now()) > (${from}::date::timestamp AT TIME ZONE ${timeZone})
        ${includeOpen ? sql`` : sql`AND check_out IS NOT NULL`}`);
    return minutesByLocalDay(result.rows as unknown as TimeSpan[], from, toExclusive, timeZone);
  }

  /** Project minutes per local day, each entry split at local midnight, optionally leaving one entry out. */
  async projectMinutesByDay(db: Db, orgId: string, userId: string, from: string, toExclusive: string, timeZone: string, excludeId?: string): Promise<Map<string, number>> {
    const result = await db.execute(sql`
      SELECT start_time AS start, end_time AS end
      FROM project_times
      WHERE organization_id = ${orgId} AND user_id = ${userId}
        AND start_time < (${toExclusive}::date::timestamp AT TIME ZONE ${timeZone})
        AND end_time > (${from}::date::timestamp AT TIME ZONE ${timeZone})
        ${excludeId ? sql`AND id <> ${excludeId}` : sql``}`);
    return minutesByLocalDay(result.rows as unknown as TimeSpan[], from, toExclusive, timeZone);
  }

  /**
   * Whether an entry from `startTime` to `endTime` keeps project time within attendance (an open
   * session counts up to now) plus the organization's tolerance, on every local day it touches:
   * an entry past midnight is checked against both days. The first day over the limit is reported.
   */
  async checkProjectTime(db: Db, orgId: string, userId: string, startTime: string, endTime: string, excludeId?: string): Promise<ProjectTimeCheck> {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: true };
    const timeZone = await this.timeZone(db, userId);
    const days = localDaysOf({ start, end }, timeZone);
    const from = days[0];
    const toExclusive = addDays(days[days.length - 1], 1);
    const { projectTimeToleranceMinutes } = await this.settings(db, orgId);
    const [booked, attendance] = await Promise.all([
      this.projectMinutesByDay(db, orgId, userId, from, toExclusive, timeZone, excludeId),
      this.attendanceByDay(db, orgId, userId, from, toExclusive, timeZone, true),
    ]);
    const entry = minutesByLocalDay([{ start, end }], from, toExclusive, timeZone);
    for (const date of days) {
      const projectMinutes = (booked.get(date) ?? 0) + (entry.get(date) ?? 0);
      const attendanceMinutes = attendance.get(date) ?? 0;
      if (!projectTimeWithinAttendance(projectMinutes, attendanceMinutes, projectTimeToleranceMinutes)) {
        return { ok: false, error: 'project-exceeds-attendance', date, projectMinutes, attendanceMinutes, toleranceMinutes: projectTimeToleranceMinutes };
      }
    }
    return { ok: true };
  }
}
