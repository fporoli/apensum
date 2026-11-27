import { useState } from 'react';
import {
  Alert, Box, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Menu, MenuItem,
  Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Button } from './Button';
import { useApi } from './useApi';
import { apiRequest } from './apiRequest';
import { useI18n, useT } from './i18n';
import { ConfirmDialog } from './components';
import { AddIcon, ArrowDropDownIcon, DeleteIcon, EditIcon } from './icons';
import { TRIGGER_TEMPLATES, type TriggerTemplate } from '@worktime3/shared/triggerTemplates';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Target = 'department' | 'manager' | 'person';

interface TriggerEvent {
  id: string;
  label: Record<string, string>;
  placeholders: string[];
  /** false: opened as soon as it is known (an exit's steps). */
  defaultLeadDays: number | false;
  sensitive: boolean;
  module: string | null;
  /** Its module is on (and licensed). */
  on: boolean;
  /** The caller changes its triggers (a sensitive one: HR; the others: the Flow-Designer). */
  editable: boolean;
}

interface Trigger {
  id: string;
  event: string;
  enabled: boolean;
  leadDays: number;
  flowType: string | null;
  target: Target;
  departmentId: string | null;
  confidential: boolean;
  label: string | null;
}

interface TriggerList {
  ok: boolean;
  /** The caller changes some triggers. */
  editable: boolean;
  /** The caller designs the flows. */
  designer: boolean;
  events: TriggerEvent[];
  triggers: Trigger[];
  flowTypes: { key: string; label: string; labels: Record<string, string> | null }[];
  departments: { id: string; name: string; code: string | null }[];
}

type Draft = Omit<Trigger, 'id'> & { id: string | null };

/** The department named like HR, preselected; else the first. */
function guessHr(departments: { id: string; name: string }[]): string {
  return (departments.find((d) => /^(hr|human resources|personal|people|ressources humaines|risorse umane)/i.test(d.name)) ?? departments[0])?.id ?? '';
}

/**
 * Auslöser (Admin settings -> Flow-Designer, docs/dev/FLOWS.md): the organization's triggers, each opening a flow when
 * its event comes up (a permit ending, an anniversary, an exit's steps), a number of days ahead, through a flow type's
 * steps or as a Free Flow to a department, to the manager of the person it is about, or to that person. Vorlagen
 * create a trigger with a ready flow type (an e-mail to the person, then done).
 */
