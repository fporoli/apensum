import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { activeCustomFields, customValuesErrors, customValuesToSave } from '@worktime3/shared/fields';
import { ConfigFieldGroup, useGroupTitle } from './ConfigField';
import { FieldDesignScope, type FormTemplate } from './designMode';
import { FormDesignPanel } from './FormDesigner';

/**
 * The organization's own fields on a request (configurable form `request`, only custom fields): defined
 * in design mode on the Requests page, filled in when sending and in "Edit details". Shows nothing while
 * there are none, except in design mode, where the empty section is there to add the first field.
 */
export function RequestCustomFields({
  template, values, onChange, errors, editing = true, withPanel = false, children,
}: {
  template: FormTemplate;
  values: Record<string, unknown>;
  onChange?: (next: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  editing?: boolean;
  /** Shows the design panel (once per page, where the fields are designed). */
  withPanel?: boolean;
  /** Title around the fields; `title` is the section's (a template may rename it). */
  children?: (fields: ReactNode, title: string) => ReactNode;
}) {
  const { form, designer } = template;
  const title = useGroupTitle(form, 'custom');
  if (!designer && activeCustomFields(form).filter((f) => !f.hidden).length === 0) return null;
  const fields = (
    <ConfigFieldGroup
      form={form}
      group="custom"
      values={values}
      editing={editing}
      onChange={(key, v) => onChange?.({ ...values, [key]: v })}
      errors={errors}
    />
  );
  return (
    <FieldDesignScope designer={withPanel ? designer : null}>
      {withPanel && designer && <FormDesignPanel designer={designer} />}
      <Box>{children ? children(fields, title) : fields}</Box>
    </FieldDesignScope>
  );
}

/** Whether the request has a value in one of the form's shown fields (else the thread shows no section). */
export function hasCustomValues(template: FormTemplate, values: Record<string, unknown> | null | undefined): boolean {
  if (!values) return false;
  return activeCustomFields(template.form).some((f) => !f.hidden && values[f.key] !== undefined && values[f.key] !== null && values[f.key] !== '');
}

/** Checks the values against the saved template (as the API does) and returns what to send, or the errors by field. */
export function checkRequestCustom(template: FormTemplate, values: Record<string, unknown>):
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const value = customValuesToSave(template.savedForm, values);
  const errors = customValuesErrors(template.savedForm, value);
  if (errors.length) return { ok: false, errors: Object.fromEntries(errors.map((e) => [e.field, e.rule])) };
  return { ok: true, value };
}
