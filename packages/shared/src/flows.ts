/**
 * Flows (module "flows"; Free Flows and flows of the organization's own types): rules the API and the browser share.
 *
 * Flow types live only in static_data (entity "flows", enum_name "flow_type"): the org's
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
export function cleanFlowLink(value: unknown): string | null | undefined {
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

export interface FlowTypeOption {
  value: string;
  label: string;
}

/** The type keys of a flow_type row's `values`. */
export function flowTypeKeys(values: unknown): string[] {
  return values && typeof values === 'object' && !Array.isArray(values) ? Object.keys(values) : [];
}

/** A type's label in `locale`, else English, else its key. */
export function flowTypeLabel(translation: Record<string, Record<string, string>> | null | undefined, locale: string, key: string): string {
  return translation?.[locale]?.[key] ?? translation?.en?.[key] ?? key;
}

/**
 * The dropdown options of a flow_type row: ordered by the `sort` attribute (types without one
 * last), then by label. `keep` (the value of a request being edited) is added when the row lacks it,
 * so an older request still shows its type.
 */
export function flowTypeOptions(
  values: unknown,
  translation: Record<string, Record<string, string>> | null | undefined,
  locale: string,
  keep: (string | null | undefined)[] = [],
): FlowTypeOption[] {
  const attrs = (values && typeof values === 'object' && !Array.isArray(values) ? values : {}) as Record<string, unknown>;
  const keys = new Set(Object.keys(attrs));
  for (const k of keep) if (k) keys.add(k);
  const sortOf = (k: string) => {
    const a = attrs[k];
    const s = a && typeof a === 'object' ? (a as { sort?: unknown }).sort : undefined;
    return typeof s === 'number' ? s : Number.POSITIVE_INFINITY;
  };
  return [...keys]
    .map((k) => ({ value: k, label: flowTypeLabel(translation, locale, k), sort: sortOf(k) }))
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
export function isFlowOverdue(r: { due_date: string | null; status: string; archived_at?: string | null }, today: string): boolean {
  return !!r.due_date && r.due_date < today && r.status !== 'resolved' && !r.archived_at;
}

/**
 * Whether requests of type `key` are confidential (its attributes in the static_data row: `{"confidential": true}`):
 * only the requester and the handlers see them, not `nav.flows:edit:all`, notifications carry no text,
 * and neither "Send by e-mail" nor the AI assistant touch them.
 */
export function flowTypeConfidential(values: unknown, key: string | null | undefined): boolean {
  if (!key || !values || typeof values !== 'object' || Array.isArray(values)) return false;
  const attrs = (values as Record<string, unknown>)[key];
  return !!attrs && typeof attrs === 'object' && (attrs as Record<string, unknown>).confidential === true;
}

/** A flow type's key: lower-case letters, digits and _, starting with a letter, up to 30 (also a workflow variant key). */
export const FLOW_TYPE_KEY = /^[a-z][a-z0-9_]{0,29}$/;
/** The longest name of a flow type in one language. */
export const MAX_FLOW_TYPE_NAME = 80;
const FLOW_TYPE_LANGS = ['de', 'fr', 'it', 'en'] as const;

/** A key made from a type's name: "Materialbestellung" -> "materialbestellung", "Gift collection" -> "gift_collection". */
export function flowTypeKeyFromName(name: string): string {
  const slug = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '').slice(0, 30).replace(/_+$/, '');
  return slug || 'type';
}

/**
 * The flow_type list with one type added or renamed (the Flow-Designer: names per language, confidential or not): a
 * new type is sorted last, an existing one keeps its other properties. `{ error }` when the key or the names are not
 * valid (at least one name, each up to MAX_FLOW_TYPE_NAME).
 */
export function withFlowType(
  row: { values?: unknown; translation?: Record<string, Record<string, string>> | null } | null | undefined,
  key: string,
  names: unknown,
  confidential: boolean,
): { values: Record<string, unknown>; translation: Record<string, Record<string, string>> } | { error: string } {
  if (typeof key !== 'string' || !FLOW_TYPE_KEY.test(key)) return { error: 'invalid-key' };
  if (!names || typeof names !== 'object' || Array.isArray(names)) return { error: 'invalid-name' };
  const cleaned: Record<string, string> = {};
  for (const [lang, text] of Object.entries(names as Record<string, unknown>)) {
    if (!(FLOW_TYPE_LANGS as readonly string[]).includes(lang) || typeof text !== 'string') return { error: 'invalid-name' };
    const t = text.trim();
    if (t.length > MAX_FLOW_TYPE_NAME) return { error: 'invalid-name' };
    if (t) cleaned[lang] = t;
  }
  if (Object.keys(cleaned).length === 0) return { error: 'name-required' };
  const values: Record<string, unknown> = row?.values && typeof row.values === 'object' && !Array.isArray(row.values) ? { ...(row.values as Record<string, unknown>) } : {};
  const old = values[key];
  const attrs: Record<string, unknown> = old && typeof old === 'object' && !Array.isArray(old) ? { ...(old as Record<string, unknown>) } : {};
  if (!(key in values)) {
    const sorts = Object.values(values).map((v) => Number((v as { sort?: unknown } | null)?.sort)).filter(Number.isFinite);
    attrs.sort = (sorts.length ? Math.max(...sorts) : 0) + 1;
  }
  if (confidential) attrs.confidential = true;
  else delete attrs.confidential;
  values[key] = attrs;
  const translation: Record<string, Record<string, string>> = {};
  for (const [lang, labels] of Object.entries(row?.translation ?? {})) translation[lang] = { ...labels };
  for (const lang of FLOW_TYPE_LANGS) {
    const forLang = { ...(translation[lang] ?? {}) };
    if (cleaned[lang]) forLang[key] = cleaned[lang];
    else delete forLang[key];
    if (Object.keys(forLang).length) translation[lang] = forLang;
    else delete translation[lang];
  }
  return { values, translation };
}
