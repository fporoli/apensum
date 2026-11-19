import { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import type { CaseCustomField, CustomFieldTarget } from '../shared/cases';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** The organization's custom fields for a case or an assessment (none until its settings define some). */
export function useCustomFields(orgId: string, authHeaders: () => Promise<Record<string, string>>, target: CustomFieldTarget): CaseCustomField[] {
  const [fields, setFields] = useState<CaseCustomField[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/case-custom-fields`, { headers: await authHeaders(), cache: 'no-store' });
        const data = await res.json();
        if (live && data?.ok) setFields((data.fields as CaseCustomField[]).filter((f) => f.target === target));
      } catch {
        /* no custom fields shown */
      }
    })();
    return () => { live = false; };
  }, [orgId, authHeaders, target]);
  return fields;
}

/** Inputs for custom field values. Numbers are kept as numbers and empty inputs as null, as the validation expects. */
export function CustomFieldsForm({ fields, values, onChange, disabled }: {
  fields: CaseCustomField[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });
  return (
    <Stack spacing={2}>
      {fields.map((f) => {
        const v = values[f.key];
        const common = { key: f.key, label: f.label, disabled, fullWidth: true, size: 'small' as const };
        if (f.type === 'select') {
          return (
            <TextField {...common} select value={typeof v === 'string' ? v : ''} onChange={(e) => set(f.key, e.target.value || null)}>
              <MenuItem value="">—</MenuItem>
              {(f.options ?? []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          );
        }
        if (f.type === 'number') {
          return <TextField {...common} type="number" value={typeof v === 'number' ? v : ''} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} />;
        }
        if (f.type === 'date') {
          return <TextField {...common} type="date" InputLabelProps={{ shrink: true }} value={typeof v === 'string' ? v : ''} onChange={(e) => set(f.key, e.target.value || null)} />;
        }
        return (
          <TextField {...common} multiline={f.type === 'longtext'} minRows={f.type === 'longtext' ? 3 : undefined}
            inputProps={{ maxLength: f.type === 'longtext' ? 50_000 : 2000 }}
            value={typeof v === 'string' ? v : ''} onChange={(e) => set(f.key, e.target.value || null)} />
        );
      })}
    </Stack>
  );
}
