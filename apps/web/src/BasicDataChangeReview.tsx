import { useEffect, useState } from 'react';
import { Alert, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { BASICDATA_FORM } from '@worktime3/shared/fields';
import { staticValueLabel, type StaticDataRowLike as StaticDataRow } from '@worktime3/shared/staticData';
import { Button } from './Button';
import { useI18n } from './i18n';
import { formatLocaleDate } from './localeFormat';
import { apiRequest } from './apiRequest';
import type { PluginWorkflowInspectProps } from './plugin';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** A registry list (`FieldDef.options`) and its static data (entity `users`). */
const LIST_ENUMS: Record<string, string> = {
  genders: 'genders', residencePermits: 'residence_permits', civilStatuses: 'civil_statuses', countries: 'countries', locales: 'locales',
};
/** Nested values' captions (the registry does not describe them). */
const NESTED_CAPTIONS: Record<string, string> = {
  bankAccounts: 'home.section.bank', emergencyContacts: 'home.section.emergencyContacts', partner: 'home.section.partner', children: 'home.section.children',
};

interface Loaded {
  current: Record<string, unknown>;
  requested: Record<string, unknown>;
  lists: StaticDataRow[];
}

/**
 * A change of personal data on the Flows page ("Inspect"): each field it changes, what is stored now and what the
 * person asks for, in the sections the caller may see (GET .../basicdata), with approve and reject for the step.
 */
export default function BasicDataChangeReview({ open, orgId, authHeaders, record, actionItemId, step, onClose, onApprove, onReject }: PluginWorkflowInspectProps & { open: boolean }) {
  const { t, locale } = useI18n();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = String(record.user_id ?? record.id);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    void (async () => {
      const headers = await authHeaders();
      const [data, lists] = await Promise.all([
        apiRequest<{ basicdata?: Record<string, unknown>; pending?: { data?: Record<string, unknown> } | null }>(`${API}/organizations/${orgId}/users/${userId}/basicdata`, { headers }),
        apiRequest<StaticDataRow[]>(`${API}/organizations/${orgId}/static-data/users`, { headers }),
      ]);
      if (cancelled) return;
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setLoaded({ current: data.data.basicdata ?? {}, requested: data.data.pending?.data ?? {}, lists: lists.ok && Array.isArray(lists.data) ? lists.data : [] });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId, userId]);

  const caption = (key: string) => {
    const k = NESTED_CAPTIONS[key] ?? `home.field.${key}`;
    return t(k) === k ? key : t(k);
  };
  const shown = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.map((v) => shown(key, v)).join('; ') || '—';
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).filter((v) => v !== null && v !== '').map(String).join(', ') || '—';
    const field = BASICDATA_FORM.fields.find((f) => f.key === key);
    if (field?.type === 'date' && typeof value === 'string') return formatLocaleDate(value, locale);
    const list = field?.options ? loaded?.lists.find((r) => r.enum_name === LIST_ENUMS[field.options!]) : undefined;
    return list ? staticValueLabel(list, locale, String(value)) : String(value);
  };
  const keys = loaded ? Object.keys(loaded.requested) : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('basicdataChange.title', { name: String(record.user_display_name ?? '') })}</DialogTitle>
      <DialogContent dividers>
        {!loaded && !error && <LinearProgress />}
        {error && <Alert severity="error">{t('basicdataChange.loadFailed')}</Alert>}
        {loaded && keys.length === 0 && <Typography color="text.secondary">{t('basicdataChange.nothing')}</Typography>}
        {loaded && keys.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('basicdataChange.field')}</TableCell>
                <TableCell>{t('basicdataChange.current')}</TableCell>
                <TableCell>{t('basicdataChange.requested')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k}>
                  <TableCell sx={{ fontWeight: 600 }}>{caption(k)}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{shown(k, loaded.current[k])}</TableCell>
                  <TableCell>{shown(k, loaded.requested[k])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        {actionItemId && (
          <>
            {step?.rejectable !== false && <Button color="error" onClick={() => onReject(actionItemId)}>{t('approvals.reject')}…</Button>}
            <Button variant="contained" onClick={() => onApprove(actionItemId)}>{t(step?.actionKey ?? 'approvals.approve')}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
