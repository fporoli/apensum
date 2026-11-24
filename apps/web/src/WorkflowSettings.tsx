import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, TextField, Typography } from '@mui/material';
import {
  validateWorkflowConfig, type FactType, type RejectMode, type WorkflowConfig, type WorkflowConfigError, type WorkflowKindCatalogue,
} from '@worktime3/shared/workflowConfig';
import { useT } from './i18n';
import { ConfirmDialog, PageHeader } from './components';
import { RestartAltIcon, SaveIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface KindInfo {
  id: string;
  blocks: Record<string, { assignees: string[]; label: string; once: boolean; last: boolean; after: string[]; canReturn: boolean }>;
  facts: Record<string, FactType>;
  rejectModes: RejectMode[];
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
    defaultConfig: kind.defaultConfig,
    blocks: Object.fromEntries(Object.entries(kind.blocks).map(([name, b]) => [name, {
      label: b.label, assignees: b.assignees, once: b.once, last: b.last, after: b.after, action: name, ...(b.canReturn ? { returnAction: name } : {}),
    }])),
  };
}

const pretty = (config: WorkflowConfig) => JSON.stringify(config, null, 2);

/**
 * Admin settings -> Workflows: each configurable kind's steps as a checked JSON document (shared/workflowConfig.ts),
 * with the blocks, assignees and facts the kind offers. Admins read it; only an owner saves or goes back to the
 * default. Running workflows keep their steps.
 */
export default function WorkflowSettings({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useT();
  const [kinds, setKinds] = useState<KindInfo[]>([]);
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/workflow-configs`, { headers: await authHeaders() })).json();
      setKinds(Array.isArray(data?.kinds) ? data.kinds : []);
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
        <KindEditor key={kind.id} orgId={orgId} kind={kind} editable={editable} authHeaders={authHeaders} onSaved={load} />
      ))}
      {kinds.length === 0 && !error && <Typography color="text.secondary">{t('workflowConfig.none')}</Typography>}
    </Box>
  );
}

function KindEditor({ orgId, kind, editable, authHeaders, onSaved }: {
  orgId: string; kind: KindInfo; editable: boolean; authHeaders: () => Promise<Record<string, string>>; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [text, setText] = useState(pretty(kind.config ?? kind.defaultConfig));
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
      const res = await fetch(`${API}/organizations/${orgId}/workflow-configs/${encodeURIComponent(kind.id)}`, {
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
  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t(`workflowConfig.kind.${kind.id}`)}</Typography>
        <Chip size="small" color={kind.config ? 'primary' : 'default'} label={t(kind.config ? 'workflowConfig.own' : 'workflowConfig.default')} />
      </Box>
      <Typography variant="body2" color="text.secondary">{t('workflowConfig.runningKeep')}</Typography>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
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
      {checked.jsonError && <Alert severity="error">{t('workflowConfig.invalidJson', { message: checked.jsonError })}</Alert>}
      {errors.length > 0 && (
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
            <Button startIcon={<RestartAltIcon />} disabled={busy} onClick={() => setConfirmReset(true)}>{t('workflowConfig.reset')}</Button>
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
                {b.canReturn && <> · {t('workflowConfig.help.canReturn')}</>}
              </li>
            ))}
          </Box>
          <Typography variant="subtitle2">{t('workflowConfig.help.facts')}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {Object.entries(kind.facts).map(([name, type]) => <li key={name}><code>{name}</code> — {t(`workflowConfig.factType.${type}`)}</li>)}
          </Box>
          <Typography variant="body2">{t('workflowConfig.help.reject')}</Typography>
          <Typography variant="body2" component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: '0.78rem' }}>
            {'{ "key": "finance", "do": ["review"], "assignTo": "permission:nav.expensePayout",\n  "when": { "all": [ { "total": { "gt": 500 } }, { "not": { "requester.management": true } } ] },\n  "reject": "back", "label": { "de": "Prüfung Finanzen" } }'}
          </Typography>
        </Box>
      </Box>
      <ConfirmDialog
        open={confirmReset}
        title={t('workflowConfig.reset')}
        message={t('workflowConfig.resetConfirm')}
        confirmLabel={t('workflowConfig.reset')}
        cancelLabel={t('common.cancel')}
        confirmColor="warning"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); void save(null); }}
      />
    </Paper>
  );
}
