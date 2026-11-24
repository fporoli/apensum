import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { balance_adjustments, balance_years, organization_memberships, timesheet_periods, users, vacation_entitlements, work_time_months } from './db/schema';
import { WorkTimeModelService, localDate, type WorkTimeSettings } from './work-time-model.service';
import { VersionsService } from './versions.service';
import { vacationProfile, type VacationProfile } from './vacation';
import { unpaidLeaveCut, unpaidLeaveDays, vacationDaysOn, type VacationDays } from '@worktime3/shared/vacation';
import { resolveAbsenceTypes, unpaidAbsenceTypes } from './absence-types';
import {
  addDays,
  dayTargets,
  defaultSchedule,
  legalOvertimeBetween,
  monthStart,
  monthsBetween,
  nextMonth,
  recordedAttendance,
  roundDays,
  scheduleOn,
  summarizeDays,
  vacationEntitlement,
  weekStart,
  type MonthSummary,
  type WorkTimeModel,
} from '@worktime3/shared/worktime';

/** `legal_overtime` is the Überzeit share of the overtime balance; its adjustments move both. */
export const BALANCE_KINDS = ['overtime', 'vacation', 'legal_overtime'] as const;
export type BalanceKind = (typeof BALANCE_KINDS)[number];
export const ADJUSTMENT_KINDS = ['opening', 'correction', 'payout'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export interface ClosedMonth {
  month: string;
  closedAt: string | null;
  summary: MonthSummary;
  /** Überzeit frozen with the month; null/absent for months closed before it was recorded. */
  legalOvertime?: number | null;
}

export interface Adjustment {
  id: string;
  balance: BalanceKind;
  kind: AdjustmentKind;
  effectiveDate: string;
  /** Minutes for overtime, full-time days for vacation. */
  amount: number;
  note: string | null;
}

/**
 * How a month stands: `closed` once its timesheet is approved (numbers frozen); otherwise the
 * timesheet's status (`submitted`, `rejected`) or, without one, `open` (past), `current` or
 * `future`. Months before the person's balances start are `before-start`, those in which they record
 * no working time `not-recorded`: nothing to submit, nothing that keeps a year open.
 */
export type MonthStatus = 'closed' | 'submitted' | 'rejected' | 'open' | 'current' | 'future' | 'before-start' | 'not-recorded';

export interface MonthBalance extends MonthSummary {
  month: string;
  status: MonthStatus;
  closedAt: string | null;
  /** Target of the whole month; `target`/`actual`/`delta` cover only the days before today. */
  monthTarget: number;
  /** Approved vacation after today, in full-time days. */
  plannedVacationDays: number;
  /** Overtime adjustments effective in the month. */
  adjustmentMinutes: number;
  /** Overtime balance carried into the month (end of the previous month). */
  overtimeOpening: number;
  /** Overtime balance at the end of the month (everything up to it, adjustments included). */
  overtimeBalance: number;
  /** Vacation days carried into the month (end of the previous month; in January, last year's rest). */
  vacationOpening: number;
  /** The year's entitlement, credited in January or in the person's first month. */
  vacationCredited: number;
  /** Vacation adjustments effective in the month, in days. */
  vacationAdjustmentDays: number;
  /** Vacation days left at the end of the month, after taken and planned vacation. */
  vacationBalance: number;
  /** Überzeit accrued in the month (attendance beyond the legal weekly maximum, days before today). */
  legalOvertimeMinutes: number;
  /** Überzeit adjustments effective in the month (e.g. a payout, negative). */
  legalOvertimeAdjustments: number;
  /** Überzeit balance at the end of the month; the rest of `overtimeBalance` is regular overtime. */
  legalOvertimeBalance: number;
}

export interface YearBalances {
  year: number;
  /** First day balances count for this person. */
  start: string;
  months: MonthBalance[];
  overtime: {
    opening: number;
    closing: number;
    /** All time up to now: closed months plus adjustments. */
    bookedMinutes: number;
    /** All time up to now: days before today in months not closed yet. */
    pendingMinutes: number;
    pendingSince: string | null;
  };
  vacation: {
    carryOver: number;
    entitlement: number;
    entitlementOverridden: boolean;
    /** What the rules give, also where HR set the entitlement. */
    entitlementCalculated: number;
    /** Calendar days of approved unpaid leave in the year, and the days they cut from the entitlement. */
    unpaidLeaveDays: number;
    unpaidLeaveCut: number;
    /** Null for who may see the balance but not the age behind it, or without rules. */
    basis: VacationBasis | null;
    adjustments: number;
    taken: number;
    planned: number;
    /** carryOver + entitlement + adjustments − taken − planned. */
    remaining: number;
  };
  /** Überzeit, a share of the overtime balance above. */
  legalOvertime: {
    opening: number;
    closing: number;
    /** Accrued in the year (before adjustments), to compare with the yearly limit. */
    accrued: number;
    adjustments: number;
    yearLimitMinutes: number;
    maxWeeklyMinutes: number;
  };
}

export interface BalanceInputs {
  year: number;
  /** The person's local date today. */
  today: string;
  start: string;
  /** Exclusive end of the membership, when it ends. */
  until: string | null;
  settings: Pick<WorkTimeSettings, 'fullTimeWeeklyMinutes' | 'vacationDaysPerYear' | 'legalMaxWeeklyMinutes' | 'legalOvertimeYearLimitMinutes'>;
  /** Covers [min(start, 1 Jan of year), balanceRangeEnd(year, today)). */
  model: WorkTimeModel;
  /** Attended minutes per day of closed sessions, before today (from the Monday of `start`'s week, for Überzeit). */
  attendance: ReadonlyMap<string, number>;
  closed: readonly ClosedMonth[];
  /** Timesheet status per month start. */
  periodStatus: ReadonlyMap<string, string>;
  adjustments: readonly Adjustment[];
  entitlementOverrides: ReadonlyMap<number, number>;
  /** Absence types marked unpaid: a full month of them in a year cuts a twelfth of its entitlement. */
  unpaidTypes?: ReadonlySet<string>;
  /** The vacation rules and what they depend on; without it `settings.vacationDaysPerYear` applies. */
  vacation?: VacationProfile;
  /**
   * The newest year-end closing before `year` (`balance_years`): its balances open the next year and
   * nothing before it is computed again (adjustments effective before then are in it). Null = from `start`.
   */
  opening?: YearClosing | null;
}

/** A year's own closing as `year()` returns it; only the newest closed year can be reopened. */
export interface YearClosingInfo extends YearClosing {
  closedAt: string;
  closedByUserId: string | null;
  incompleteMonths: number;
  reopenable: boolean;
}

/** Where a person's year stands for the year-end closing (`yearStatus`). */
export interface YearStatus {
  year: number;
  notEmployed: boolean;
  /** The year is over in the person's zone. */
  ended: boolean;
  closing: YearClosingInfo | null;
  /** The closing's balances, or the ones the year would close with now. */
  values: { overtime: number; legalOvertime: number; vacation: number };
  /** Months of the year (from the person's start) whose timesheet is not approved. */
  openMonths: string[];
  /** The year before is in employment and not closed: close it first. */
  previousOpen: boolean;
}

/** A person's balances frozen at the end of a year (`balance_years`). */
export interface YearClosing {
  year: number;
  /** Overtime balance at the end of the year (Überzeit included). */
  overtime: number;
  /** The Überzeit share of it. */
  legalOvertime: number;
  /** Vacation days left. */
  vacation: number;
}

/** Exclusive end of what a year's balances need: the end of that year, or of the current month if later. */
export function balanceRangeEnd(year: number, today: string): string {
  const yearEnd = `${year + 1}-01-01`;
  const currentEnd = nextMonth(monthStart(today));
  return currentEnd > yearEnd ? currentEnd : yearEnd;
}

/** Only live months and older snapshots without frozen legal overtime need attendance. */
export function liveAttendanceFrom(from: string, today: string, closed: ReadonlyMap<string, number | null>): string {
  if (from >= today) return today;
  for (let month = monthStart(from); month < today; month = nextMonth(month)) {
    if (closed.get(month) == null) return weekStart(month < from ? from : month);
  }
  return today;
}

async function balanceBatches<T, R>(people: readonly T[], load: (person: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < people.length; i += 4) {
    results.push(...await Promise.all(people.slice(i, i + 4).map(load)));
  }
  return results;
}

type BalanceContext = { settings: WorkTimeSettings; unpaidTypes: ReadonlySet<string> };

const EMPTY_SUMMARY: MonthSummary = { scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0, vacationDays: 0 };

function mergeAbsences(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * A year of balances for one person. Closed months use their frozen numbers; other months are
 * computed from the work-time model: target, attendance and vacation taken for the days before
 * today, planned vacation for the days after. The overtime balance runs from `start` through
 * every month; vacation is entitlement per year minus vacation taken, carried over year to year.
 */
const NO_RUNNING = { overtimeOpening: 0, overtimeBalance: 0, vacationOpening: 0, vacationCredited: 0, vacationAdjustmentDays: 0, vacationBalance: 0, legalOvertimeMinutes: 0, legalOvertimeAdjustments: 0, legalOvertimeBalance: 0 };

export function computeYearBalances(input: BalanceInputs): YearBalances {
  const { year, today, start, model, settings } = input;
  const attendance = recordedAttendance(input.attendance, model.schedules, model.fallback);
  const recordsNone = model.schedules.some((s) => s.timeRecording === 'none');
  const daysOn = input.vacation ? perDay(input.vacation) : settings.vacationDaysPerYear;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  // After a year-end closing, months are computed from the next 1 January on, from its balances.
  const opening = input.opening && input.opening.year < year ? input.opening : null;
  const countedFrom = opening ? `${opening.year + 1}-01-01` : null;
  const from = countedFrom && countedFrom > start ? countedFrom : start;
  const rangeStart = monthStart(from < yearStart ? from : yearStart);
  const allAdjustments = countedFrom ? input.adjustments.filter((a) => a.effectiveDate >= countedFrom) : input.adjustments;
  const rangeEnd = balanceRangeEnd(year, today);
  const closedByMonth = new Map(input.closed.map((c) => [c.month, c]));
  const fullTime = settings.fullTimeWeeklyMinutes;

  // Adjustments dated before the first month computed still count, in that first month.
  const adjustmentIn = (balance: BalanceKind, from: string, to: string) =>
    allAdjustments
      .filter((a) => a.balance === balance && (from === rangeStart ? a.effectiveDate < to : a.effectiveDate >= from && a.effectiveDate < to))
      .reduce((s, a) => s + a.amount, 0);
  const legalMax = settings.legalMaxWeeklyMinutes;
  let legalRunning = opening?.legalOvertime ?? 0;
  let legalOpening = legalRunning;

  let running = opening?.overtime ?? 0;
  let overtimeOpening = running;
  // A closed year's balance counts as booked.
  let booked = running;
  let pending = 0;
  let pendingSince: string | null = null;
  const all: MonthBalance[] = [];

  for (const m of monthsBetween(rangeStart, rangeEnd)) {
    const next = nextMonth(m);
    if (m === yearStart) {
      overtimeOpening = running;
      legalOpening = legalRunning;
    }
    const adjustmentMinutes = adjustmentIn('overtime', m, next);
    const legalAdjustments = adjustmentIn('legal_overtime', m, next);
    let legal = 0;
    const closed = closedByMonth.get(m);
    let row: MonthBalance;
    if (closed) {
      row = { ...closed.summary, month: m, status: 'closed', closedAt: closed.closedAt, monthTarget: closed.summary.target, plannedVacationDays: 0, adjustmentMinutes, ...NO_RUNNING };
      if (m <= today) booked += closed.summary.delta;
      legal = closed.legalOvertime ?? legalOvertimeBetween(attendance, m > start ? m : start, next, legalMax);
    } else if (next <= start) {
      row = { ...EMPTY_SUMMARY, absenceByType: {}, month: m, status: 'before-start', closedAt: null, monthTarget: 0, plannedVacationDays: 0, adjustmentMinutes, ...NO_RUNNING };
    } else {
      const from = m > start ? m : start;
      // Nothing is counted from the end of the employment on (`until`, exclusive).
      const stop = (d: string) => (input.until && d > input.until ? input.until : d);
      const pastEnd = stop(next < today ? next : today);
      const futureFrom = from > today ? from : today;
      const futureEnd = stop(next);
      const past = summarizeDays(from < pastEnd ? dayTargets(from, pastEnd, model) : [], attendance, fullTime);
      const future = summarizeDays(futureFrom < futureEnd ? dayTargets(futureFrom, futureEnd, model) : [], new Map(), fullTime);
      const timesheet = input.periodStatus.get(m);
      const status: MonthStatus =
        timesheet === 'submitted' ? timesheet
        : recordsNone && recordsNoTime(from, stop(next), model) ? 'not-recorded'
        : timesheet === 'rejected' ? timesheet
        : next <= today ? 'open' : m <= today ? 'current' : 'future';
      row = {
        ...past,
        scheduled: past.scheduled + future.scheduled,
        holiday: past.holiday + future.holiday,
        absenceByType: mergeAbsences(past.absenceByType, future.absenceByType),
        month: m,
        status,
        closedAt: null,
        monthTarget: past.target + future.target,
        plannedVacationDays: future.vacationDays,
        adjustmentMinutes,
        ...NO_RUNNING,
      };
      if (from < pastEnd) {
        legal = legalOvertimeBetween(attendance, from, pastEnd, legalMax);
        pending += past.delta;
        pendingSince ??= from;
      }
    }
    booked += adjustmentMinutes + legalAdjustments;
    row.overtimeOpening = running;
    running += row.delta + adjustmentMinutes + legalAdjustments;
    row.overtimeBalance = running;
    legalRunning += legal + legalAdjustments;
    row.legalOvertimeMinutes = legal;
    row.legalOvertimeAdjustments = legalAdjustments;
    row.legalOvertimeBalance = legalRunning;
    all.push(row);
  }
  const months = all.filter((r) => r.month >= yearStart && r.month < yearEnd);
  const closing = months.length ? months[months.length - 1].overtimeBalance : overtimeOpening;
  const legalOvertime = {
    opening: legalOpening,
    closing: months.length ? months[months.length - 1].legalOvertimeBalance : legalOpening,
    accrued: months.reduce((s, r) => s + r.legalOvertimeMinutes, 0),
    adjustments: months.reduce((s, r) => s + r.legalOvertimeAdjustments, 0),
    yearLimitMinutes: settings.legalOvertimeYearLimitMinutes,
    maxWeeklyMinutes: legalMax,
  };

  // Vacation, per year from the start year up to the one asked for.
  const vacationAdjustments = allAdjustments.filter((a) => a.balance === 'vacation');
  const startYear = Number(start.slice(0, 4));
  const firstYear = opening ? opening.year + 1 : Math.min(startYear, year);
  let carryOver = opening?.vacation ?? 0;
  let current = { entitlement: 0, calculated: 0, overridden: false, adjustments: 0, taken: 0, planned: 0, unpaidDays: 0, unpaidCut: 0 };
  const unpaidSpans = input.unpaidTypes?.size ? model.absences.filter((a) => a.type !== undefined && input.unpaidTypes!.has(a.type)) : [];
  for (let y = firstYear; y <= year; y++) {
    const ys = `${y}-01-01`;
    const ye = `${y + 1}-01-01`;
    const override = input.entitlementOverrides.get(y);
    // An override replaces the calculated days; the year asked for still says what they would be.
    const prorated =
      y < startYear || (override !== undefined && y < year) ? 0 : vacationEntitlement(y, daysOn, model.schedules, model.fallback, start, input.until);
    const unpaidDays = unpaidSpans.length ? unpaidLeaveDays(y, unpaidSpans) : 0;
    const unpaidCut = unpaidLeaveCut(prorated, unpaidDays);
    const calculated = roundDays(prorated - unpaidCut);
    const entitlement = y < startYear ? 0 : override ?? calculated;
    const adjustments = vacationAdjustments
      .filter((a) => (y === firstYear ? a.effectiveDate < ye : a.effectiveDate >= ys && a.effectiveDate < ye))
      .reduce((s, a) => s + a.amount, 0);
    const inYear = all.filter((r) => r.month >= ys && r.month < ye);
    const taken = inYear.reduce((s, r) => s + r.vacationDays, 0);
    const planned = inYear.reduce((s, r) => s + r.plannedVacationDays, 0);
    // Month by month: the entitlement is credited in the year's first counted month, adjustments
    // in the month they take effect (earlier ones in the first month computed).
    const creditMonth = monthStart(start > ys ? start : ys);
    let left = carryOver;
    for (const r of inYear) {
      const next = nextMonth(r.month);
      r.vacationOpening = roundDays(left);
      r.vacationCredited = r.month === creditMonth ? roundDays(entitlement) : 0;
      r.vacationAdjustmentDays = roundDays(
        vacationAdjustments
          .filter((a) => (r.month === rangeStart ? a.effectiveDate < next : a.effectiveDate >= r.month && a.effectiveDate < next))
          .reduce((s, a) => s + a.amount, 0),
      );
      left += r.vacationCredited + r.vacationAdjustmentDays - r.vacationDays - r.plannedVacationDays;
      r.vacationBalance = roundDays(left);
    }
    if (y < year) carryOver += entitlement + adjustments - taken - planned;
    else current = { entitlement, calculated, overridden: override !== undefined, adjustments, taken, planned, unpaidDays, unpaidCut };
  }
  carryOver = roundDays(carryOver);

  return {
    year,
    start,
    months,
    overtime: { opening: overtimeOpening, closing, bookedMinutes: booked, pendingMinutes: pending, pendingSince },
    vacation: {
      carryOver,
      entitlement: roundDays(current.entitlement),
      entitlementOverridden: current.overridden,
      entitlementCalculated: roundDays(current.calculated),
      unpaidLeaveDays: current.unpaidDays,
      unpaidLeaveCut: current.unpaidCut,
      basis: input.vacation ? vacationBasis(input.vacation, input) : null,
      adjustments: roundDays(current.adjustments),
      taken: roundDays(current.taken),
      planned: roundDays(current.planned),
      remaining: roundDays(carryOver + current.entitlement + current.adjustments - current.taken - current.planned),
    },
    legalOvertime,
  };
}

/** Days per date of a profile, each date worked out once. */
function perDay(profile: VacationProfile): (date: string) => number {
  const known = new Map<string, number>();
  return (date) => {
    let days = known.get(date);
    if (days === undefined) known.set(date, (days = vacationDaysOn(date, profile.rules, profile).days));
    return days;
  };
}

/** Whether no day of [from, toExclusive) records working time; after the employment, as on its last day. */
function recordsNoTime(from: string, toExclusive: string, model: WorkTimeModel): boolean {
  const none = (date: string) => scheduleOn(date, model.schedules, model.fallback).timeRecording === 'none';
  if (from >= toExclusive) return none(addDays(toExclusive, -1));
  return none(from) && model.schedules.every((s) => s.validFrom <= from || s.validFrom >= toExclusive || s.timeRecording === 'none');
}

/** How a year's entitlement comes about, as of today within the year and the employment. */
export interface VacationBasis extends VacationDays {
  date: string;
  workloadPercent: number;
  /** Age rules exist and the birth date is missing: they can't be applied. */
  birthDateMissing: boolean;
}

function vacationBasis(profile: VacationProfile, input: Pick<BalanceInputs, 'year' | 'today' | 'start' | 'until' | 'model'>): VacationBasis {
  const { year, today, start, until, model } = input;
  let date = today < `${year}-01-01` ? `${year}-01-01` : today > `${year}-12-31` ? `${year}-12-31` : today;
  if (date < start) date = start;
  if (until && date >= until) date = addDays(until, -1);
  return {
    ...vacationDaysOn(date, profile.rules, profile),
    date,
    workloadPercent: scheduleOn(date, model.schedules, model.fallback).workloadPercent,
    birthDateMissing: !profile.birthDate && profile.rules.some((r) => r.ageSteps.length > 0),
  };
}

export type ReportAlert =
  | 'overtime-high'
  | 'overtime-low'
  | 'not-submitted'
  | 'awaiting-approval'
  | 'rejected'
  | 'vacation-negative'
  | 'legal-overtime'
  | 'legal-overtime-limit';

/** Alerts for one person's month in the balance report. */
/**
 * Alerts for one person's month in the balance report. `legalYearToDate` is the Überzeit accrued
 * in the year up to the end of that month, checked against the yearly legal limit.
 */
export function reportAlerts(
  month: MonthBalance,
  vacationRemaining: number,
  today: string,
  settings: Pick<WorkTimeSettings, 'overtimeAlertMinutes' | 'undertimeAlertMinutes' | 'legalOvertimeYearLimitMinutes'>,
  legalYearToDate = 0,
): ReportAlert[] {
  const alerts: ReportAlert[] = [];
  if (month.overtimeBalance > settings.overtimeAlertMinutes) alerts.push('overtime-high');
  if (month.overtimeBalance < -settings.undertimeAlertMinutes) alerts.push('overtime-low');
  const ended = nextMonth(month.month) <= today;
  if (month.status === 'submitted') alerts.push('awaiting-approval');
  else if (month.status === 'rejected') alerts.push('rejected');
  else if (ended && month.status === 'open') alerts.push('not-submitted');
  if (vacationRemaining < 0) alerts.push('vacation-negative');
  if (legalYearToDate > settings.legalOvertimeYearLimitMinutes) alerts.push('legal-overtime-limit');
  else if (month.legalOvertimeMinutes > 0) alerts.push('legal-overtime');
  return alerts;
}

/** Turns a `work_time_months` row back into a summary. */
function closedFromRow(r: typeof work_time_months.$inferSelect): ClosedMonth {
  return {
    month: r.month,
    closedAt: r.closed_at,
    summary: {
      scheduled: r.scheduled_minutes,
      holiday: r.holiday_minutes,
      absenceByType: (r.absence_minutes ?? {}) as Record<string, number>,
      target: r.target_minutes,
      actual: r.actual_minutes,
      delta: r.delta_minutes,
      vacationDays: Number(r.vacation_days),
    },
    legalOvertime: r.legal_overtime_minutes,
  };
}

/**
 * Overtime and vacation balances. A month is closed when its working-time timesheet is approved
 * (`work_time_months` freezes its numbers) and reopened when the timesheet is; open months are
 * computed live from the work-time model. Adjustments (opening balance, correction, payout) and
 * per-year vacation entitlements are the only stored inputs besides that. Callers authorize.
 */
@Injectable()
export class BalancesService {
  constructor(
    private readonly workTime: WorkTimeModelService,
    private readonly versions: VersionsService,
  ) {}

  /** Freezes a month from its approved timesheet (replacing an earlier closing of the same month). */
  async closeMonth(db: Db, periodId: string, actorUserId: string | null): Promise<void> {
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, user_id: timesheet_periods.user_id, period_start: timesheet_periods.period_start, period_end: timesheet_periods.period_end })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, periodId));
    if (!period) return;
    const { organization_id: orgId, user_id: userId, period_start: from, period_end: to } = period;
    const [settings, timeZone] = await Promise.all([this.workTime.settings(db, orgId), this.workTime.timeZone(db, userId)]);
    const [targets, allAttended, schedules] = await Promise.all([
      this.workTime.targets(db, orgId, userId, from, to),
      // From the week's Monday: Überzeit counts the whole calendar week.
      this.workTime.attendanceByDay(db, orgId, userId, weekStart(from), to, timeZone, false),
      this.workTime.schedules(db, orgId, userId),
    ]);
    const attended = recordedAttendance(allAttended, schedules, defaultSchedule(settings.fullTimeWeeklyMinutes));
    const s = summarizeDays(targets, attended, settings.fullTimeWeeklyMinutes);
    const legal = legalOvertimeBetween(attended, from, to, settings.legalMaxWeeklyMinutes);
    const values = {
      organization_id: orgId,
      user_id: userId,
      month: monthStart(from),
      timesheet_period_id: periodId,
      scheduled_minutes: s.scheduled,
      holiday_minutes: s.holiday,
      absence_minutes: s.absenceByType,
      target_minutes: s.target,
      actual_minutes: s.actual,
      delta_minutes: s.delta,
      vacation_days: String(s.vacationDays),
      legal_overtime_minutes: legal,
      closed_by_user_id: actorUserId,
      closed_at: new Date().toISOString(),
    };
    const [row] = await db
      .insert(work_time_months)
      .values(values)
      .onConflictDoUpdate({ target: [work_time_months.organization_id, work_time_months.user_id, work_time_months.month], set: values })
      .returning({ id: work_time_months.id });
    void this.versions.record('work_time_months', row.id, 'update', actorUserId, values).catch(() => {});
  }

  /** Undoes a closing when its timesheet is reopened: the month is computed live again. */
  async reopenMonth(db: Db, periodId: string, actorUserId: string | null): Promise<void> {
    const removed = await db.delete(work_time_months).where(eq(work_time_months.timesheet_period_id, periodId)).returning({ id: work_time_months.id });
    for (const r of removed) void this.versions.record('work_time_months', r.id, 'delete', actorUserId, { timesheet_period_id: periodId }).catch(() => {});
  }

  /** Closes approved timesheets that have no closed month yet (approved before closings existed, or seeded). */
  private async closeMissing(db: Db, orgId: string, userId: string): Promise<void> {
    const missing = await db.execute(sql`
      SELECT p.id, p.reviewed_by_user_id FROM timesheet_periods p
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM work_time_months m WHERE m.organization_id = p.organization_id AND m.user_id = p.user_id AND m.month = p.period_start)`);
    for (const r of missing.rows as { id: string; reviewed_by_user_id: string | null }[]) await this.closeMonth(db, r.id, r.reviewed_by_user_id);
  }

  /**
   * First day balances count: the organization's start date if set, else the person's first
   * recorded activity (attendance, approved absence or closed month), else today; never before
   * they joined.
   */
  async startDate(db: Db, orgId: string, userId: string, settings: WorkTimeSettings, timeZone: string, today: string): Promise<{ start: string; until: string | null }> {
    const [membership] = await db
      .select({ start_date: organization_memberships.start_date, joined_at: organization_memberships.joined_at, exit_at: organization_memberships.exit_at })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    // The employment start date, else the day the account joined the organization.
    const joined = membership?.start_date ?? (membership?.joined_at ? localDate(membership.joined_at, timeZone) : null);
    const until = membership?.exit_at ? localDate(membership.exit_at, timeZone) : null;
    let start = settings.balancesStartDate;
    if (!start) {
      const result = await db.execute(sql`
        SELECT to_char(LEAST(
          ((SELECT MIN(check_in) FROM work_times WHERE organization_id = ${orgId} AND user_id = ${userId}) AT TIME ZONE ${timeZone})::date,
          (SELECT MIN(date_start) FROM absences WHERE organization_id = ${orgId} AND user_id = ${userId} AND status = 'approved'),
          (SELECT MIN(month) FROM work_time_months WHERE organization_id = ${orgId} AND user_id = ${userId})
        ), 'YYYY-MM-DD') AS first_day`);
      start = (result.rows[0] as { first_day: string | null } | undefined)?.first_day ?? today;
    }
    if (joined && joined > start) start = joined;
    return { start, until };
  }

  async adjustments(db: Db, orgId: string, userId: string): Promise<Adjustment[]> {
    const rows = await db
      .select()
      .from(balance_adjustments)
      .where(and(eq(balance_adjustments.organization_id, orgId), eq(balance_adjustments.user_id, userId)))
      .orderBy(asc(balance_adjustments.effective_date));
    return rows.map((r) => ({ id: r.id, balance: r.balance as BalanceKind, kind: r.kind as AdjustmentKind, effectiveDate: r.effective_date, amount: Number(r.amount), note: r.note }));
  }

  async entitlementOverrides(db: Db, orgId: string, userId: string): Promise<Map<number, number>> {
    const rows = await db
      .select({ year: vacation_entitlements.year, days: vacation_entitlements.days })
      .from(vacation_entitlements)
      .where(and(eq(vacation_entitlements.organization_id, orgId), eq(vacation_entitlements.user_id, userId)));
    return new Map(rows.map((r) => [r.year, Number(r.days)]));
  }

  /** A person's year-end closings, oldest first. */
  async closings(db: Db, orgId: string, userId: string): Promise<Array<YearClosing & { closedAt: string; closedByUserId: string | null; incompleteMonths: number }>> {
    const rows = await db
      .select()
      .from(balance_years)
      .where(and(eq(balance_years.organization_id, orgId), eq(balance_years.user_id, userId)))
      .orderBy(asc(balance_years.year));
    return rows.map((r) => ({
      year: r.year,
      overtime: r.overtime_minutes,
      legalOvertime: r.legal_overtime_minutes,
      vacation: Number(r.vacation_days),
      closedAt: r.closed_at,
      closedByUserId: r.closed_by_user_id,
      incompleteMonths: r.incomplete_months,
    }));
  }

  /**
   * One person's balances for a year, with the adjustments behind them. Computed from the newest
   * year-end closing before it (`balance_years`), else from the person's first day; `closing` is the
   * year's own closing when it has one.
   */
  async year(db: Db, orgId: string, userId: string, year: number, now: Date = new Date()): Promise<YearBalances & { adjustments: Adjustment[]; closing: YearClosingInfo | null }> {
    const { balances } = await this.calculateYear(db, orgId, userId, year, now, await this.balanceContext(db, orgId));
    return balances;
  }

  private async balanceContext(db: Db, orgId: string): Promise<BalanceContext> {
    const [settings, types] = await Promise.all([this.workTime.settings(db, orgId), resolveAbsenceTypes(db, orgId)]);
    return { settings, unpaidTypes: unpaidAbsenceTypes(types) };
  }

  private async calculateYear(db: Db, orgId: string, userId: string, year: number, now: Date, { settings, unpaidTypes }: BalanceContext, knownTimeZone?: string) {
    await this.closeMissing(db, orgId, userId);
    const [timeZone, closings, closedRows] = await Promise.all([
      knownTimeZone ?? this.workTime.timeZone(db, userId),
      this.closings(db, orgId, userId),
      db.select().from(work_time_months).where(and(eq(work_time_months.organization_id, orgId), eq(work_time_months.user_id, userId))),
    ]);
    const today = localDate(now, timeZone);
    const { start, until } = await this.startDate(db, orgId, userId, settings, timeZone, today);
    const opening = closings.filter((c) => c.year < year).at(-1) ?? null;
    const countedFrom = opening ? `${opening.year + 1}-01-01` : null;
    const from = countedFrom && countedFrom > start ? countedFrom : start;
    const yearStart = `${year}-01-01`;
    const modelFrom = from < yearStart ? from : yearStart;
    const attendanceFrom = liveAttendanceFrom(from, today, new Map(closedRows.map(r => [r.month, r.legal_overtime_minutes])));
    const [model, attendance, periods, adjustments, overrides, vacation] = await Promise.all([
      this.workTime.model(db, orgId, userId, modelFrom, balanceRangeEnd(year, today), settings),
      attendanceFrom < today ? this.workTime.attendanceByDay(db, orgId, userId, attendanceFrom, today, timeZone, false) : new Map<string, number>(),
      db
        .select({ period_start: timesheet_periods.period_start, status: timesheet_periods.status })
        .from(timesheet_periods)
        .where(and(eq(timesheet_periods.organization_id, orgId), eq(timesheet_periods.user_id, userId))),
      this.adjustments(db, orgId, userId),
      this.entitlementOverrides(db, orgId, userId),
      vacationProfile(db, orgId, userId),
    ]);
    const balances = computeYearBalances({
      year,
      today,
      start,
      until,
      settings,
      model,
      attendance,
      closed: closedRows.map(closedFromRow),
      periodStatus: new Map(periods.map((p) => [monthStart(p.period_start), p.status])),
      adjustments,
      entitlementOverrides: overrides,
      unpaidTypes,
      vacation,
      opening,
    });
    const own = closings.find((c) => c.year === year);
    return { today, closings, balances: {
      ...balances,
      adjustments: adjustments.filter((a) => a.effectiveDate >= `${year}-01-01` && a.effectiveDate < `${year + 1}-01-01`),
      closing: own ? { ...own, reopenable: !closings.some((c) => c.year > year) } : null,
    } };
  }

  /**
   * Where a person's year stands for closing it: closed (with its balances), or open with the balances
   * it would close with, the months whose timesheet is not approved yet, and whether the year before
   * is still open (years close in order). `notEmployed` when the year lies before their start.
   */
  async yearStatus(db: Db, orgId: string, userId: string, year: number, now: Date = new Date()): Promise<YearStatus> {
    return this.calculateYearStatus(db, orgId, userId, year, now, await this.balanceContext(db, orgId));
  }

  async yearStatuses(db: Db, orgId: string, people: readonly { id: string; timezone: string | null }[], year: number, now = new Date()): Promise<YearStatus[]> {
    if (!people.length) return [];
    const context = await this.balanceContext(db, orgId);
    return balanceBatches(people, p => this.calculateYearStatus(db, orgId, p.id, year, now, context, p.timezone || 'UTC'));
  }

  private async calculateYearStatus(db: Db, orgId: string, userId: string, year: number, now: Date, context: BalanceContext, timeZone?: string): Promise<YearStatus> {
    const { balances: b, today, closings } = await this.calculateYear(db, orgId, userId, year, now, context, timeZone);
    const yearStart = `${year}-01-01`;
    const startYear = Number(b.start.slice(0, 4));
    const values = { overtime: b.overtime.closing, legalOvertime: b.legalOvertime.closing, vacation: b.vacation.remaining };
    const openMonths = b.months.filter((m) => m.month >= yearStart && m.status !== 'closed' && m.status !== 'before-start' && m.status !== 'not-recorded').map((m) => m.month);
    const previousOpen = year - 1 >= startYear && !closings.some((c) => c.year === year - 1);
    return {
      year,
      notEmployed: startYear > year,
      ended: `${year + 1}-01-01` <= today,
      closing: b.closing,
      values: b.closing ? { overtime: b.closing.overtime, legalOvertime: b.closing.legalOvertime, vacation: b.closing.vacation } : values,
      openMonths,
      previousOpen,
    };
  }

  /**
   * Closes a person's year: its balances at the end are frozen in `balance_years` and the year is locked.
   * Refused for a year not ended yet, before the person's start, already closed, after an open year, or
   * (unless `force`) with months whose timesheet is not approved.
   */
  async closeYear(db: Db, orgId: string, userId: string, year: number, actorUserId: string, force: boolean, now: Date = new Date()): Promise<{ ok: true; id: string; values: { overtime: number; legalOvertime: number; vacation: number } } | { ok: false; error: string; months?: string[] }> {
    const status = await this.yearStatus(db, orgId, userId, year, now);
    if (status.closing) return { ok: false, error: 'year-closed' };
    if (status.notEmployed) return { ok: false, error: 'not-employed' };
    if (!status.ended) return { ok: false, error: 'year-not-ended' };
    if (status.previousOpen) return { ok: false, error: 'previous-year-open' };
    if (status.openMonths.length > 0 && !force) return { ok: false, error: 'months-open', months: status.openMonths };
    const values = {
      organization_id: orgId,
      user_id: userId,
      year,
      overtime_minutes: Math.round(status.values.overtime),
      legal_overtime_minutes: Math.round(status.values.legalOvertime),
      vacation_days: String(roundDays(status.values.vacation)),
      incomplete_months: status.openMonths.length,
      closed_by_user_id: actorUserId,
      closed_at: now.toISOString(),
    };
    const [row] = await db.insert(balance_years).values(values).onConflictDoNothing().returning({ id: balance_years.id });
    if (!row) return { ok: false, error: 'year-closed' };
    void this.versions.record('balance_years', row.id, 'insert', actorUserId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id, values: { overtime: values.overtime_minutes, legalOvertime: values.legal_overtime_minutes, vacation: Number(values.vacation_days) } };
  }

  /** Reopens a person's newest closed year: it is computed live and can be changed again. */
  async reopenYear(db: Db, orgId: string, userId: string, year: number, actorUserId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const [later] = await db
      .select({ id: balance_years.id })
      .from(balance_years)
      .where(and(eq(balance_years.organization_id, orgId), eq(balance_years.user_id, userId), gt(balance_years.year, year)))
      .limit(1);
    if (later) return { ok: false, error: 'later-year-closed' };
    const removed = await db
      .delete(balance_years)
      .where(and(eq(balance_years.organization_id, orgId), eq(balance_years.user_id, userId), eq(balance_years.year, year)))
      .returning({ id: balance_years.id });
    if (removed.length === 0) return { ok: false, error: 'year-not-closed' };
    for (const r of removed) void this.versions.record('balance_years', r.id, 'delete', actorUserId, { year }).catch(() => {});
    return { ok: true, id: removed[0].id };
  }

  /** The balance report for a month: every person the caller may list, with alerts. */
  async report(db: Db, orgId: string, userIds: 'all' | string[], month: string, now: Date = new Date()) {
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.is_active, true)];
    if (userIds !== 'all') {
      if (userIds.length === 0) return [];
      conditions.push(inArray(organization_memberships.user_id, userIds));
    }
    const people = await db
      .select({ user_id: users.id, display_name: users.display_name, email: users.email, timezone: users.timezone })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    if (!people.length) return [];
    const context = await this.balanceContext(db, orgId);
    const year = Number(month.slice(0, 4));
    const rows = await balanceBatches(people, async (p) => {
      const { balances, today } = await this.calculateYear(db, orgId, p.user_id, year, now, context, p.timezone || 'UTC');
      const row = balances.months.find((m) => m.month === month);
      if (!row) return null;
      const legalYearToDate = balances.months.filter((m) => m.month <= month).reduce((s, m) => s + m.legalOvertimeMinutes, 0);
      return {
        userId: p.user_id,
        displayName: p.display_name,
        email: p.email,
        month: row,
        vacationRemaining: balances.vacation.remaining,
        legalYearToDate,
        legalYearLimit: context.settings.legalOvertimeYearLimitMinutes,
        alerts: row.status === 'before-start' ? [] : reportAlerts(row, balances.vacation.remaining, today, context.settings, legalYearToDate),
      };
    });
    return rows.filter(row => row !== null);
  }

  async addAdjustment(
    db: Db,
    params: { organizationId: string; userId: string; balance: BalanceKind; kind: AdjustmentKind; effectiveDate: string; amount: number; note: string | null; actorUserId: string },
  ): Promise<string> {
    const values = {
      organization_id: params.organizationId,
      user_id: params.userId,
      balance: params.balance,
      kind: params.kind,
      effective_date: params.effectiveDate,
      amount: String(params.amount),
      note: params.note,
      created_by_user_id: params.actorUserId,
    };
    const [row] = await db.insert(balance_adjustments).values(values).returning({ id: balance_adjustments.id });
    void this.versions.record('balance_adjustments', row.id, 'insert', params.actorUserId, { id: row.id, ...values }).catch(() => {});
    return row.id;
  }

  async findAdjustment(db: Db, id: string) {
    const [row] = await db
      .select({ id: balance_adjustments.id, organization_id: balance_adjustments.organization_id, user_id: balance_adjustments.user_id, effective_date: balance_adjustments.effective_date })
      .from(balance_adjustments)
      .where(eq(balance_adjustments.id, id));
    return row ?? null;
  }

  async deleteAdjustment(db: Db, id: string, actorUserId: string): Promise<void> {
    await db.delete(balance_adjustments).where(eq(balance_adjustments.id, id));
    void this.versions.record('balance_adjustments', id, 'delete', actorUserId, { id }).catch(() => {});
  }

  /** Sets a person's vacation days for a year, or (days = null) goes back to the organization's default. */
  async setEntitlement(db: Db, orgId: string, userId: string, year: number, days: number | null, note: string | null, actorUserId: string): Promise<void> {
    const where = and(eq(vacation_entitlements.organization_id, orgId), eq(vacation_entitlements.user_id, userId), eq(vacation_entitlements.year, year));
    if (days === null) {
      const removed = await db.delete(vacation_entitlements).where(where).returning({ id: vacation_entitlements.id });
      for (const r of removed) void this.versions.record('vacation_entitlements', r.id, 'delete', actorUserId, { year }).catch(() => {});
      return;
    }
    const values = { organization_id: orgId, user_id: userId, year, days: String(days), note };
    const [row] = await db
      .insert(vacation_entitlements)
      .values(values)
      .onConflictDoUpdate({ target: [vacation_entitlements.organization_id, vacation_entitlements.user_id, vacation_entitlements.year], set: { days: values.days, note } })
      .returning({ id: vacation_entitlements.id });
    void this.versions.record('vacation_entitlements', row.id, 'update', actorUserId, values).catch(() => {});
  }
}

