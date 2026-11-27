import { AsyncLocalStorage } from 'node:async_hooks';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The business clock: "now" and "today" for what a company does (work time and balances, flows and their steps, a
 * manager on a day, the history). It is the real time, except inside `clock.at(...)`, which only code in the API's own
 * process can call (the Whale simulation, tests): no request can set it, on purpose.
 *
 * Technical time stays real and never reads this clock: sessions, tokens and invitations expiring, two-step login,
 * rate limits, the timers' own "last ran". Faking those would be a hole, not a feature.
 *
 * In SQL, `sqlNow()` / `sqlToday()` stand for `now()` / `CURRENT_DATE` (a parameter: the database's own clock is
 * the real one).
 */
const storage = new AsyncLocalStorage<() => Date>();

export const clock = {
  /** The business time now. */
  now(): Date {
    const at = storage.getStore();
    return at ? at() : new Date();
  },

  /**
   * Runs `fn` (and everything it awaits) at another time: a fixed moment, or a function asked at every `now()`
   * (the simulation lets its day's time run on).
   */
  at<T>(time: Date | (() => Date), fn: () => T): T {
    const at = typeof time === 'function' ? time : () => new Date(time.getTime());
    return storage.run(at, fn);
  },

  /** Whether a time is set (inside `clock.at`). */
  isSet(): boolean {
    return storage.getStore() !== undefined;
  },
};

/** The business time now, for SQL (instead of `now()`). */
export function sqlNow(): SQL {
  return sql`${clock.now().toISOString()}::timestamptz`;
}

/** Today's date in a time zone, for SQL (instead of `CURRENT_DATE`, which is the database's and in UTC). */
export function sqlToday(timeZone = 'Europe/Zurich'): SQL {
  return sql`${todayIn(timeZone)}::date`;
}

/** Today's date (YYYY-MM-DD) in a time zone by the business clock. */
export function todayIn(timeZone = 'Europe/Zurich'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock.now());
}
