import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Tab, Tabs, TextField, Typography } from '@mui/material';
import { WorkflowDesigner } from './WorkflowDesigner';
import {
  validateWorkflowConfig, type FactType, type RejectMode, type WorkflowConfig, type WorkflowConfigError, type WorkflowKindCatalogue,
} from '@worktime3/shared/workflowConfig';
import { useI18n, useT } from './i18n';
import { ConfirmDialog, PageHeader } from './components';
import { AddIcon, ContentCopyIcon, DeleteIcon, RestartAltIcon, SaveIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface KindInfo {
  id: string;
  /** A kind with variants (request types) has one entry per variant; without its own configuration it has no workflow. */
  variant: string | null;
  variantLabel: string | null;
  variantLabels: Record<string, string> | null;
  optional: boolean;
  blocks: Record<string, { assignees: string[]; label: string; once: boolean; last: boolean; after: string[]; canReturn: boolean; required?: boolean; fields?: boolean; automatic?: boolean; message?: boolean }>;
  facts: Record<string, FactType>;
  rejectModes: RejectMode[];
  /** Its steps may go to everyone of a unit, each on their own. */
  each?: boolean;
  /** false: the first step may be work and have a condition (a payment run). */
  firstStepDecides?: boolean;
  defaultConfig: WorkflowConfig;
  config: WorkflowConfig | null;
}

/** The catalogue as the shared checker needs it (the actions' names don't matter in the browser). */
function catalogueOf(kind: KindInfo): WorkflowKindCatalogue {
  return {
    id: kind.id,
    definitionName: kind.id,
    facts: kind.facts,
    rejectModes: kind.rejectModes,
    firstStepDecides: kind.firstStepDecides !== false,
    each: !!kind.each,
    defaultConfig: kind.defaultConfig,
    blocks: Object.fromEntries(Object.entries(kind.blocks).map(([name, b]) => [name, {
      label: b.label, assignees: b.assignees, once: b.once, last: b.last, after: b.after, required: b.required, ...(b.fields ? { fields: true } : {}), ...(b.automatic ? { automatic: true } : {}), ...(b.message ? { message: true } : {}), action: name, ...(b.canReturn ? { returnAction: name } : {}),
    }])),
  };
}

const pretty = (config: WorkflowConfig) => JSON.stringify(config, null, 2);

/** A step to copy into the configuration, fitting the kind (its blocks and facts). */
function exampleOf(kind: KindInfo): string {
  if (kind.id === 'requests.request') {
    return JSON.stringify({ key: 'order', do: ['task'], assignTo: 'department:frontdesk', when: { urgent: true }, reject: 'back', label: { de: 'Bestellen', en: 'Order' } }, null, 2);
  }
  return JSON.stringify({
    key: 'finance', do: ['review'], assignTo: 'permission:nav.expensePayout',
    when: { all: [{ total: { gt: 500 } }, { not: { 'requester.management': true } }] }, reject: 'back', label: { de: 'Prüfung Finanzen', en: 'Finance review' },
  }, null, 2);
}

interface Units {
  departments: { code: string | null; name: string }[];
  teams: { code: string | null; name: string }[];
  people: { id: string; name: string | null; email: string }[];
}

/** Copies a text, with a short "copied" on the button. */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      startIcon={<ContentCopyIcon fontSize="small" />}
      onClick={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}
    >
      {copied ? t('workflowConfig.copied') : label ?? t('workflowConfig.copy')}
    </Button>
  );
}

/**
 * Admin settings -> Workflows: each configurable kind's steps as a checked JSON document (shared/workflowConfig.ts),
 * with the blocks, assignees and facts the kind offers. Admins read it; only an owner saves or goes back to the
 * default. Running workflows keep their steps.
 */
