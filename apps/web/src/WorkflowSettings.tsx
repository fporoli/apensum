import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Paper, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { Button } from './Button';
import { FLOW_TYPE_KEY, MAX_FLOW_TYPE_NAME, flowTypeKeyFromName } from '@worktime3/shared/flows';
import { WorkflowDesigner } from './WorkflowDesigner';
import {
  validateWorkflowConfig, type FactType, type RejectMode, type WorkflowConfig, type WorkflowConfigError, type WorkflowKindCatalogue,
} from '@worktime3/shared/workflowConfig';
import { useI18n, useT } from './i18n';
import { ConfirmDialog, PageHeader } from './components';
import { AddIcon, ContentCopyIcon, DeleteIcon, EditIcon, RestartAltIcon, SaveIcon, AccountTreeIcon, CodeIcon, BoltIcon, CloseIcon, ExpandLessIcon, ExpandMoreIcon } from './icons';
import FlowTriggers from './FlowTriggers';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface KindInfo {
  id: string;
  /** A kind with variants (request types) has one entry per variant; without its own configuration it has no workflow. */
  variant: string | null;
  variantLabel: string | null;
  variantLabels: Record<string, string> | null;
  optional: boolean;
  blocks: Record<string, { assignees: string[]; label: string; once: boolean; last: boolean; after: string[]; canReturn: boolean; required?: boolean; fields?: boolean; automatic?: boolean; message?: boolean; compose?: boolean }>;
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
      label: b.label, assignees: b.assignees, once: b.once, last: b.last, after: b.after, required: b.required, ...(b.fields ? { fields: true } : {}), ...(b.automatic ? { automatic: true } : {}), ...(b.message ? { message: true } : {}), ...(b.compose ? { compose: true } : {}), action: name, ...(b.canReturn ? { returnAction: name } : {}),
    }])),
  };
}

const pretty = (config: WorkflowConfig) => JSON.stringify(config, null, 2);

