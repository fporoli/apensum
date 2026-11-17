/**
 * Parsing of typed durations and clock times, so time entry needs no pickers or spinners.
 * Kept free of JSX so Node can import it in tests.
 *
 * Durations: `8h`, `8:10`, `45m`, `8h10`, `8h 10m`, `1.5h` / `1,5h`; a bare number is hours
 * up to 24 (`8`, `1.5`) and minutes above (`90`). Typed durations round to 5 minutes.
 * Clock times: `9:45`, `9.45`, `9h45`, `945`, `1800`, `9`, `18`.
 */

/** Step every typed duration is rounded to. */
export const DURATION_STEP_MINUTES = 5;
/** Longest duration accepted for one entry. */
export const MAX_DURATION_MINUTES = 24 * 60;

function decimal(s: string): number {
  return Number(s.replace(',', '.'));
}

/** Rounds minutes to the nearest multiple of 5. */
export function roundToStep(minutes: number): number {
  return Math.round(minutes / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
}

/**
 * A typed duration in minutes, rounded to 5. Returns `null` for empty input and `undefined`
 * when the text is not a duration, rounds to zero or exceeds 24 hours.
 */
export function parseDuration(text: string): number | null | undefined {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return null;
  let minutes: number | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(s))) {
    if (Number(m[2]) < 60) minutes = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = /^(\d+(?:[.,]\d+)?)h(?:(\d{1,2})(?:m|min)?)?$/.exec(s))) {
    if (!m[2] || Number(m[2]) < 60) minutes = decimal(m[1]) * 60 + Number(m[2] ?? 0);
  } else if ((m = /^(\d+)(?:m|min)$/.exec(s))) {
    minutes = Number(m[1]);
  } else if ((m = /^\d+(?:[.,]\d+)?$/.exec(s))) {
    const n = decimal(m[0]);
    minutes = n <= 24 ? n * 60 : n;
  }
  if (minutes === undefined) return undefined;
  const rounded = roundToStep(minutes);
  return rounded > 0 && rounded <= MAX_DURATION_MINUTES ? rounded : undefined;
}

/** Minutes as a duration that `parseDuration` reads back, e.g. 490 -> "8h 10m", 45 -> "45m", 480 -> "8h". */
export function formatDurationInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * A typed clock time as minutes after midnight. Returns `null` for empty input and `undefined`
 * when the text is not a time of day. Digits only: one or two are the hour (`9`, `18`), three or
 * four are hour and minutes (`945` = 9:45, `1800` = 18:00).
 */
export function parseClockTime(text: string): number | null | undefined {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return null;
  let h: number;
  let m: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2})[:.h](\d{2})$/.exec(s))) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else if ((match = /^\d{1,4}$/.exec(s))) {
    const digits = match[0];
    if (digits.length <= 2) {
      h = Number(digits);
      m = 0;
    } else {
      h = Number(digits.slice(0, -2));
      m = Number(digits.slice(-2));
    }
  } else {
    return undefined;
  }
  return h < 24 && m < 60 ? h * 60 + m : undefined;
}

/** Minutes after midnight as "HH:mm". */
export function formatClockTime(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

/** "HH:mm" as minutes after midnight; `null` when it is not one. */
export function clockToMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * A session from a day, a start and either an end time or a duration (local time). An end at or
 * before the start is on the next day (a night shift). Returns ISO strings; `checkOut` is null
 * when neither end nor duration is given (the session is still running).
 */
export function sessionFromParts(
  date: string,
  start: string,
  end: { kind: 'end'; time: string | null } | { kind: 'duration'; minutes: number | null },
): { checkIn: string; checkOut: string | null; nextDay: boolean } | null {
  const startMin = clockToMinutes(start);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (startMin === null || !day) return null;
  const base = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const at = (dayOffset: number, minutes: number) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60);
  const checkIn = at(0, startMin);
  if (end.kind === 'duration') {
    if (end.minutes === null) return { checkIn: checkIn.toISOString(), checkOut: null, nextDay: false };
    const out = new Date(checkIn.getTime() + end.minutes * 60000);
    return { checkIn: checkIn.toISOString(), checkOut: out.toISOString(), nextDay: out.getDate() !== checkIn.getDate() };
  }
  const endMin = clockToMinutes(end.time);
  if (endMin === null) return { checkIn: checkIn.toISOString(), checkOut: null, nextDay: false };
  const nextDay = endMin <= startMin;
  return { checkIn: checkIn.toISOString(), checkOut: at(nextDay ? 1 : 0, endMin).toISOString(), nextDay };
}
