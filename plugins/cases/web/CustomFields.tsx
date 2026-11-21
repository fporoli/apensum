import { Box } from '@mui/material';
import { ConfigFieldGroup, FieldDesignScope, FormDesignPanel, useGroupTitle, type FormTemplate } from '@worktime3/web/plugin';
import { activeCustomFields, customValuesErrors, customValuesToSave } from '../shared/forms';

/**
 * The organization's own fields on a case or an assessment: a configurable form (shared/forms.ts) whose
 * fields are defined in design mode right here, like My Data. Shows nothing while there are none, except
 * in design mode, where the empty section is there to add the first field.
 */
export function CustomFieldsSection({ template, values, onChange, errors, disabled, children }: {
  template: FormTemplate;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Title and buttons around the fields (shown with them); `title` is the section's, a template may rename it. */
  children?: (fields: React.ReactNode, title: string) => React.ReactNode;
}) {
  const { form, designer } = template;
  const title = useGroupTitle(form, 'custom');
  if (!designer && activeCustomFields(form).filter((f) => !f.hidden).length === 0) return null;
  const fields = (
    <ConfigFieldGroup
      form={form}
      group="custom"
      values={values}
      editing={!disabled}
      onChange={(key, v) => onChange({ ...values, [key]: v })}
      errors={errors}
    />
  );
  return (
    <FieldDesignScope designer={designer}>
      {designer && <FormDesignPanel designer={designer} />}
      <Box>{children ? children(fields, title) : fields}</Box>
    </FieldDesignScope>
  );
}

/**
 * Checks the values against the saved template (as the API does for a plain case, and as nobody else can
 * for an encrypted one) and returns what to save, or the errors by field.
 */
export function checkCustomValues(template: FormTemplate, values: Record<string, unknown>):
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const value = customValuesToSave(template.savedForm, values);
  const errors = customValuesErrors(template.savedForm, value);
  if (errors.length) return { ok: false, errors: Object.fromEntries(errors.map((e) => [e.field, e.rule])) };
  return { ok: true, value };
}
