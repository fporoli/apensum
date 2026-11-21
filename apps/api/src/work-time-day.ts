/**
 * What the working-time dialog shows under a session while it is edited (work-time.controller.ts,
 * `work-time/day`): the day's other sessions, which of them the draft overlaps, and the Working Hours
 * Act hints for that day with the draft in place of the stored session. Pure, tested without a database.
 * Overlaps refuse a save; the Act findings are hints only (permits and exceptions are not the app's to judge).
 */

import { addDays, weekStart } from '@worktime3/shared/worktime';
import { checkWorkingTimeAct, type ActFinding } from './working-time-act';
import { zonedDate, zonedTime } from './report-schedule';

/** A finding on the edited day; `after` marks a too short rest before the next day's work. */
export type DayFinding = ActFinding & { after?: boolean };

export interface StoredSession {
  id: string;
  check_in: string;
  /** Null while it runs: an open session counts as running until it is closed. */
  check_out: string | null;
}

/**
 * Sessions overlap only when they share at least this long: check-in and check-out keep their seconds,
 * while entries are typed to the minute, so a session shown as "until 02:02" may end at 02:02:18.
 */
export const MIN_OVERLAP_MS = 60_000;

/** Whether [start, end) shares a minute or more with a session; an open end (null) on either side runs on indefinitely. */
export function sessionsOverlap(start: string, end: string | null, other: Pick<StoredSession, 'check_in' | 'check_out'>): boolean {
  const s = Date.parse(start);
  const e = end === null ? Infinity : Date.parse(end);
  const os = Date.parse(other.check_in);
  const oe = other.check_out === null ? Infinity : Date.parse(other.check_out);
  return Math.min(e, oe) - Math.max(s, os) >= MIN_OVERLAP_MS;
}

/** The sessions [start, end) overlaps, the session being edited (`excludeId`) left out. */
export function overlappingSessions<T extends StoredSession>(sessions: readonly T[], start: string, end: string | null, excludeId?: string | null): T[] {
  return sessions.filter((x) => x.id !== excludeId && sessionsOverlap(start, end, x));
}

/** The first day to load sessions from for `dayFindings` on `date`: the year's first week (yearly Überzeit), a day earlier. */
export function dayContextFrom(date: string): string {
  return addDays(weekStart(`${date.slice(0, 4)}-01-01`), -1);
}

/** The day after the last one `dayFindings` on `date` needs (the end of its week, and the next day's rest). */
export function dayContextTo(date: string): string {
  const weekEnd = addDays(weekStart(date), 7);
  const afterNext = addDays(date, 2);
  return weekEnd > afterNext ? weekEnd : afterNext;
}

/**
 * The Working Hours Act findings that concern `date`, with the draft in place of the stored session it
 * edits: that day's breaks, span, night and Sunday work, the rest before it and after it (shown on
 * `date`), the week's maximum and the year's Überzeit. Sessions are the person's, from `dayContextFrom`
 * to `dayContextTo`; only closed ones count.
 */
export function dayFindings(
  sessions: readonly StoredSession[],
  draft: { id?: string | null; checkIn: string; checkOut: string | null } | null,
  date: string,
  o: { timeZone: string; maxWeeklyMinutes: number; yearLimitMinutes: number },
): DayFinding[] {
  const spans = sessions
    .filter((s) => s.check_out && s.id !== draft?.id)
    .map((s) => ({ start: s.check_in, end: s.check_out as string }));
  if (draft?.checkOut) spans.push({ start: draft.checkIn, end: draft.checkOut });
  const next = addDays(date, 1);
  const findings = checkWorkingTimeAct(spans, { ...o, from: date, toExclusive: dayContextTo(date) })
    .filter((f) => f.check !== 'night' && f.check !== 'sunday')
    .filter((f) => f.date === date || (f.check === 'dailyRest' && f.date === next))
    .map((f): DayFinding => (f.date === next ? { ...f, date, after: true } : f));
  // Night and Sunday work of the sessions that start on the day, in full: a shift 22:00 to 03:00
  // brings its hours after midnight along (they would otherwise count for the next day only).
  const ownSpans = spans.filter((x) => zonedDate(new Date(x.start), o.timeZone) === date);
  const own = checkWorkingTimeAct(ownSpans, { ...o, from: date, toExclusive: addDays(date, 2) });
  for (const check of ['night', 'sunday'] as const) {
    const minutes = own.filter((f) => f.check === check).reduce((sum, f) => sum + f.minutes, 0);
    if (minutes > 0) findings.push({ check, date, minutes });
  }
  return findings;
}

/** The first day of the month after `day` ('YYYY-MM-DD'). */
function nextMonthFirst(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Whether [start, end) runs past the end of a month in the person's zone. Such a session is refused:
 * each month is its own timesheet. Ending exactly at midnight of the 1st stays in the month.
 */
export function crossesMonthEnd(start: string, end: string, timeZone: string): boolean {
  const first = zonedDate(new Date(start), timeZone).slice(0, 7);
  const last = zonedDate(new Date(Date.parse(end) - 1), timeZone).slice(0, 7);
  return first !== last;
}

/**
 * [start, end) cut at every local month end it passes: one piece per month, so a check-out after
 * midnight on the 1st closes the old month's session at 24:00 and records the rest in the new month.
 */
export function splitAtMonthEnds(start: string, end: string, timeZone: string): Array<{ start: string; end: string }> {
  const pieces: Array<{ start: string; end: string }> = [];
  let from = start;
  for (let guard = 0; guard < 120 && crossesMonthEnd(from, end, timeZone); guard++) {
    const cut = zonedTime(nextMonthFirst(zonedDate(new Date(from), timeZone)), 0, timeZone).toISOString();
    pieces.push({ start: from, end: cut });
    from = cut;
  }
  pieces.push({ start: from, end });
  return pieces;
}
