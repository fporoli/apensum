/**
 * Requests (module "requests"): rules the API and the browser share.
 *
 * Request types live only in static_data (entity "requests", enum_name "request_type"): the org's
 * own row, else the global one (069-request-type-urgency-link.sql). `values` maps each type key to
 * its attributes (`{"sort": 1}` orders the dropdown); labels are in `translation` per language.
 * The code keeps no list of types.
 */

/** Longest link a request may carry. */
export const MAX_REQUEST_LINK = 2000;

/**
 * A request's link (to another ticket, a document, ...): trimmed, `null` when empty, `undefined`
 * when it is not an absolute http(s) URL or is too long. A bare `www.` / host name gets `https://`.
 */
export function cleanRequestLink(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  let text = value.trim();
  if (text === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  if (text.length > MAX_REQUEST_LINK || /\s/.test(text)) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  // A host needs a dot (example.com) or must be localhost, so "foo" is not taken for a link.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return undefined;
  return text;
}

export interface RequestTypeOption {
  value: string;
  label: string;
}

/** The type keys of a request_type row's `values`. */
export function requestTypeKeys(values: unknown): string[] {
  return values && typeof values === 'object' && !Array.isArray(values) ? Object.keys(values) : [];
}

/** A type's label in `locale`, else English, else its key. */
export function requestTypeLabel(translation: Record<string, Record<string, string>> | null | undefined, locale: string, key: string): string {
  return translation?.[locale]?.[key] ?? translation?.en?.[key] ?? key;
}

/**
 * The dropdown options of a request_type row: ordered by the `sort` attribute (types without one
 * last), then by label. `keep` (the value of a request being edited) is added when the row lacks it,
 * so an older request still shows its type.
 */
export function requestTypeOptions(
  values: unknown,
  translation: Record<string, Record<string, string>> | null | undefined,
  locale: string,
  keep: (string | null | undefined)[] = [],
): RequestTypeOption[] {
  const attrs = (values && typeof values === 'object' && !Array.isArray(values) ? values : {}) as Record<string, unknown>;
  const keys = new Set(Object.keys(attrs));
  for (const k of keep) if (k) keys.add(k);
  const sortOf = (k: string) => {
    const a = attrs[k];
    const s = a && typeof a === 'object' ? (a as { sort?: unknown }).sort : undefined;
    return typeof s === 'number' ? s : Number.POSITIVE_INFINITY;
  };
  return [...keys]
    .map((k) => ({ value: k, label: requestTypeLabel(translation, locale, k), sort: sortOf(k) }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, locale))
    .map(({ value, label }) => ({ value, label }));
}

/**
 * A request's due date: `YYYY-MM-DD` (a real calendar day between 2000 and 2100), `null` when empty,
 * `undefined` when invalid. Once it has passed while the request is open, the handlers get an e-mail.
 */
export function cleanDueDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return undefined;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100 ? value : undefined;
}

/** Whether an open request's due date has passed (`today` = the local day, YYYY-MM-DD). */
export function isRequestOverdue(r: { due_date: string | null; status: string; archived_at?: string | null }, today: string): boolean {
  return !!r.due_date && r.due_date < today && r.status !== 'resolved' && !r.archived_at;
}
