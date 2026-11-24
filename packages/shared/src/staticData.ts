/**
 * Static data (Admin settings -> static data): a row maps keys either to labels (`{"travel": "Travel"}`) or to
 * properties (`{"sick": {"approval": false}}`, labels then in the row's translations).
 * Whoever owns a list declares its properties here (the core below, a plugin through its web part,
 * `WebPlugin.staticDataAttributes`), and the editor shows a control for each, so it needs no special case per list.
 * Keep it erasable TypeScript (Node tests import it).
 */

export interface StaticAttributeOption {
  value: string;
  /** A text key. */
  label: string;
}

/**
 * A property of each value of a list. A checkbox is stored only when it differs from its default; a select or a
 * text field only when it has a value.
 */
export type StaticAttribute =
  | { key: string; type: 'checkbox'; /** A text key. */ label: string; default?: boolean }
  | { key: string; type: 'select'; label: string; options: readonly StaticAttributeOption[] }
  | { key: string; type: 'text'; label: string; /** Whole-value pattern (without ^ $). */ pattern?: string; maxLength?: number };

export interface StaticAttributeList {
  entity: string;
  enumName: string;
  attributes: readonly StaticAttribute[];
}

const lists: StaticAttributeList[] = [
  // Absence types: `approval: false` = recorded as approved, the manager is told (047); `unpaid` = unpaid leave (096).
  {
    entity: 'absences',
    enumName: 'absence_type',
    attributes: [
      { key: 'approval', type: 'checkbox', label: 'staticdata.needsApproval', default: true },
      { key: 'unpaid', type: 'checkbox', label: 'staticdata.unpaid', default: false },
    ],
  },
  // Request types: confidential = only the requester and the handlers see them (089). `sort` is kept as it is.
  {
    entity: 'requests',
    enumName: 'request_type',
    attributes: [{ key: 'confidential', type: 'checkbox', label: 'requests.confidential', default: false }],
  },
];

/** Adds a list's properties (a plugin's, at startup); a list declared again replaces the earlier declaration. */
export function registerStaticAttributes(list: StaticAttributeList): void {
  const i = lists.findIndex((l) => l.entity === list.entity && l.enumName === list.enumName);
  if (i >= 0) lists[i] = list;
  else lists.push(list);
}

/** The declared properties of a list, or null when its values are labels (or properties nobody declared). */
export function staticAttributesOf(entity: string, enumName: string): readonly StaticAttribute[] | null {
  return lists.find((l) => l.entity === entity.trim() && l.enumName === enumName.trim())?.attributes ?? null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A value's properties with one of them set (removed when it is the default or empty). */
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
  return typeof v === 'string' ? v : '';
}

/** Whether a text property's value is allowed (empty is: it is then not stored). */
export function attributeTextValid(attribute: StaticAttribute, value: string): boolean {
  if (attribute.type !== 'text' || !value.trim()) return true;
  if (attribute.maxLength && value.trim().length > attribute.maxLength) return false;
  return !attribute.pattern || new RegExp(`^(?:${attribute.pattern})$`).test(value.trim());
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