export default function FlowTriggers({ orgId, authHeaders, onTypesChanged }: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** A Vorlage added a flow type: the page reloads its types and their steps. */
  onTypesChanged?: () => Promise<void> | void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { data, error, loading, reload, clearError } = useApi<TriggerList>(`${API}/organizations/${orgId}/flow-triggers`, authHeaders);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Trigger | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [template, setTemplate] = useState<TriggerTemplate | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const events = data?.events ?? [];
  const eventOf = (id: string) => events.find((e) => e.id === id);
  const label = (map: Record<string, string> | null | undefined, fallback: string) => map?.[locale] || map?.en || fallback;
  const typeName = (key: string | null) => {
    if (!key) return t('flowTriggers.freeFlow');
    const f = data?.flowTypes.find((x) => x.key === key);
    return f ? label(f.labels, f.label) : key;
  };
  const errorText = (code: string) => {
    const k = `flowTriggers.error.${code}`;
    return t(k) === k ? t('flowTriggers.saveFailed', { error: code }) : t(k);
  };
  const headers = async () => ({ ...(await authHeaders()) });

  async function save(d: Draft) {
    const { id, ...body } = d;
    const res = await apiRequest<{ ok: boolean }>(`${API}/organizations/${orgId}/flow-triggers${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body, headers: await headers() });
    if (!res.ok) return errorText(res.error);
    setDraft(null);
    setMessage({ severity: 'success', text: t('flowTriggers.saved') });
    await reload();
    return null;
  }

  async function toggle(tr: Trigger, enabled: boolean) {
    const { id, ...rest } = tr;
    const res = await apiRequest(`${API}/organizations/${orgId}/flow-triggers/${id}`, { method: 'PUT', body: { ...rest, enabled }, headers: await headers() });
    if (!res.ok) setMessage({ severity: 'error', text: errorText(res.error) });
    await reload();
  }

  async function remove(tr: Trigger) {
    const res = await apiRequest(`${API}/organizations/${orgId}/flow-triggers/${tr.id}`, { method: 'DELETE', headers: await headers() });
    setDeleting(null);
    if (!res.ok) setMessage({ severity: 'error', text: errorText(res.error) });
    await reload();
  }

  const editableEvents = events.filter((e) => e.editable);
  const newDraft = (): Draft => {
    const first = editableEvents.find((e) => e.on) ?? editableEvents[0];
    return {
      id: null, event: first?.id ?? '', enabled: true, leadDays: typeof first?.defaultLeadDays === 'number' ? first.defaultLeadDays : 0,
      flowType: null, target: 'department', departmentId: guessHr(data?.departments ?? []) || null, confidential: true, label: null,
    };
  };

  const when = (tr: Trigger) => (eventOf(tr.event)?.defaultLeadDays === false ? t('flowTriggers.atOnce') : t('flowTriggers.leadDays', { days: String(tr.leadDays) }));
  const to = (tr: Trigger) => {
    if (tr.flowType) return t('flowTriggers.bySteps');
    if (tr.target === 'department') return data?.departments.find((d) => d.id === tr.departmentId)?.name ?? t('flowTriggers.departmentMissing');
    return t(`flowTriggers.target.${tr.target}`);
  };
  // Vorlagen for the events the caller sets up (the API adds their flow type, fixed by the template).
  const templates = TRIGGER_TEMPLATES.filter((tpl) => editableEvents.some((e) => e.id === tpl.event));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">{t('flowTriggers.subtitle')}</Typography>
      {error && <Alert severity="error" onClose={clearError}>{errorText(error)}</Alert>}
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      {/* Every event so far is about people's data (HR's): the Flow-Designer alone sees none of them. */}
      {data && events.length === 0 && <Alert severity="info">{t('flowTriggers.onlySensitive')}</Alert>}
      {data && events.length > 0 && !data.editable && <Alert severity="info">{t('flowTriggers.readOnly')}</Alert>}
      {data?.editable && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} disabled={editableEvents.length === 0} onClick={() => setDraft(newDraft())}>
            {t('flowTriggers.new')}
          </Button>
          {templates.length > 0 && (
            <Button variant="outlined" size="small" endIcon={<ArrowDropDownIcon fontSize="small" />} onClick={(e) => setMenu(e.currentTarget)}>
              {t('flowTriggers.templates')}
            </Button>
          )}
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            {templates.map((tpl) => (
              <MenuItem key={tpl.event} onClick={() => { setMenu(null); setTemplate(tpl); }}>
                {label(tpl.typeName, tpl.typeName.en)}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      )}
      {loading && !data && <LinearProgress />}
      {data && data.triggers.length === 0 && <Typography color="text.secondary">{t('flowTriggers.none')}</Typography>}
      {data && data.triggers.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('flowTriggers.event')}</TableCell>
                <TableCell>{t('flowTriggers.when')}</TableCell>
                <TableCell>{t('flowTriggers.flowType')}</TableCell>
                <TableCell>{t('flowTriggers.target')}</TableCell>
                <TableCell>{t('flowTriggers.confidential')}</TableCell>
                <TableCell>{t('flowTriggers.enabled')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.triggers.map((tr) => {
                const ev = eventOf(tr.event);
                return (
                  // A trigger whose module is off does not run: shown greyed out.
                  <TableRow key={tr.id} sx={{ opacity: ev?.on === false ? 0.5 : 1 }}>
                    <TableCell>
                      <Typography variant="body2">{tr.label || label(ev?.label, tr.event)}</Typography>
                      {tr.label && <Typography variant="caption" color="text.secondary">{label(ev?.label, tr.event)}</Typography>}
                      {ev?.on === false && <Chip size="small" variant="outlined" label={t('flowTriggers.moduleOff')} sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{when(tr)}</TableCell>
                    <TableCell>{typeName(tr.flowType)}</TableCell>
                    <TableCell>{to(tr)}</TableCell>
                    <TableCell>{tr.confidential ? t('flowTriggers.yes') : t('flowTriggers.no')}</TableCell>
                    <TableCell>
                      <Switch size="small" checked={tr.enabled} disabled={!ev?.editable} onChange={(e) => void toggle(tr, e.target.checked)}
                        slotProps={{ input: { 'aria-label': t('flowTriggers.enabled') } }} />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {ev?.editable && (
                        <>
                          <Tooltip title={t('flowTriggers.edit')}>
                            <IconButton size="small" aria-label={t('flowTriggers.edit')} onClick={() => setDraft({ ...tr })}><EditIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title={t('flowTriggers.delete')}>
                            <IconButton size="small" aria-label={t('flowTriggers.delete')} onClick={() => setDeleting(tr)}><DeleteIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
      {draft && data && (
        <TriggerDialog draft={draft} list={data} onClose={() => setDraft(null)} onSave={save} label={label} />
      )}
      {template && data && (
        <TemplateDialog
          tpl={template} orgId={orgId} list={data} authHeaders={authHeaders} label={label} errorText={errorText}
          onClose={() => setTemplate(null)}
          onDone={async (name) => {
            setTemplate(null);
            setMessage({ severity: 'success', text: t('flowTriggers.templateDone', { name }) });
            await onTypesChanged?.();
            await reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('flowTriggers.delete')}
        message={t('flowTriggers.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </Box>
  );
}

/** Adds or changes a trigger. */
function TriggerDialog({ draft: initial, list, onClose, onSave, label }: {
  draft: Draft; list: TriggerList; onClose: () => void; onSave: (d: Draft) => Promise<string | null>;
  label: (map: Record<string, string> | null | undefined, fallback: string) => string;
}) {
  const t = useT();
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ev = list.events.find((e) => e.id === d.event);
  const free = !d.flowType;
  const needsDepartment = free && d.target === 'department';
  const valid = !!ev && (!needsDepartment || !!d.departmentId) && Number.isInteger(d.leadDays) && d.leadDays >= 0 && d.leadDays <= 365;

  async function submit() {
    setBusy(true);
    setError(await onSave({ ...d, departmentId: needsDepartment || d.flowType ? d.departmentId : null }));
    setBusy(false);
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t(initial.id ? 'flowTriggers.edit' : 'flowTriggers.new')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField select size="small" label={t('flowTriggers.event')} value={d.event}
          onChange={(e) => {
            const next = list.events.find((x) => x.id === e.target.value);
            setD({ ...d, event: e.target.value, leadDays: typeof next?.defaultLeadDays === 'number' && !initial.id ? next.defaultLeadDays : d.leadDays });
          }}
          helperText={ev ? t('flowTriggers.placeholders', { list: ev.placeholders.map((p) => `{{${p}}}`).join(' ') }) : undefined}>
          {list.events.filter((e) => e.editable).map((e) => <MenuItem key={e.id} value={e.id} disabled={!e.on}>{label(e.label, e.id)}{e.on ? '' : ` (${t('flowTriggers.moduleOff')})`}</MenuItem>)}
        </TextField>
        {ev?.defaultLeadDays === false ? (
          <Typography variant="body2" color="text.secondary">{t('flowTriggers.atOnceHint')}</Typography>
        ) : (
          <TextField type="number" size="small" label={t('flowTriggers.lead')} value={d.leadDays}
            slotProps={{ htmlInput: { min: 0, max: 365, step: 1 } }} onChange={(e) => setD({ ...d, leadDays: Math.round(Number(e.target.value)) })} />
        )}
        <TextField select size="small" label={t('flowTriggers.flowType')} value={d.flowType ?? ''} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          onChange={(e) => setD({ ...d, flowType: e.target.value || null })}
          helperText={t(list.flowTypes.length ? 'flowTriggers.flowTypeHint' : 'flowTriggers.flowTypeNone')}>
          <MenuItem value=""><em>{t('flowTriggers.freeFlow')}</em></MenuItem>
          {list.flowTypes.map((f) => <MenuItem key={f.key} value={f.key}>{label(f.labels, f.label)}</MenuItem>)}
          {d.flowType && !list.flowTypes.some((f) => f.key === d.flowType) && <MenuItem value={d.flowType}>{d.flowType}</MenuItem>}
        </TextField>
        {free && (
          <TextField select size="small" label={t('flowTriggers.target')} value={d.target} onChange={(e) => setD({ ...d, target: e.target.value as Target })}>
            {(['department', 'manager', 'person'] as const).map((x) => <MenuItem key={x} value={x}>{t(`flowTriggers.target.${x}`)}</MenuItem>)}
          </TextField>
        )}
        {needsDepartment && (
          <TextField select size="small" label={t('flowTriggers.department')} value={d.departmentId ?? ''} onChange={(e) => setD({ ...d, departmentId: e.target.value || null })}>
            {list.departments.map((x) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
          </TextField>
        )}
        <TextField size="small" label={t('flowTriggers.label')} value={d.label ?? ''} slotProps={{ htmlInput: { maxLength: 100 } }}
          onChange={(e) => setD({ ...d, label: e.target.value || null })} />
        <Box>
          <FormControlLabel control={<Checkbox size="small" checked={d.confidential} onChange={(e) => setD({ ...d, confidential: e.target.checked })} />}
            label={<Typography variant="body2">{t('flowTriggers.confidential')}</Typography>} />
          <Typography variant="caption" color="text.secondary" component="div">{t('flowTriggers.confidentialHint')}</Typography>
        </Box>
        <FormControlLabel control={<Switch size="small" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />}
          label={<Typography variant="body2">{t('flowTriggers.enabled')}</Typography>} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !valid} onClick={() => void submit()}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Creates a Vorlage (POST flow-triggers/templates): its flow type (an e-mail to the person from the template, to the
 * chosen department, then done) and the event's trigger, or points the event's existing trigger to the type.
 */
function TemplateDialog({ tpl, orgId, list, authHeaders, label, errorText, onClose, onDone }: {
  tpl: TriggerTemplate; orgId: string; list: TriggerList; authHeaders: () => Promise<Record<string, string>>;
  label: (map: Record<string, string> | null | undefined, fallback: string) => string; errorText: (code: string) => string;
  onClose: () => void; onDone: (name: string) => Promise<void>;
}) {
  const t = useT();
  // The step goes to a department by its code (`department:<code>`): only those with one.
  const departments = list.departments.filter((d) => d.code);
  const [departmentId, setDepartmentId] = useState(guessHr(departments));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = label(tpl.typeName, tpl.typeName.en);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await apiRequest(`${API}/organizations/${orgId}/flow-triggers/templates`, {
      method: 'POST', headers: await authHeaders(), body: { event: tpl.event, departmentId },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.error));
      return;
    }
    await onDone(name);
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('flowTriggers.templateTitle', { name })}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="body2">{t('flowTriggers.templateHint', { type: name })}</Typography>
        {list.triggers.some((x) => x.event === tpl.event) && <Alert severity="info">{t('flowTriggers.templateReplaces')}</Alert>}
        {departments.length === 0 ? (
          <Alert severity="warning">{t('flowTriggers.templateNeedsCode')}</Alert>
        ) : (
          <TextField select size="small" label={t('flowTriggers.templateDepartment')} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !departmentId} onClick={() => void create()}>{t('flowTriggers.create')}</Button>
      </DialogActions>
    </Dialog>
  );
}
