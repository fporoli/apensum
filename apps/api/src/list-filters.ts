import { sql, type SQL } from 'drizzle-orm';
import { isIsoDate } from '@worktime3/shared/worktime';

/**
 * The Flows page's filters, read the same way for both of its sources (`GET workflows/assigned-to-me`,
 * `GET organizations/:orgId/flows`): what is malformed is left out, never an error.
 */
export interface ListFilters {
  /** Last activity on or after this day (YYYY-MM-DD). */
  since: string | null;
  /** Started by this person (a user id). */
  person: string | null;
  /** Every word in one of the searched columns, without case or accents (folded with `foldText`). */
  words: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Lower case without accents (é -> e), as `foldedSql` writes a column. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function parseListFilters(query: { since?: string; person?: string; q?: string }): ListFilters {
  const since = typeof query.since === 'string' && isIsoDate(query.since) ? query.since : null;
  const person = isUuid(query.person) ? query.person : null;
  const words = typeof query.q === 'string'
    ? [...new Set(foldText(query.q.slice(0, 200)).split(/\s+/).filter(Boolean))].slice(0, 6)
    : [];
  return { since, person, words };
}

// Postgres has no unaccent here: the accented letters of the four languages, folded by hand.
const ACCENTED = 'àáâãäåèéêëìíîïòóôõöùúûüçñÿÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ';
const PLAIN = 'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucn';

/** A text column in lower case without accents, to compare with `foldText`. */
function foldedSql(column: SQL): SQL {
  return sql`translate(lower(coalesce(${column}, '')), ${ACCENTED}, ${PLAIN})`;
}

/** `%word%` for LIKE, with LIKE's own characters taken literally. */
export function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Every word in one of the columns (none: no condition). */
export function wordsMatch(columns: SQL[], words: readonly string[]): SQL | null {
  if (!words.length || !columns.length) return null;
  const each = words.map((w) => sql`(${sql.join(columns.map((c) => sql`${foldedSql(c)} LIKE ${likePattern(w)}`), sql` OR `)})`);
  return sql.join(each, sql` AND `);
}

/** A list cursor (`<ISO time>|<id>`), or null when malformed: the next page starts after that row. */
export function parseCursor(value: string | undefined): { at: string; id: string } | null {
  const [at, id] = (value ?? '').split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !isUuid(id)) return null;
  return { at: new Date(at).toISOString(), id };
}

/** The cursor of a row (`before` of the next page); rows without a time sort last. */
export function cursorOf(row: { id: string; at: string | Date | null }): string {
  return `${row.at ? new Date(row.at).toISOString() : '1970-01-01T00:00:00.000Z'}|${row.id}`;
}

/** `limit` of a list: 0 (none) when missing or malformed, at most 1000. */
export function parseLimit(value: string | undefined): number {
  return Math.min(Math.max(Math.floor(Number(value)) || 0, 0), 1000);
}
