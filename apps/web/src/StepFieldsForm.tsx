// The fields a workflow step asks whoever does it (a block with `fields`, e.g. a request's "form"): the inputs on the
// Workflow and Requests pages, and the answers as the request's thread shows them. The values are checked by the
// shared `stepFieldValues` in the browser and again by the API.
import { Box, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { stepFieldLabel, type StepField } from '@worktime3/shared/workflowConfig';
import { useI18n } from './i18n';
import { formatLocaleDate, formatLocaleNumber } from './localeFormat';

export type StepValues = Record<string, string | boolean>;

export function StepFieldsForm({ fields, values, onChange, disabled }: {
  fields: readonly StepField[];
  values: StepValues;
  onChange: (values: StepValues) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {fields.map((f) => {
        const label = `${stepFieldLabel(f, locale)}${f.required ? ' *' : ''}`;
        if (f.type === 'checkbox') {
          return (
            <FormControlLabel key={f.key} disabled={disabled}
              control={<Checkbox size="small" checked={values[f.key] === true} onChange={(e) => onChange({ ...values, [f.key]: e.target.checked })} />}
              label={<Typography variant="body2">{label}</Typography>} />
          );
        }
        return (
          <TextField key={f.key} size="small" label={label} disabled={disabled}
            type={f.type === 'date' ? 'date' : 'text'}
            inputProps={f.type === 'number' ? { inputMode: 'decimal' } : { maxLength: 500 }}
            InputLabelProps={f.type === 'date' ? { shrink: true } : undefined}
            value={typeof values[f.key] === 'string' ? values[f.key] : ''}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            sx={{ minWidth: f.type === 'text' ? 240 : 150 }} />
        );
      })}
    </Box>
  );
}

/** One answer as the thread shows it. */
export interface StepAnswer {
  key: string;
  type: StepField['type'];
  label: StepField['label'];
  value: string | number | boolean;
}

export function formatStepAnswer(a: Pick<StepAnswer, 'type' | 'value'>, locale: string, yes: string): string {
  if (a.type === 'number' && typeof a.value === 'number') return formatLocaleNumber(a.value, locale);
  if (a.type === 'date' && typeof a.value === 'string') return formatLocaleDate(a.value, locale);
  if (a.type === 'checkbox') return a.value === true ? yes : '';
  return String(a.value);
}

/** The answers of one step, "Amount: 20 · Note: …". */
export function StepAnswers({ answers, yes }: { answers: readonly StepAnswer[]; yes: string }) {
  const { locale } = useI18n();
  return (
    <Typography variant="caption" color="text.secondary" component="div">
      {answers.map((a) => `${stepFieldLabel({ key: a.key, type: a.type, label: a.label }, locale)}: ${formatStepAnswer(a, locale, yes)}`).join(' · ')}
    </Typography>
  );
}
