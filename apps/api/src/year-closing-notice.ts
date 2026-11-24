/**
 * What the person hears when HR closes or reopens their year (Time balances → Year-end closing): a notification in
 * their language, opening Work time with their balances (`source_table` `balance_years`). Only their own numbers, to them alone.
 * Pure; the controller sends it, best effort.
 */

const TEXTS: Record<string, { closed: string; closedBody: string; legal: string; reopened: string; reopenedBody: string }> = {
  en: {
    closed: 'Year {year} closed',
    closedBody: 'Overtime at year end {overtime} h{legal} · Vacation left {vacation} days, carried into {next}',
    legal: ' (of which Überzeit {legal} h)',
    reopened: 'Year {year} reopened',
    reopenedBody: 'Your balances for {year} are computed again and may still change.',
  },
  de: {
    closed: 'Jahr {year} abgeschlossen',
    closedBody: 'Überstunden Ende Jahr {overtime} h{legal} · Ferienrest {vacation} Tage, übertragen ins Jahr {next}',
    legal: ' (davon Überzeit {legal} h)',
    reopened: 'Jahr {year} wieder geöffnet',
    reopenedBody: 'Ihre Salden {year} werden wieder laufend berechnet und können sich noch ändern.',
  },
  fr: {
    closed: 'Année {year} clôturée',
    closedBody: "Heures sup. en fin d'année {overtime} h{legal} · Vacances restantes {vacation} jours, reportées sur {next}",
    legal: ' (dont travail supplémentaire {legal} h)',
    reopened: 'Année {year} rouverte',
    reopenedBody: 'Vos soldes {year} sont de nouveau calculés et peuvent encore changer.',
  },
  it: {
    closed: 'Anno {year} chiuso',
    closedBody: 'Straordinari a fine anno {overtime} h{legal} · Vacanze rimanenti {vacation} giorni, riportate al {next}',
    legal: ' (di cui lavoro straordinario {legal} h)',
    reopened: 'Anno {year} riaperto',
    reopenedBody: 'I suoi saldi {year} vengono di nuovo calcolati e possono ancora cambiare.',
  },
};

const SWISS: Record<string, string> = { en: 'en-CH', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' };

function textsFor(locale: string | null | undefined) {
  const lang = String(locale ?? '').slice(0, 2);
  return { lang: TEXTS[lang] ? lang : 'en', texts: TEXTS[lang] ?? TEXTS.en };
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

/** Signed hours and minutes: -171 → "-2:51", 90 → "+1:30", 0 → "0:00". */
export function signedHours(minutes: number): string {
  const m = Math.round(minutes);
  const sign = m < 0 ? '-' : m > 0 ? '+' : '';
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

export function yearClosedNotice(
  locale: string | null | undefined,
  year: number,
  values: { overtime: number; legalOvertime: number; vacation: number },
): { title: string; body: string } {
  const { lang, texts } = textsFor(locale);
  const vacation = values.vacation.toLocaleString(SWISS[lang], { maximumFractionDigits: 2 });
  const legal = Math.round(values.legalOvertime) !== 0 ? fill(texts.legal, { legal: signedHours(values.legalOvertime) }) : '';
  return {
    title: fill(texts.closed, { year: String(year) }),
    body: fill(texts.closedBody, { overtime: signedHours(values.overtime), legal, vacation, next: String(year + 1) }),
  };
}

export function yearReopenedNotice(locale: string | null | undefined, year: number): { title: string; body: string } {
  const { texts } = textsFor(locale);
  return { title: fill(texts.reopened, { year: String(year) }), body: fill(texts.reopenedBody, { year: String(year) }) };
}
