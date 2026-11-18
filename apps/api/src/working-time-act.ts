/**
 * Checks of recorded attendance against the Swiss Working Hours Act (ArG), for the "Working Hours
 * Act" report (packages/shared/src/reports.ts, id `workingTimeAct`). Pure: sessions in, findings
 * out, so it is tested without a database. Rules as SECO summarises them ("Arbeits- und
 * Ruhezeiten – das Wichtigste in Kürze", 710.224.d, 2016):
 *
 * - daily rest of at least 11 hours between two working days (`dailyRest`; once a week 8 hours are
 *   allowed if 11 hours are kept on average over two weeks, so every shorter rest is listed for a
 *   person to judge, not called a breach);
 * - breaks of at least 15 / 30 / 60 minutes for more than 5½ / 7 / 9 hours of work (`breaks`);
 * - day and evening work within 14 hours, breaks included (`span`);
 * - the weekly maximum (45 or 50 hours, the organization's `legalMaxWeeklyMinutes`): every week
 *   above it is Überzeit (`weeklyMaximum`);
 * - Überzeit per calendar year at most 170 or 140 hours (`legalOvertimeYearLimitMinutes`):
 *   `yearlyOvertime` once the year's total goes beyond it;
 * - night work (23:00 to 06:00) and Sunday work need a permit unless ArGV 2 exempts the business:
 *   listed as `night` and `sunday` for a person to check against the permits.
 *
 * A working day is the sessions that start on that local date (a night shift belongs to the day it
 * starts); breaks are the gaps between them. Only closed sessions count. The checks see what was
 * recorded: a break taken without checking out is not visible.
 */

import { addDays, legalOvertimeByDay, weekdayIndex, weekStart } from '@worktime3/shared/worktime';
import { zonedDate, zonedTime } from './report-schedule';
import { minutesByLocalDay, type TimeSpan } from './work-time-model.service';

export type ActCheck = 'dailyRest' | 'breaks' | 'span' | 'weeklyMaximum' | 'yearlyOvertime' | 'night' | 'sunday';
export const ACT_CHECKS: readonly ActCheck[] = ['dailyRest', 'breaks', 'span', 'weeklyMaximum', 'yearlyOvertime', 'night', 'sunday'];

export const MIN_DAILY_REST_MINUTES = 11 * 60;
export const MAX_DAY_SPAN_MINUTES = 14 * 60;
/** Required break for more than `over` minutes of work. */
export const BREAK_RULES: readonly { over: number; minutes: number }[] = [
  { over: 9 * 60, minutes: 60 },
  { over: 7 * 60, minutes: 30 },
  { over: 5.5 * 60, minutes: 15 },
];
/** Gaps shorter than this are not breaks (switching tasks, a forgotten click). */
export const MIN_BREAK_PART_MINUTES = 15;
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 6;

export interface ActFinding {
  check: ActCheck;
  /** The local day concerned ('YYYY-MM-DD'): the working day, the week's Monday, the day a limit was passed. */
  date: string;
  /**
   * The minutes concerned: short by (rest, breaks), beyond the limit (span, week, year), worked
   * (night, Sunday).
   */
  minutes: number;
}

export interface ActOptions {
  timeZone: string;
  /** Days reported: [from, toExclusive). Sessions from before `from` are used as context. */
  from: string;
  toExclusive: string;
  maxWeeklyMinutes: number;
  yearLimitMinutes: number;
}

/** The minimum break for `workedMinutes` of work in a day. */
export function requiredBreakMinutes(workedMinutes: number): number {
  return BREAK_RULES.find((r) => workedMinutes > r.over)?.minutes ?? 0;
}

const ms = (d: Date | string) => new Date(d).getTime();

/**
 * Findings for one person's sessions. Pass the sessions from the Monday of the year's first week
 * (for the yearly Überzeit) or at least from the day before `from` (for the daily rest) up to
 * `toExclusive`.
 */
