/**
 * When a scheduled report (065 `report_schedules`) runs: weekly on a weekday (1 = Monday ... 7 =
 * Sunday) or monthly on a day (1-28), at a full hour of the wall clock in the schedule's time zone,
 * so 06:00 stays 06:00 across daylight saving time. Pure, so it is tested without a database.
 */

import { zoneFormatter } from './zone-format';

export interface ScheduleRule {
  frequency: 'weekly' | 'monthly';
  weekday?: number | null;
  monthDay?: number | null;
  hour: number;
  timeZone: string;
}

/** Minutes the zone is ahead of UTC at `instant` (e.g. 60 for Zurich in winter). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    zoneFormatter('parts', timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant of a wall-clock time (date yyyy-mm-dd, hour) in a zone. */
export function zonedTime(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Once more with the offset in force at the result (differs around a daylight saving switch).
  return new Date(guess - zoneOffsetMinutes(new Date(first), timeZone) * 60_000);
}

/** The calendar date (yyyy-mm-dd) of an instant in a zone. */
export function zonedDate(instant: Date, timeZone: string): string {
  return zoneFormatter('date', timeZone).format(instant);
}

const addDays = (date: string, days: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days)).toISOString().slice(0, 10);

/** The first run strictly after `after`. */
export function nextRunAt(rule: ScheduleRule, after: Date): Date {
  const today = zonedDate(after, rule.timeZone);
  if (rule.frequency === 'weekly') {
    for (let i = 0; i <= 7; i++) {
      const date = addDays(today, i);
      const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      if (weekday !== rule.weekday) continue;
      const at = zonedTime(date, rule.hour, rule.timeZone);
      if (at > after) return at;
    }
  } else {
    const day = String(rule.monthDay).padStart(2, '0');
    for (let i = 0; i <= 2; i++) {
      const month = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + i, 1)).toISOString().slice(0, 7);
      const at = zonedTime(`${month}-${day}`, rule.hour, rule.timeZone);
      if (at > after) return at;
    }
  }
  throw new Error('invalid schedule');
}

/** A schedule from a request body, or the error code. */
export function parseScheduleRule(body: Record<string, unknown>, timeZone: string): ScheduleRule | { error: string } {
  const frequency = body.frequency;
  const hour = Number(body.hour ?? 6);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: 'invalid-schedule' };
  if (frequency === 'weekly') {
    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: 'invalid-schedule' };
    return { frequency, weekday, hour, timeZone };
  }
  if (frequency === 'monthly') {
    const monthDay = Number(body.monthDay);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28) return { error: 'invalid-schedule' };
    return { frequency, monthDay, hour, timeZone };
  }
  return { error: 'invalid-schedule' };
}