/** A step to copy into the configuration, fitting the kind (its blocks and facts). */
function exampleOf(kind: KindInfo): string {
  if (kind.id === 'flows.flow') {
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
  holders?: Record<string, string[]>;
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
  // The organization's flow types: added or renamed here, so a new type gets its steps on the same page.
  const [flowTypes, setFlowTypes] = useState<FlowType[]>([]);
  const [typeDialog, setTypeDialog] = useState<{ isNew: boolean; type: FlowType } | null>(null);
  // Flow types and their steps, or the triggers that open flows (Auslöser); `#/admin/workflows?tab=triggers` opens those.
  const [tab, setTab] = useState<'types' | 'triggers'>(() =>
    new URLSearchParams(typeof window === 'undefined' ? '' : window.location.hash.split('?')[1] ?? '').get('tab') === 'triggers' ? 'triggers' : 'types');

  const load = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/workflow-configs`, { headers: await authHeaders() })).json();
      setKinds(Array.isArray(data?.kinds) ? data.kinds : []);
      setUnits({ departments: data?.units?.departments ?? [], teams: data?.units?.teams ?? [], people: data?.units?.people ?? [], holders: data?.units?.holders ?? {} });
      setEditable(data?.editable === true);
      setFlowTypes(Array.isArray(data?.flowTypes) ? data.flowTypes : []);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }, [orgId, authHeaders, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('workflowConfig.title')}
        subtitle={t('workflowConfig.subtitle')}
        end={tab === 'types' && editable && kinds.some((k) => k.id === FLOWS_KIND) ? (
          <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => setTypeDialog({ isNew: true, type: { key: '', names: {}, confidential: false } })}>
            {t('workflowConfig.flowType.new')}
          </Button>
        ) : undefined}
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="types" icon={<AccountTreeIcon />} label={t('workflowConfig.tab.types')} />
        <Tab value="triggers" icon={<BoltIcon />} label={t('flowTriggers.tab')} />
      </Tabs>
      {tab === 'triggers' && (
        <FlowTriggers orgId={orgId} authHeaders={authHeaders} onTypesChanged={load} />
      )}
      {tab === 'types' && error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {tab === 'types' && !editable && kinds.length > 0 && <Alert severity="info">{t('workflowConfig.ownerOnly')}</Alert>}
      {tab === 'types' && kinds.map((kind) => (
        <KindEditor
          key={`${kind.id}:${kind.variant ?? ''}`} orgId={orgId} kind={kind} units={units} editable={editable} authHeaders={authHeaders} onSaved={load}
          onRename={editable && kind.id === FLOWS_KIND && kind.variant ? () => {
            const type = flowTypes.find((f) => f.key === kind.variant);
            if (type) setTypeDialog({ isNew: false, type });
          } : undefined}
        />
      ))}
      {tab === 'types' && kinds.length === 0 && !error && <Typography color="text.secondary">{t('workflowConfig.none')}</Typography>}
      {typeDialog && (
        <FlowTypeDialog
          orgId={orgId} authHeaders={authHeaders} isNew={typeDialog.isNew} type={typeDialog.type} taken={flowTypes.map((f) => f.key)}
          onClose={() => setTypeDialog(null)} onSaved={async () => { setTypeDialog(null); await load(); }}
        />
      )}
    </Box>
  );
}

/** The kind of the organization's flow types (one configuration per type). */
const FLOWS_KIND = 'flows.flow';

/** One of the organization's flow types (static data flows/flow_type). */
interface FlowType {
  key: string;
  names: Record<string, string>;
  confidential: boolean;
}

const TYPE_LANGS = ['de', 'fr', 'it', 'en'] as const;

/** Adds a flow type or renames one: its name per language, its key (from the name, new types only), confidential. */
function FlowTypeDialog({ orgId, authHeaders, isNew, type, taken, onClose, onSaved }: {
  orgId: string; authHeaders: () => Promise<Record<string, string>>; isNew: boolean; type: FlowType; taken: string[];
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [names, setNames] = useState<Record<string, string>>(type.names);
  const [confidential, setConfidential] = useState(type.confidential);
  const [key, setKey] = useState(type.key);
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A new type's key follows its name (in the page's language, else the first given) until someone edits it.
  const firstName = names[locale] || TYPE_LANGS.map((l) => names[l]).find(Boolean) || '';
  const shownKey = keyTouched ? key : firstName ? flowTypeKeyFromName(firstName) : '';
  const keyError = isNew && shownKey && (!FLOW_TYPE_KEY.test(shownKey) ? t('workflowConfig.flowType.keyInvalid') : taken.includes(shownKey) ? t('workflowConfig.flowType.keyTaken') : '');
  const hasName = TYPE_LANGS.some((l) => (names[l] ?? '').trim());

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/organizations/${orgId}/flow-types/${encodeURIComponent(shownKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ names, confidential }),
      });
      const data = await res.json();
      if (!data?.ok) {
        const k = `workflowConfig.flowType.error.${data?.error}`;
        setError(t(k) === k ? t('workflowConfig.saveFailed') : t(k));
        return;
      }
      await onSaved();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t(isNew ? 'workflowConfig.flowType.new' : 'workflowConfig.flowType.rename')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="body2" color="text.secondary">{t('workflowConfig.flowType.hint')}</Typography>
        {TYPE_LANGS.map((l) => (
          <TextField key={l} size="small" label={`${t('workflowConfig.flowType.name')} (${l.toUpperCase()})`} value={names[l] ?? ''}
            onChange={(e) => setNames((prev) => ({ ...prev, [l]: e.target.value }))} slotProps={{ htmlInput: { maxLength: MAX_FLOW_TYPE_NAME } }} />
        ))}
        <TextField size="small" label={t('workflowConfig.flowType.key')} value={shownKey} disabled={!isNew}
          onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')); }}
          error={!!keyError} helperText={keyError || t('workflowConfig.flowType.keyHint')}
          slotProps={{ htmlInput: { maxLength: 30, spellCheck: false, style: { fontFamily: 'monospace' } } }} />
        <Box>
          <FormControlLabel control={<Checkbox size="small" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />}
            label={<Typography variant="body2">{t('workflowConfig.flowType.confidential')}</Typography>} />
          <Typography variant="caption" color="text.secondary" component="div">{t('workflowConfig.flowType.confidentialHint')}</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !hasName || !shownKey || !!keyError} onClick={() => void save()}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function KindEditor({ orgId, kind, units, editable, authHeaders, onSaved, onRename }: {
  orgId: string; kind: KindInfo; units: Units; editable: boolean; authHeaders: () => Promise<Record<string, string>>; onSaved: () => Promise<void>;
  /** Renames the flow type this card is about (the flow types' kind only). */
  onRename?: () => void;
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
  // Folded by default, so the page lists the kinds and types at a glance; kept per kind for the session.
  const foldKey = `workflowConfig.expanded.${kind.id}:${kind.variant ?? ''}`;
  const [expanded, setExpandedState] = useState(() => {
    try {
      return sessionStorage.getItem(foldKey) === '1';
    } catch {
      return false;
    }
  });
  const setExpanded = (next: boolean) => {
    setExpandedState(next);
    try {
      sessionStorage.setItem(foldKey, next ? '1' : '0');
    } catch {
      // private window: just not remembered
    }
  };

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
  /** Back to what is saved: the designer and the JSON alike (a type without steps folds its editor away again). */
  const discard = () => {
    setText(pretty(kind.config ?? kind.defaultConfig));
    setServerErrors([]);
    setMessage(null);
    if (kind.optional && !kind.config) setOpened(false);
  };
  // What the designer can show: a parsed object with a list of steps (anything else is fixed in the JSON first).
  const designable = (() => {
    const p = checked.parsed as Partial<WorkflowConfig> | null;
    return p && typeof p === 'object' && Array.isArray(p.steps) && p.steps.every((x) => x && typeof x === 'object' && Array.isArray((x as { do?: unknown }).do))
      ? (p as WorkflowConfig) : null;
  })();
  return (
    <Paper sx={{ p: 2, display: 'grid' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <IconButton size="small" aria-expanded={expanded} aria-label={t(expanded ? 'common.collapse' : 'common.expand')} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
          {title}
          {onRename && (
            <Tooltip title={t('workflowConfig.flowType.rename')}>
              <IconButton size="small" sx={{ ml: 0.5 }} aria-label={t('workflowConfig.flowType.rename')} onClick={(e) => { e.stopPropagation(); onRename(); }}><EditIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Typography>
        {changed && <Chip size="small" color="warning" variant="outlined" label={t('workflowConfig.unsaved')} />}
        <Chip size="small" color={kind.config ? 'primary' : 'default'} label={t(kind.config ? 'workflowConfig.own' : kind.optional ? 'workflowConfig.noWorkflow' : 'workflowConfig.default')} />
      </Box>
      {/* Kept mounted while folded: unsaved changes stay. */}
      <Collapse in={expanded}>
      <Box sx={{ display: 'grid', gap: 1.5, pt: 1.5 }}>
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
        <Tab value="visual" icon={<AccountTreeIcon />} label={t('workflowDesigner.visual')} />
        <Tab value="json" icon={<CodeIcon />} label="JSON" />
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
          <Button startIcon={<CloseIcon />} disabled={busy || (!changed && !(kind.optional && !kind.config))} onClick={discard}>
            {t('workflowConfig.cancel')}
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
      </Box>
      </Collapse>
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
