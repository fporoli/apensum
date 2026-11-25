/**
 * The demo instance starts over on a schedule (a systemd timer on its server, infra/vps/remote.sh `demo_reset_timer`:
 * every DEMO_RESET_EVERY_HOURS hours at minute 7 UTC).
 * The API says how often (GET health `demoReset.everyHours`, env DEMO_RESET_EVERY_HOURS); the times are
 * worked out here: a warning before, and during the reset (API unreachable) a waiting page.
 * Plain TypeScript without imports, so node --test can load it (demoReset.test.mjs).
 */

/** The timer's minute (UTC); demoReset.test.mjs keeps it equal to remote.sh. */
export const DEMO_RESET_MINUTE_UTC = 7;
/** Minutes before a reset that the warning shows. */
export const DEMO_RESET_WARN_MINUTES = 10;
/** Minutes after the scheduled time that an unreachable API is taken for the reset (the reset takes a few). */
export const DEMO_RESET_WINDOW_MINUTES = 30;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The next scheduled reset after `now` (ms), for a schedule every `everyHours` hours from 00:MM UTC. */
export function nextDemoReset(now: number, everyHours: number, minute = DEMO_RESET_MINUTE_UTC): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (let k = 0; ; k++) {
    const at = midnight + k * everyHours * HOUR + minute * MINUTE;
    if (at > now) return at;
  }
}

/** The scheduled reset at or before `now`. */
export function lastDemoReset(now: number, everyHours: number, minute = DEMO_RESET_MINUTE_UTC): number {
  return nextDemoReset(now, everyHours, minute) - everyHours * HOUR;
}

/** Whether an unreachable API now is probably the reset: from a minute before a scheduled time to the window after it. */
export function inDemoResetWindow(now: number, everyHours: number): boolean {
  return nextDemoReset(now, everyHours) - now <= MINUTE || now - lastDemoReset(now, everyHours) <= DEMO_RESET_WINDOW_MINUTES * MINUTE;
}

/** Minutes until the next reset while the warning shows, else null. */
export function demoResetWarning(now: number, everyHours: number): { at: number; minutes: number } | null {
  const at = nextDemoReset(now, everyHours);
  const left = at - now;
  return left <= DEMO_RESET_WARN_MINUTES * MINUTE ? { at, minutes: Math.max(1, Math.ceil(left / MINUTE)) } : null;
}
