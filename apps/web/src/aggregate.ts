export type View = 'daily' | 'weekly' | 'monthly';

export interface Entry {
  id: string;
  start_time: string;
  end_time: string;
  comment?: string;
  /** The item text (Positionstext): a customer sees it on the invoice's hours report. */
  description?: string | null;
  project_id?: string | null;
  subproject_id?: string | null;
  /** Joined by the API list endpoint so rows render without a lookup. */
  project_name?: string | null;
  subproject_name?: string | null;
}

export function minutes(e: Entry): number {
  return (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
}

/**
 * An entry's minutes per local day: an entry past midnight is split there, so a night from 22:00 to
 * 06:00 adds 2 hours to its first day and 6 to the next (as the API counts attendance).
 */
export function minutesPerDay(e: Pick<Entry, 'start_time' | 'end_time'>): [string, number][] {
  const end = new Date(e.end_time).getTime();
  let start = new Date(e.start_time).getTime();
  const out: [string, number][] = [];
  while (start < end) {
    const d = new Date(start);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const pieceEnd = Math.min(end, nextMidnight);
    out.push([dateKey(d), (pieceEnd - start) / 60000]);
    start = pieceEnd;
  }
  return out;
}

export function bucket(entries: Entry[], view: View): { label: string; minutes: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    for (const [localDay, mins] of minutesPerDay(e)) {
      let key: string;
      if (view === 'daily') key = localDay;
      else if (view === 'monthly') key = localDay.slice(0, 7);
      else key = startOfWeek(localDay);
      map.set(key, (map.get(key) ?? 0) + mins);
    }
  }
  return [...map.entries()].map(([label, mins]) => ({ label, minutes: mins })).sort((a, b) => (a.label < b.label ? -1 : 1));
}

/** A single day, a Mon-Sun week, or a calendar month — the granularity of the project time period selector. */
export type PeriodType = 'day' | 'week' | 'month';

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today as 'YYYY-MM-DD' in local time. */
export function todayDate(): string {
  return dateKey(new Date());
}

/** Monday of the local week containing `dateStr` ('YYYY-MM-DD' in, 'YYYY-MM-DD' out). */
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}

/** Move `anchor` ('YYYY-MM-DD') by `delta` periods of `type`, in local time. */
export function shiftPeriod(type: PeriodType, anchor: string, delta: number): string {
  const [y, m, d] = anchor.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (type === 'day') date.setDate(date.getDate() + delta);
  else if (type === 'week') date.setDate(date.getDate() + delta * 7);
  else date.setMonth(date.getMonth() + delta);
  return dateKey(date);
}

/** The [from, to) local-time instants, as ISO strings, of the period of `type` containing `anchor`. */
export function periodRange(type: PeriodType, anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  let start: Date;
  let end: Date;
  if (type === 'day') {
    start = new Date(y, m - 1, d);
    end = new Date(y, m - 1, d + 1);
  } else if (type === 'week') {
    const [wy, wm, wd] = startOfWeek(anchor).split('-').map(Number);
    start = new Date(wy, wm - 1, wd);
    end = new Date(wy, wm - 1, wd + 7);
  } else {
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/** A human-readable label for the period of `type` containing `anchor`, formatted in `locale` (defaults to the browser's). */
export function periodLabel(type: PeriodType, anchor: string, language?: string): string {
  // The Swiss variant of the language, like localeFormat.ts swissLocale (this file stays import-free for Node tests).
  const locale = language && /^[a-z]{2}$/.test(language) ? `${language}-CH` : language;
  const [y, m, d] = anchor.split('-').map(Number);
  if (type === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  if (type === 'day') {
    return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  const [wy, wm, wd] = startOfWeek(anchor).split('-').map(Number);
  const weekStart = new Date(wy, wm - 1, wd);
  const weekEnd = new Date(wy, wm - 1, wd + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${fmt(weekStart)} – ${fmt(weekEnd)}, ${weekEnd.getFullYear()}`;
}
