/**
 * The organization's own fields on cases and assessments, as configurable forms (docs/FIELD_CONFIG.md):
 * defined in design mode on the Cases page like every other form (field_config, form ids below),
 * registered with the core by api/index.ts (`forms`). The forms have no fields of their own, only the
 * custom ones a template adds. Values live in the row's `custom` JSON, which for an encrypted case is
 * sealed inside `enc`: the server checks a plain row with `customValuesErrors`, the browser an encrypted one.
 */
import type { FormDef } from '@worktime3/shared/fields';

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

// The checks of forms made of custom fields only are the core's (also used by requests).
export { MAX_CUSTOM_TEXT, activeCustomFields, customValuesErrors, customValuesToSave } from '@worktime3/shared/fields';
