/**
 * Cached `Intl.DateTimeFormat`s per time zone. Building a formatter is expensive (about 600 µs on
 * the VPS against 5 µs for using one) and the balance code formats every attendance session's day
 * and midnight, so the formatters are made once per zone and reused. An unknown zone throws, as the
 * constructor does, and is not cached.
 */

const OPTIONS = {
  /** 'YYYY-MM-DD' (Swedish formats dates as ISO). */
  date: { locale: 'sv-SE', options: { year: 'numeric', month: '2-digit', day: '2-digit' } },
  /** Every field of the wall-clock time, for `formatToParts`. */
  parts: {
    locale: 'en-US',
    options: { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
  },
} as const satisfies Record<string, { locale: string; options: Intl.DateTimeFormatOptions }>;

export type ZoneFormat = keyof typeof OPTIONS;

const cache = new Map<string, Intl.DateTimeFormat>();

export function zoneFormatter(format: ZoneFormat, timeZone: string): Intl.DateTimeFormat {
  const key = `${format}|${timeZone}`;
  let formatter = cache.get(key);
  if (!formatter) {
    const { locale, options } = OPTIONS[format];
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    cache.set(key, formatter);
  }
  return formatter;
}