export function checkWorkingTimeAct(sessions: readonly TimeSpan[], o: ActOptions): ActFinding[] {
  const out: ActFinding[] = [];
  const inRange = (d: string) => d >= o.from && d < o.toExclusive;
  const closed = sessions
    .map((s) => ({ start: ms(s.start), end: ms(s.end) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  // Working days: sessions by the local date they start on.
  const days = new Map<string, { start: number; end: number }[]>();
  for (const s of closed) {
    const d = zonedDate(new Date(s.start), o.timeZone);
    const list = days.get(d) ?? [];
    list.push(s);
    days.set(d, list);
  }
  const ordered = [...days.keys()].sort();

  ordered.forEach((day, i) => {
    const list = days.get(day)!;
    const first = list[0].start;
    const last = Math.max(...list.map((s) => s.end));
    if (i > 0 && inRange(day)) {
      const previousEnd = Math.max(...days.get(ordered[i - 1])!.map((s) => s.end));
      const rest = (first - previousEnd) / 60000;
      if (rest >= 0 && rest < MIN_DAILY_REST_MINUTES) out.push({ check: 'dailyRest', date: day, minutes: Math.round(MIN_DAILY_REST_MINUTES - rest) });
    }
    if (!inRange(day)) return;
    const worked = list.reduce((sum, s) => sum + (s.end - s.start) / 60000, 0);
    let breaks = 0;
    let reach = list[0].end;
    for (const s of list.slice(1)) {
      const gap = (s.start - reach) / 60000;
      if (gap >= MIN_BREAK_PART_MINUTES) breaks += gap;
      reach = Math.max(reach, s.end);
    }
    const required = requiredBreakMinutes(worked);
    if (breaks < required) out.push({ check: 'breaks', date: day, minutes: Math.round(required - breaks) });
    const span = (last - first) / 60000;
    if (span > MAX_DAY_SPAN_MINUTES) out.push({ check: 'span', date: day, minutes: Math.round(span - MAX_DAY_SPAN_MINUTES) });
  });

  // Attendance per local day, split at midnight, for the weeks, the year, night and Sunday work.
  const earliest = closed.length ? zonedDate(new Date(closed[0].start), o.timeZone) : o.from;
  const attendance = minutesByLocalDay(
    closed.map((s) => ({ start: new Date(s.start), end: new Date(s.end) })),
    earliest < o.from ? earliest : o.from,
    o.toExclusive,
    o.timeZone,
  );

  // Weekly maximum: one finding per week (on its Monday) with the minutes above it.
  const overtimeByDay = legalOvertimeByDay(attendance, weekStart(o.from), o.toExclusive, o.maxWeeklyMinutes);
  const perWeek = new Map<string, number>();
  for (const [d, m] of overtimeByDay) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) ?? 0) + m);
  for (const [monday, m] of [...perWeek].sort()) {
    if (m > 0 && (inRange(monday) || (monday < o.from && addDays(monday, 7) > o.from))) {
      out.push({ check: 'weeklyMaximum', date: inRange(monday) ? monday : o.from, minutes: Math.round(m) });
    }
  }

  // Yearly Überzeit: the day each calendar year's total goes beyond the limit, with the minutes
  // above it by the end of the period (or of that year).
  const years = new Set<string>();
  for (let d = o.from; d < o.toExclusive; d = addDays(d, 1)) years.add(d.slice(0, 4));
  for (const year of years) {
    const yearFrom = `${year}-01-01`;
    const yearTo = `${Number(year) + 1}-01-01` < o.toExclusive ? `${Number(year) + 1}-01-01` : o.toExclusive;
    const byDay = legalOvertimeByDay(attendance, yearFrom, yearTo, o.maxWeeklyMinutes);
    let total = 0;
    let passedOn: string | null = null;
    for (const d of [...byDay.keys()].sort()) {
      total += byDay.get(d) ?? 0;
      if (passedOn === null && total > o.yearLimitMinutes) passedOn = d;
    }
    if (passedOn !== null && passedOn < o.toExclusive) {
      out.push({ check: 'yearlyOvertime', date: passedOn < o.from ? o.from : passedOn, minutes: Math.round(total - o.yearLimitMinutes) });
    }
  }

  // Night work: the minutes between 23:00 and 06:00, per local day they fall on.
  const night = new Map<string, number>();
  for (const s of closed) {
    let day = zonedDate(new Date(s.start), o.timeZone);
    while (true) {
      const dayStart = zonedTime(day, 0, o.timeZone).getTime();
      if (dayStart >= s.end) break;
      for (const [a, b] of [
        [dayStart, zonedTime(day, NIGHT_END_HOUR, o.timeZone).getTime()],
        [zonedTime(day, NIGHT_START_HOUR, o.timeZone).getTime(), zonedTime(addDays(day, 1), 0, o.timeZone).getTime()],
      ]) {
        const overlap = Math.min(b, s.end) - Math.max(a, s.start);
        if (overlap > 0) night.set(day, (night.get(day) ?? 0) + overlap / 60000);
      }
      day = addDays(day, 1);
    }
  }
  for (const [day, m] of [...night].sort()) if (inRange(day) && m >= 1) out.push({ check: 'night', date: day, minutes: Math.round(m) });

  // Sunday work: the minutes worked on a Sunday (local calendar day).
  for (const [day, m] of [...attendance].sort()) {
    if (inRange(day) && weekdayIndex(day) === 6 && m > 0) out.push({ check: 'sunday', date: day, minutes: m });
  }

  return out.sort((a, b) => (a.date === b.date ? ACT_CHECKS.indexOf(a.check) - ACT_CHECKS.indexOf(b.check) : a.date < b.date ? -1 : 1));
}