export default function WorkflowSettings({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useT();
  const [kinds, setKinds] = useState<KindInfo[]>([]);
  const [units, setUnits] = useState<Units>({ departments: [], teams: [], people: [] });
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/workflow-configs`, { headers: await authHeaders() })).json();
      setKinds(Array.isArray(data?.kinds) ? data.kinds : []);
      setUnits({ departments: data?.units?.departments ?? [], teams: data?.units?.teams ?? [], people: data?.units?.people ?? [] });
      setEditable(data?.editable === true);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }, [orgId, authHeaders, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('workflowConfig.title')} subtitle={t('workflowConfig.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {!editable && kinds.length > 0 && <Alert severity="info">{t('workflowConfig.ownerOnly')}</Alert>}
      {kinds.map((kind) => (
        <KindEditor key={`${kind.id}:${kind.variant ?? ''}`} orgId={orgId} kind={kind} units={units} editable={editable} authHeaders={authHeaders} onSaved={load} />
      ))}
      {kinds.length === 0 && !error && <Typography color="text.secondary">{t('workflowConfig.none')}</Typography>}
    </Box>
  );
}

function KindEditor({ orgId, kind, units, editable, authHeaders, onSaved }: {
  orgId: string; kind: KindInfo; units: Units; editable: boolean; authHeaders: () => Promise<Record<string, string>>; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const { locale } = useI18n();
  // A request type without a workflow shows the editor only once someone starts one.
  const [opened, setOpened] = useState(!kind.optional || !!kind.config);
  useEffect(() => { setOpened(!kind.optional || !!kind.config); }, [kind]);
  const title = kind.variant
    ? t('workflowConfig.variantTitle', { kind: t(`workflowConfig.kind.${kind.id}`), variant: kind.variantLabels?.[locale] ?? kind.variantLabel ?? kind.variant })
    : t(`workflowConfig.kind.${kind.id}`);
  const [text, setText] = useState(pretty(kind.config ?? kind.defaultConfig));
  // The designer and the JSON edit the same text: the designer reads it and writes it back.
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<WorkflowConfigError[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { setText(pretty(kind.config ?? kind.defaultConfig)); }, [kind]);

  // Checked while typing, with the same rules the API applies.
  const checked = useMemo((): { parsed: unknown; errors: WorkflowConfigError[]; jsonError: string | null } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { parsed: null, errors: [], jsonError: e instanceof Error ? e.message : String(e) };
    }
    const r = validateWorkflowConfig(catalogueOf(kind), parsed);
    return { parsed, errors: r.ok ? [] : r.errors, jsonError: null };
  }, [text, kind]);
  const errors = checked.jsonError ? [] : serverErrors.length ? serverErrors : checked.errors;
  const errorText = (e: WorkflowConfigError) => {
    const key = `workflowConfig.error.${e.code}`;
    return `${e.path || '/'}: ${t(key) === key ? e.code : t(key)}`;
  };

  async function save(config: unknown | null) {
    setBusy(true);
    setMessage(null);
    setServerErrors([]);
    try {
      const variant = kind.variant ? `?variant=${encodeURIComponent(kind.variant)}` : '';
      const res = await fetch(`${API}/organizations/${orgId}/workflow-configs/${encodeURIComponent(kind.id)}${variant}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!data?.ok) {
        if (Array.isArray(data?.errors)) setServerErrors(data.errors);
        setMessage({ severity: 'error', text: data?.error === 'forbidden' ? t('workflowConfig.ownerOnly') : t('workflowConfig.saveFailed') });
        return;
      }
      setMessage({ severity: 'success', text: t(config === null ? 'workflowConfig.resetDone' : 'workflowConfig.saved') });
      await onSaved();
    } catch {
      setMessage({ severity: 'error', text: t('common.cannotReachApi') });
    } finally {
      setBusy(false);
    }
  }

  const changed = text !== pretty(kind.config ?? kind.defaultConfig);
  // What the designer can show: a parsed object with a list of steps (anything else is fixed in the JSON first).
  const designable = (() => {
    const p = checked.parsed as Partial<WorkflowConfig> | null;
    return p && typeof p === 'object' && Array.isArray(p.steps) && p.steps.every((x) => x && typeof x === 'object' && Array.isArray((x as { do?: unknown }).do))
      ? (p as WorkflowConfig) : null;
  })();
  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{title}</Typography>
        <Chip size="small" color={kind.config ? 'primary' : 'default'} label={t(kind.config ? 'workflowConfig.own' : kind.optional ? 'workflowConfig.noWorkflow' : 'workflowConfig.default')} />
      </Box>
      {!opened && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t('workflowConfig.noWorkflowHint')}</Typography>
          {editable && <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => setOpened(true)}>{t('workflowConfig.create')}</Button>}
        </Box>
      )}
      {opened && (<>
      <Typography variant="body2" color="text.secondary">{t('workflowConfig.runningKeep')}</Typography>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
      <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}>
        <Tab value="visual" label={t('workflowDesigner.visual')} />
        <Tab value="json" label="JSON" />
      </Tabs>
      {mode === 'visual' && designable && (
        <WorkflowDesigner
          kind={kind}
          units={units}
          config={designable}
          errors={errors}
          editable={editable}
          onChange={(next) => { setText(pretty(next)); setServerErrors([]); }}
        />
      )}
      {mode === 'visual' && !designable && <Alert severity="warning">{t('workflowDesigner.fixJsonFirst')}</Alert>}
      {mode === 'json' && (
        <TextField
          multiline
          minRows={8}
          maxRows={28}
          value={text}
          onChange={(e) => { setText(e.target.value); setServerErrors([]); }}
          InputProps={{ readOnly: !editable, sx: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
          inputProps={{ spellCheck: false, 'aria-label': t(`workflowConfig.kind.${kind.id}`) }}
          error={!!checked.jsonError || errors.length > 0}
        />
      )}
      {checked.jsonError && <Alert severity="error">{t('workflowConfig.invalidJson', { message: checked.jsonError })}</Alert>}
      {mode === 'json' && errors.length > 0 && (
        <Alert severity="error">
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{errors.map((e, i) => <li key={i}>{errorText(e)}</li>)}</Box>
        </Alert>
      )}
      {!checked.jsonError && errors.length === 0 && changed && <Alert severity="success">{t('workflowConfig.valid')}</Alert>}
      {editable && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={busy || !changed || !!checked.jsonError || errors.length > 0} onClick={() => void save(checked.parsed)}>
            {t('workflowConfig.save')}
          </Button>
          {kind.config && (
            <Button startIcon={kind.optional ? <DeleteIcon /> : <RestartAltIcon />} disabled={busy} onClick={() => setConfirmReset(true)}>
              {t(kind.optional ? 'workflowConfig.remove' : 'workflowConfig.reset')}
            </Button>
          )}
        </Box>
      )}
      <Box component="details" sx={{ '& summary': { cursor: 'pointer', fontWeight: 600 } }}>
        <summary>{t('workflowConfig.help.title')}</summary>
        <Box sx={{ display: 'grid', gap: 1, mt: 1, fontSize: '0.875rem' }}>
          <Typography variant="body2">{t('workflowConfig.help.steps')}</Typography>
          <Typography variant="subtitle2">{t('workflowConfig.help.blocks')}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {Object.entries(kind.blocks).map(([name, b]) => (
              <li key={name}>
                <code>{name}</code> ({b.label}) — {t('workflowConfig.help.assignees')}: {b.assignees.map((a) => (a === 'department' ? 'department:<id>' : a)).join(', ')}
                {b.after.length > 0 && <> · {t('workflowConfig.help.after', { blocks: b.after.join(', ') })}</>}
                {b.once && <> · {t('workflowConfig.help.once')}</>}
                {b.last && <> · {t('workflowConfig.help.last')}</>}
                {b.required && <> · {t('workflowConfig.help.required')}</>}
                {b.canReturn && <> · {t('workflowConfig.help.canReturn')}</>}
              </li>
            ))}
          </Box>
          <Typography variant="subtitle2">{t('workflowConfig.help.facts')}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {Object.entries(kind.facts).map(([name, type]) => <li key={name}><code>{name}</code> — {t(`workflowConfig.factType.${type}`)}</li>)}
          </Box>
          <Typography variant="body2">{t('workflowConfig.help.reject')}</Typography>
          {(units.departments.length > 0 || units.teams.length > 0) && (
            <>
              <Typography variant="subtitle2">{t('workflowConfig.help.units')}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {[...units.departments.map((d) => ({ ...d, prefix: 'department' })), ...units.teams.map((x) => ({ ...x, prefix: 'team' }))]
                  .filter((u) => u.code)
                  .map((u) => (
                    <Chip
                      key={`${u.prefix}:${u.code}`}
                      size="small"
                      variant="outlined"
                      label={`${u.prefix}:${u.code} · ${u.name}`}
                      onClick={() => void navigator.clipboard.writeText(`${u.prefix}:${u.code}`).catch(() => {})}
                      sx={{ fontFamily: 'monospace' }}
                    />
                  ))}
              </Box>
              <Typography variant="caption" color="text.secondary">{t('workflowConfig.help.unitsCopy')}</Typography>
            </>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('workflowConfig.help.example')}</Typography>
            <CopyButton text={exampleOf(kind)} />
          </Box>
          <Typography variant="body2" component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: '0.78rem' }}>
            {exampleOf(kind)}
          </Typography>
        </Box>
      </Box>
      </>)}
      <ConfirmDialog
        open={confirmReset}
        title={t(kind.optional ? 'workflowConfig.remove' : 'workflowConfig.reset')}
        message={t(kind.optional ? 'workflowConfig.removeConfirm' : 'workflowConfig.resetConfirm')}
        confirmLabel={t(kind.optional ? 'workflowConfig.remove' : 'workflowConfig.reset')}
        cancelLabel={t('common.cancel')}
        confirmColor="warning"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); void save(null); }}
      />
    </Paper>
  );
}
