/**
 * Static data (Admin settings -> static data): a list maps keys either to labels (`{"travel": "Travel"}`) or to
 * properties (`{"sick": {"approval": false}}`, labels then in the list's translations).
 * Which properties a list's values carry is itself static data: the list static_data/properties (core changeset 101)
 * maps "<entity>.<list>.<property>" to its description (type, the list a choice is from, a pattern, a checkbox's
 * default, the order), its labels are that list's translations. It describes its own fields as well, so one editor
 * edits every list, the description included. The core's and the plugins' properties come from migrations (global
 * rows); an organization adds its own in its copy, and the global ones always win.
 * Keep it erasable TypeScript (Node tests import it).
 */

/** A static data row as the API returns it. */
export interface StaticDataRowLike {
  organization_id?: string | null;
  entity: string;
  enum_name: string;
  values: Record<string, unknown>;
  translation?: Record<string, Record<string, string>> | null;
}

/** The list that describes the properties of every list. */
export const PROPERTIES_LIST = { entity: 'static_data', enumName: 'properties' } as const;

export type StaticAttributeType = 'checkbox' | 'select' | 'text';

/** A property of each value of a list, ready to show: its label in the language, a choice's options with theirs. */
export interface StaticAttribute {
  key: string;
  type: StaticAttributeType;
  label: string;
  /** A checkbox's value when the property is not stored. */
  default?: boolean;
  /** A select's choices (the keys of the list it names, with their labels). */
  options?: { value: string; label: string }[];
  /** A text's allowed value (whole value, without ^ $). */
  pattern?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A list as an organization sees it: its own copy, else the global row. */
export function effectiveRow<T extends StaticDataRowLike>(rows: readonly T[], entity: string, enumName: string): T | undefined {
  const matching = rows.filter((r) => r.entity === entity.trim() && r.enum_name === enumName.trim());
  return matching.find((r) => r.organization_id) ?? matching.find((r) => !r.organization_id);
}

/**
 * The property descriptions an organization sees: the organization's own (its copy of the list) and, over them,
 * the global ones, which an organization can add to but never change.
 */
export function propertyDescriptions(rows: readonly StaticDataRowLike[]): StaticDataRowLike | undefined {
  const matching = rows.filter((r) => r.entity === PROPERTIES_LIST.entity && r.enum_name === PROPERTIES_LIST.enumName);
  const global = matching.find((r) => !r.organization_id);
  const own = matching.find((r) => r.organization_id);
  if (!global && !own) return undefined;
  const translation: Record<string, Record<string, string>> = {};
  for (const r of [global, own]) {
    for (const [locale, labels] of Object.entries(r?.translation ?? {})) translation[locale] = { ...translation[locale], ...labels };
  }
  return { ...PROPERTIES_LIST, enum_name: PROPERTIES_LIST.enumName, values: { ...(own?.values ?? {}), ...(global?.values ?? {}) }, translation };
}

/**
 * The properties of a list's values, in their order, labelled in `locale`; null when nothing describes the list
 * (its values are labels). `rows` are the static data rows the organization sees (its own and the global ones).
 */
export function propertiesOf(rows: readonly StaticDataRowLike[], entity: string, enumName: string, locale: string): StaticAttribute[] | null {
  const descriptions = propertyDescriptions(rows);
  if (!descriptions) return null;
  const prefix = `${entity.trim()}.${enumName.trim()}.`;
  const out: (StaticAttribute & { sort: number })[] = [];
  for (const [id, raw] of Object.entries(descriptions.values)) {
    if (!id.startsWith(prefix) || !isObject(raw)) continue;
    const key = id.slice(prefix.length);
    const type = raw.type;
    if (!key || key.includes('.') || (type !== 'checkbox' && type !== 'select' && type !== 'text')) continue;
    const attribute: StaticAttribute & { sort: number } = {
      key, type, label: staticValueLabel(descriptions, locale, id), sort: Number(raw.sort) || 999,
    };
    if (type === 'checkbox') attribute.default = raw.default === true;
    if (type === 'text' && typeof raw.pattern === 'string' && raw.pattern) attribute.pattern = raw.pattern;
    if (type === 'select') {
      const [listEntity, listName] = typeof raw.list === 'string' ? raw.list.split('.') : [];
      const list = listEntity && listName ? effectiveRow(rows, listEntity, listName) : undefined;
      attribute.options = Object.keys(list?.values ?? {}).map((value) => ({ value, label: staticValueLabel(list, locale, value) }));
    }
    out.push(attribute);
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)).map(({ sort: _sort, ...a }) => a);
}

/** A value's properties with one of them set (removed when it is a checkbox's default or empty). */
export function withAttribute(attrs: Record<string, unknown> | null | undefined, attribute: StaticAttribute, value: unknown): Record<string, unknown> {
  const { [attribute.key]: _old, ...rest } = attrs ?? {};
  if (attribute.type === 'checkbox') return value === (attribute.default ?? false) ? rest : { ...rest, [attribute.key]: value === true };
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? { ...rest, [attribute.key]: text } : rest;
}

/** A property's current value as the editor shows it (a checkbox's default when unset). */
export function attributeValue(attrs: Record<string, unknown> | null | undefined, attribute: StaticAttribute): boolean | string {
  const v = attrs?.[attribute.key];
  if (attribute.type === 'checkbox') return typeof v === 'boolean' ? v : attribute.default ?? false;
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** Whether a text property's value is allowed (empty is: it is then not stored). A broken pattern allows anything. */
export function attributeTextValid(attribute: StaticAttribute, value: string): boolean {
  if (attribute.type !== 'text' || !value.trim() || !attribute.pattern) return true;
  try {
    return new RegExp(`^(?:${attribute.pattern})$`).test(value.trim());
  } catch {
    return true;
  }
}

/**
 * The label of a key: the translation in `locale`, else the value when it is a label, else the English translation,
 * else the key. Property values (objects) are never a label.
 */
export function staticValueLabel(
  row: { values?: Record<string, unknown> | null; translation?: Record<string, Record<string, string>> | null } | null | undefined,
  locale: string,
  key: string,
): string {
  const value = row?.values?.[key];
  return row?.translation?.[locale]?.[key] ?? (typeof value === 'string' && value ? value : undefined) ?? row?.translation?.en?.[key] ?? key;
}

/** A value's properties (an empty object for a label value or nothing). */
export function staticAttributes(row: { values?: Record<string, unknown> | null } | null | undefined, key: string): Record<string, unknown> {
  const value = row?.values?.[key];
  return isObject(value) ? value : {};
}
