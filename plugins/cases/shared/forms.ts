/**
 * The organization's own fields on cases and assessments, as configurable forms (docs/FIELD_CONFIG.md):
 * defined in design mode on the Cases page like every other form (field_config, form ids below),
 * registered with the core by api/index.ts (`forms`). The forms have no fields of their own, only the
 * custom ones a template adds. Values live in the row's `custom` JSON, which for an encrypted case is
 * sealed inside `enc`: the server checks a plain row with `customValuesErrors`, the browser an encrypted one.
 */
import { validateValue, type FieldError, type FormDef, type ResolvedForm } from '@worktime3/shared/fields';

export const CASE_FORM: FormDef = {
  id: 'cases.case',
  groups: [{ key: 'custom', caption: 'cases.custom.cardTitle', order: 10 }],
  fields: [],
  customStorage: { table: 'cases.cases', column: 'custom' },
};

export const ASSESSMENT_FORM: FormDef = {
  id: 'cases.assessment',
  groups: [{ key: 'custom', caption: 'cases.custom.assessmentTitle', order: 10 }],
  fields: [],
  customStorage: { table: 'cases.assessments', column: 'custom' },
};

/** Longest text value of a custom field. */
export const MAX_CUSTOM_TEXT = 50_000;

/** The fields a row's form shows and writes: custom, not retired. */
export function activeCustomFields(form: ResolvedForm) {
  return form.fields.filter((f) => f.custom && !f.retired);
}

/**
 * What is wrong with a row's custom values (empty when nothing): every key a field of the form (a
 * retired field's stored value passes unchecked), each value of its type and rules, required ones set.
 * The values are the row's whole `custom` object, as the form saves it.
 */
export function customValuesErrors(form: ResolvedForm, values: unknown): FieldError[] {
  if (values === null || values === undefined) values = {};
  if (typeof values !== 'object' || Array.isArray(values)) return [{ field: '', rule: 'type' }];
  const given = values as Record<string, unknown>;
  const byKey = new Map(form.fields.filter((f) => f.custom).map((f) => [f.key, f]));
  const errors: FieldError[] = [];
  for (const [key, value] of Object.entries(given)) {
    const field = byKey.get(key);
    if (!field) errors.push({ field: key, rule: 'unknown' });
    else if (!field.retired && typeof value === 'string' && value.length > MAX_CUSTOM_TEXT) errors.push({ field: key, rule: 'max' });
  }
  for (const field of activeCustomFields(form)) {
    const r = validateValue(field, given[field.key] ?? null);
    if (!r.ok) errors.push({ field: field.key, rule: r.rule });
  }
  return errors;
}

/** The values the form saves: its active fields' values, plus retired fields' stored ones (kept as they were). */
export function customValuesToSave(form: ResolvedForm, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form.fields) {
    if (!f.custom || !(f.key in values)) continue;
    const v = values[f.key];
    out[f.key] = v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v;
  }
  return out;
}
