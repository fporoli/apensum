import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import {
  assigneeKind, MAX_STEP_FIELDS, STEP_FIELD_TYPES, type Condition, type FactType, type RejectMode, type StepField, type StepFieldType, type StepMessage, MAX_MESSAGE_SUBJECT, MAX_MESSAGE_TEXT, type WorkflowConfig, type WorkflowConfigError, type WorkflowStepConfig,
} from '@worktime3/shared/workflowConfig';
import { PERMISSION_OBJECTS } from '@worktime3/shared/permissions';
import { useT } from './i18n';
import { AddIcon, ArrowDownwardIcon, ArrowUpwardIcon, ChevronRightIcon, ContentCopyIcon, DeleteIcon } from './icons';

/** What the designer knows of a kind (from GET workflow-configs). */
export interface DesignerKind {
  blocks: Record<string, { assignees: string[]; label: string; once: boolean; last: boolean; after: string[]; canReturn: boolean; required?: boolean; fields?: boolean; automatic?: boolean; message?: boolean }>;
  facts: Record<string, FactType>;
  rejectModes: RejectMode[];
  /** Its steps may go to everyone of a unit, each on their own. */
  each?: boolean;
}

export interface DesignerUnits {
  departments: { code: string | null; name: string }[];
  teams: { code: string | null; name: string }[];
  /** The organization's active members, for one person as assignee. */
  people?: { id: string; name: string | null; email: string }[];
}

const LANGS = ['de', 'fr', 'it', 'en'] as const;
const OPS: Record<FactType, string[]> = { number: ['gt', 'gte', 'lt', 'lte', 'eq'], string: ['eq', 'in'], strings: ['any', 'all', 'none'], boolean: ['is'] };

/** One comparison row of the condition builder. */
interface Row { fact: string; op: string; value: string }

/**
 * A condition the builder shows as rows (`all`/`any` of plain comparisons, or one comparison); null when it is more
 * (nested, `not`): then it is edited as JSON.
 */
function rowsOf(cond: Condition | undefined): { join: 'all' | 'any'; rows: Row[] } | null {
  if (!cond) return { join: 'all', rows: [] };
  const plain = (c: unknown): Row | null => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    const entries = Object.entries(c as Record<string, unknown>);
    if (entries.length !== 1) return null;
    const [[fact, v]] = entries;
    if (fact === 'all' || fact === 'any' || fact === 'not') return null;
    if (typeof v === 'boolean') return { fact, op: 'is', value: String(v) };
    if (!v || typeof v !== 'object') return null;
    const ops = Object.entries(v as Record<string, unknown>);
    if (ops.length !== 1) return null;
    const [[op, operand]] = ops;
    return { fact, op, value: Array.isArray(operand) ? operand.join(', ') : String(operand) };
  };
  const one = plain(cond);
  if (one) return { join: 'all', rows: [one] };
  const [[join, list]] = Object.entries(cond as Record<string, unknown>);
  if ((join === 'all' || join === 'any') && Array.isArray(list)) {
    const rows = list.map(plain);
    return rows.every(Boolean) ? { join, rows: rows as Row[] } : null;
  }
  return null;
}

/** The condition of rows (undefined when there are none); the checker reports what doesn't fit. */
function conditionOf(join: 'all' | 'any', rows: Row[], facts: Record<string, FactType>): Condition | undefined {
  const one = (r: Row): Condition => {
    const type = facts[r.fact];
    if (type === 'boolean') return { [r.fact]: r.value === 'true' };
    const list = r.value.split(',').map((x) => x.trim()).filter(Boolean);
    // A number only once it is one ("5." while typing stays text, which the checker flags until it is complete).
    const number = r.value.trim().replace(',', '.');
    const value = type === 'number' ? (/^-?\d+(\.\d+)?$/.test(number) ? Number(number) : r.value) : r.op === 'in' || type === 'strings' ? list : r.value.trim();
    return { [r.fact]: { [r.op]: value } };
  };
  if (rows.length === 0) return undefined;
  if (rows.length === 1) return one(rows[0]);
  return { [join]: rows.map(one) } as Condition;
}

/** A step's errors: those whose path is under `steps[i]`. */
const errorsOf = (errors: WorkflowConfigError[], i: number) => errors.filter((e) => e.path === `steps[${i}]` || e.path.startsWith(`steps[${i}].`));

/**
 * The graphical editor of a workflow configuration: one card per step (blocks, assignee, reject, condition, labels),
 * moved, added and removed; the checker's errors under the card they concern. A condition the rows can't show is
 * edited as JSON in place, with an example to copy.
 */
export function WorkflowDesigner({ kind, units, config, errors, editable, onChange }: {
  kind: DesignerKind;
  units: DesignerUnits;
  config: WorkflowConfig;
  errors: WorkflowConfigError[];
  editable: boolean;
  onChange: (config: WorkflowConfig) => void;
}) {
  const t = useT();
  const steps = config.steps;
  const set = (i: number, step: WorkflowStepConfig) => onChange({ ...config, steps: steps.map((s, j) => (j === i ? step : s)) });
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange({ ...config, steps: next });
  };
  const add = () => {
    const first = Object.keys(kind.blocks)[0];
    let n = steps.length + 1;
    while (steps.some((s) => s.key === `step_${n}`)) n++;
    onChange({ ...config, steps: [...steps, { key: `step_${n}`, do: [first], assignTo: kind.blocks[first].assignees.includes('manager') ? 'manager' : kind.blocks[first].assignees.find((a) => a.startsWith('permission:')) ?? 'manager' }] });
  };
  const general = errors.filter((e) => !/^steps\[\d+\]/.test(e.path));
  const errorText = (e: WorkflowConfigError) => {
    const key = `workflowConfig.error.${e.code}`;
    return t(key) === key ? e.code : t(key);
  };

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {general.length > 0 && <Alert severity="error">{general.map(errorText).join(' · ')}</Alert>}
      {steps.map((step, i) => (
        <Box key={i} sx={{ display: 'grid', gap: 1 }}>
          {i > 0 && <Box sx={{ display: 'flex', justifyContent: 'center' }}><ArrowDownwardIcon fontSize="small" color="action" /></Box>}
          <StepCard
            kind={kind}
            units={units}
            step={step}
            index={i}
            count={steps.length}
            errors={errorsOf(errors, i)}
            editable={editable}
            onChange={(s) => set(i, s)}
            onMove={(by) => move(i, by)}
            onRemove={() => onChange({ ...config, steps: steps.filter((_, j) => j !== i) })}
            errorText={errorText}
          />
        </Box>
      ))}
      {editable && (
        <Box>
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={add}>{t('workflowDesigner.addStep')}</Button>
        </Box>
      )}
    </Box>
  );
}

function StepCard({ kind, units, step, index, count, errors, editable, onChange, onMove, onRemove, errorText }: {
  kind: DesignerKind; units: DesignerUnits; step: WorkflowStepConfig; index: number; count: number; errors: WorkflowConfigError[]; editable: boolean;
  onChange: (s: WorkflowStepConfig) => void; onMove: (by: number) => void; onRemove: () => void; errorText: (e: WorkflowConfigError) => string;
}) {
  const t = useT();
  const [showLabels, setShowLabels] = useState(!!step.label);
  const blockLabel = (name: string) => {
    const key = `workflowDesigner.block.${name}`;
    return t(key) === key ? kind.blocks[name]?.label ?? name : t(key);
  };
  // Who the step may go to: what every one of its blocks allows.
  const allowed = step.do.length
    ? step.do.map((b) => kind.blocks[b]?.assignees ?? []).reduce((a, b) => a.filter((x) => b.includes(x)))
    : [];
  const permissions = allowed.filter((a) => a.startsWith('permission:'));
  const who = assigneeKind(step.assignTo) ?? 'manager';
  const unitCode = who === 'department' || who === 'team' || who === 'person' ? step.assignTo.slice(who.length + 1) : '';
  const people = units.people ?? [];
  // Each on their own: where the step reaches several people (a unit or a permission), for kinds that offer it.
  const canEach = !!kind.each && (who === 'department' || who === 'team' || who === 'permission');
  const asksFields = step.do.some((b) => kind.blocks[b]?.fields);
  const sendsMessage = step.do.some((b) => kind.blocks[b]?.message);
  /** The step with its blocks changed: fields only while a block asks them, a first empty field when one starts to. */
  const withBlocks = (doBlocks: string[]): WorkflowStepConfig => {
    const { fields, message, privateAnswers, ...rest } = step;
    const asks = doBlocks.some((b) => kind.blocks[b]?.fields);
    const sends = doBlocks.some((b) => kind.blocks[b]?.message);
    return {
      ...rest, do: doBlocks,
      ...(asks ? { fields: fields?.length ? fields : [{ key: 'field_1', type: 'text', label: {} }] } : {}),
      ...(asks && privateAnswers ? { privateAnswers: true } : {}),
      ...(sends ? { message: message ?? { subject: {} } } : {}),
    };
  };
  /** The step with another assignee: `each` only where it fits. */
  const withAssignee = (assignTo: string): WorkflowStepConfig => {
    const { each, ...rest } = step;
    const k = assigneeKind(assignTo);
    return each && (k === 'department' || k === 'team' || k === 'permission') ? { ...rest, assignTo, each } : { ...rest, assignTo };
  };
  const canReturn = step.do.length > 0 && step.do.every((b) => kind.blocks[b]?.canReturn);
  const permissionLabel = (p: string) => {
    const id = p.slice('permission:'.length);
    const caption = PERMISSION_OBJECTS.find((o) => o.id === id)?.caption;
    return caption ? `${t(caption)} (${id})` : id;
  };
  const setWho = (kindOfAssignee: string) => {
    if (kindOfAssignee === 'manager') onChange(withAssignee('manager'));
    else if (kindOfAssignee === 'department') onChange(withAssignee(`department:${units.departments.find((d) => d.code)?.code ?? ''}`));
    else if (kindOfAssignee === 'team') onChange(withAssignee(`team:${units.teams.find((d) => d.code)?.code ?? ''}`));
    else if (kindOfAssignee === 'person') onChange(withAssignee(`person:${people[0]?.id ?? ''}`));
    else if (kindOfAssignee === 'requester') onChange(withAssignee('requester'));
    else onChange(withAssignee(permissions[0] ?? 'manager'));
  };
  const kinds = [
    ...(allowed.includes('manager') ? ['manager'] : []),
    ...(allowed.includes('department') ? ['department'] : []),
    ...(allowed.includes('team') ? ['team'] : []),
    ...(allowed.includes('person') && people.length ? ['person'] : []),
    ...(allowed.includes('requester') ? ['requester'] : []),
    ...(permissions.length ? ['permission'] : []),
  ];

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.25, borderColor: errors.length ? 'error.main' : 'divider' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip size="small" color="primary" label={index + 1} />
        <TextField
          size="small" label={t('workflowDesigner.key')} value={step.key} disabled={!editable}
          onChange={(e) => onChange({ ...step, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
          inputProps={{ maxLength: 30, spellCheck: false, style: { fontFamily: 'monospace' } }} sx={{ width: 170 }}
        />
        <Box sx={{ flex: 1 }} />
        {editable && (
          <>
            <Tooltip title={t('workflowDesigner.up')}><span><IconButton size="small" aria-label={t('workflowDesigner.up')} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
            <Tooltip title={t('workflowDesigner.down')}><span><IconButton size="small" aria-label={t('workflowDesigner.down')} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
            <Tooltip title={t('workflowDesigner.remove')}><span><IconButton size="small" color="error" aria-label={t('workflowDesigner.remove')} disabled={count === 1} onClick={onRemove}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
          </>
        )}
      </Box>

      {/* What the step does: its blocks, in order. */}
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.does')}</Typography>
        {step.do.map((b, j) => (
          <Box key={`${b}-${j}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {j > 0 && <ChevronRightIcon fontSize="small" color="action" />}
            <Chip size="small" color="primary" variant="outlined" label={blockLabel(b)} onDelete={editable && step.do.length > 1 ? () => onChange(withBlocks(step.do.filter((_, k) => k !== j))) : undefined} />
          </Box>
        ))}
        {editable && (
          <TextField select size="small" value="" label={t('workflowDesigner.addBlock')} sx={{ minWidth: 150 }}
            onChange={(e) => onChange(withBlocks([...step.do, e.target.value]))}>
            {Object.keys(kind.blocks).map((b) => <MenuItem key={b} value={b}>{blockLabel(b)}</MenuItem>)}
          </TextField>
        )}
      </Box>

      {/* Who decides or does it. */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.assignTo')}</Typography>
        <TextField select size="small" value={kinds.includes(who) ? who : ''} disabled={!editable} onChange={(e) => setWho(e.target.value)} sx={{ minWidth: 190 }}>
          {kinds.map((k) => <MenuItem key={k} value={k}>{t(`workflowDesigner.assignee.${k}`)}</MenuItem>)}
        </TextField>
        {who === 'department' && (
          <TextField select size="small" value={unitCode} disabled={!editable} onChange={(e) => onChange(withAssignee(`department:${e.target.value}`))} sx={{ minWidth: 220 }}>
            {units.departments.filter((d) => d.code).map((d) => <MenuItem key={d.code!} value={d.code!}>{d.name} ({d.code})</MenuItem>)}
          </TextField>
        )}
        {who === 'team' && (
          <TextField select size="small" value={unitCode} disabled={!editable} onChange={(e) => onChange(withAssignee(`team:${e.target.value}`))} sx={{ minWidth: 220 }}>
            {units.teams.filter((d) => d.code).map((d) => <MenuItem key={d.code!} value={d.code!}>{d.name} ({d.code})</MenuItem>)}
          </TextField>
        )}
        {who === 'permission' && (
          <TextField select size="small" value={permissions.includes(step.assignTo) ? step.assignTo : ''} disabled={!editable} onChange={(e) => onChange(withAssignee(e.target.value))} sx={{ minWidth: 260 }}>
            {permissions.map((p) => <MenuItem key={p} value={p}>{permissionLabel(p)}</MenuItem>)}
          </TextField>
        )}
        {who === 'person' && (
          <TextField select size="small" value={people.some((p) => p.id === unitCode) ? unitCode : ''} disabled={!editable} onChange={(e) => onChange(withAssignee(`person:${e.target.value}`))} sx={{ minWidth: 260 }}>
            {[...people].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)).map((p) => <MenuItem key={p.id} value={p.id}>{p.name ?? p.email}</MenuItem>)}
          </TextField>
        )}
        {canEach && (
          <Tooltip title={t('workflowDesigner.eachHint')}>
            <FormControlLabel
              control={<Checkbox size="small" checked={!!step.each} disabled={!editable} onChange={(e) => { const { each: _old, ...rest } = step; onChange(e.target.checked ? { ...rest, each: true } : rest); }} />}
              label={<Typography variant="body2">{t('workflowDesigner.each')}</Typography>}
            />
          </Tooltip>
        )}
      </Box>

      {/* What a form step asks whoever does it. */}
      {asksFields && <StepFieldsEditor fields={step.fields ?? []} editable={editable} onChange={(fields) => onChange({ ...step, fields })} />}
      {asksFields && (
        <Box sx={{ pl: { sm: 2 } }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={!!step.privateAnswers} disabled={!editable}
              onChange={(e) => { const { privateAnswers: _p, ...rest } = step; onChange(e.target.checked ? { ...rest, privateAnswers: true } : rest); }} />}
            label={<Typography variant="body2">{t('workflowDesigner.privateAnswers')}</Typography>} />
          <Typography variant="caption" color="text.secondary" component="div">{t('workflowDesigner.privateAnswersHint')}</Typography>
        </Box>
      )}
      {/* What a message step sends (the system sends it the moment the workflow gets there). */}
      {sendsMessage && <StepMessageEditor message={step.message ?? { subject: {} }} editable={editable} onChange={(message) => onChange({ ...step, message })} />}

      {/* Rejecting: not possible, or back to the person who submitted. */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.reject')}</Typography>
        <TextField select size="small" value={step.reject ?? (canReturn ? 'back' : 'none')} disabled={!editable} onChange={(e) => onChange({ ...step, reject: e.target.value as RejectMode })} sx={{ minWidth: 260 }}>
          {kind.rejectModes.filter((m) => m === 'none' || canReturn).map((m) => <MenuItem key={m} value={m}>{t(`workflowDesigner.reject.${m}`)}</MenuItem>)}
        </TextField>
      </Box>

      {/* A step with the last block (e.g. "paid") always comes: it has no condition. */}
      {step.do.some((b) => kind.blocks[b]?.last) ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.when')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('workflowDesigner.whenAlwaysLast')}</Typography>
        </Box>
      ) : (
        <ConditionEditor kind={kind} units={units} when={step.when} editable={editable} onChange={(when) => {
          const { when: _old, ...rest } = step;
          onChange(when === undefined ? rest : { ...rest, when });
        }} />
      )}

      {/* Its name per language (else the blocks' names). */}
      {showLabels || !editable ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.label')}</Typography>
          {LANGS.map((l) => (
            <TextField key={l} size="small" label={l.toUpperCase()} value={step.label?.[l] ?? ''} disabled={!editable} inputProps={{ maxLength: 60 }} sx={{ width: 170 }}
              onChange={(e) => {
                const label = { ...(step.label ?? {}), [l]: e.target.value };
                if (!e.target.value) delete label[l];
                const { label: _old, ...rest } = step;
                onChange(Object.keys(label).length ? { ...rest, label } : rest);
              }} />
          ))}
        </Box>
      ) : (
        <Box><Button size="small" onClick={() => setShowLabels(true)}>{t('workflowDesigner.addLabel')}</Button></Box>
      )}

      {errors.length > 0 && <Alert severity="error" sx={{ py: 0 }}>{errors.map((e) => `${e.path.replace(/^steps\[\d+\]\.?/, '') || '·'}: ${errorText(e)}`).join(' · ')}</Alert>}
    </Paper>
  );
}

/** A message step's mail: subject and text per language, and whether the form steps' answers go with it. */
function StepMessageEditor({ message, editable, onChange }: { message: StepMessage; editable: boolean; onChange: (m: StepMessage) => void }) {
  const t = useT();
  const setLang = (part: 'subject' | 'text', l: (typeof LANGS)[number], value: string) => {
    const map = { ...(message[part] ?? {}), [l]: value };
    if (!value) delete map[l];
    const { [part]: _old, ...rest } = message;
    onChange(part === 'subject' || Object.keys(map).length ? { ...rest, [part]: map } as StepMessage : rest as StepMessage);
  };
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="body2">{t('workflowDesigner.message')}</Typography>
      <Typography variant="caption" color="text.secondary">{t('workflowDesigner.messageHint')}</Typography>
      {LANGS.map((l) => (
        <Box key={l} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start', pl: { sm: 2 } }}>
          <TextField size="small" label={`${t('workflowDesigner.messageSubject')} ${l.toUpperCase()}`} value={message.subject[l] ?? ''} disabled={!editable}
            inputProps={{ maxLength: MAX_MESSAGE_SUBJECT }} sx={{ width: 260 }} onChange={(e) => setLang('subject', l, e.target.value)} />
          <TextField size="small" multiline minRows={1} maxRows={6} label={`${t('workflowDesigner.messageText')} ${l.toUpperCase()}`} value={message.text?.[l] ?? ''} disabled={!editable}
            inputProps={{ maxLength: MAX_MESSAGE_TEXT }} sx={{ flex: 1, minWidth: 260 }} onChange={(e) => setLang('text', l, e.target.value)} />
        </Box>
      ))}
      <Box sx={{ pl: { sm: 2 } }}>
        <FormControlLabel control={<Checkbox size="small" checked={!!message.answers} disabled={!editable} onChange={(e) => { const { answers: _a, ...rest } = message; onChange(e.target.checked ? { ...rest, answers: true } : rest); }} />}
          label={<Typography variant="body2">{t('workflowDesigner.messageAnswers')}</Typography>} />
      </Box>
    </Box>
  );
}

/** The fields a form step asks: key, type, required, the label per language. */
function StepFieldsEditor({ fields, editable, onChange }: { fields: StepField[]; editable: boolean; onChange: (fields: StepField[]) => void }) {
  const t = useT();
  const set = (i: number, f: StepField) => onChange(fields.map((x, k) => (k === i ? f : x)));
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="body2">{t('workflowDesigner.fields')}</Typography>
      {fields.map((f, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', pl: { sm: 2 } }}>
          <TextField size="small" label={t('workflowDesigner.key')} value={f.key} disabled={!editable} sx={{ width: 130 }}
            inputProps={{ maxLength: 30, spellCheck: false, style: { fontFamily: 'monospace' } }}
            onChange={(e) => set(i, { ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
          <TextField select size="small" label={t('workflowDesigner.fieldType')} value={f.type} disabled={!editable} sx={{ width: 140 }}
            onChange={(e) => set(i, { ...f, type: e.target.value as StepFieldType })}>
            {STEP_FIELD_TYPES.map((ty) => <MenuItem key={ty} value={ty}>{t(`workflowDesigner.fieldType.${ty}`)}</MenuItem>)}
          </TextField>
          {LANGS.map((l) => (
            <TextField key={l} size="small" label={l.toUpperCase()} value={f.label[l] ?? ''} disabled={!editable} inputProps={{ maxLength: 60 }} sx={{ width: 130 }}
              onChange={(e) => {
                const label = { ...f.label, [l]: e.target.value };
                if (!e.target.value) delete label[l];
                set(i, { ...f, label });
              }} />
          ))}
          <FormControlLabel control={<Checkbox size="small" checked={!!f.required} disabled={!editable} onChange={(e) => { const { required: _r, ...rest } = f; set(i, e.target.checked ? { ...rest, required: true } : rest); }} />}
            label={<Typography variant="body2">{t('workflowDesigner.fieldRequired')}</Typography>} />
          {editable && (
            <Tooltip title={t('workflowDesigner.remove')}><span><IconButton size="small" color="error" aria-label={t('workflowDesigner.remove')} disabled={fields.length === 1} onClick={() => onChange(fields.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
          )}
        </Box>
      ))}
      {editable && fields.length < MAX_STEP_FIELDS && (
        <Box sx={{ pl: { sm: 2 } }}>
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => {
            let n = fields.length + 1;
            while (fields.some((f) => f.key === `field_${n}`)) n++;
            onChange([...fields, { key: `field_${n}`, type: 'text', label: {} }]);
          }}>{t('workflowDesigner.addField')}</Button>
        </Box>
      )}
    </Box>
  );
}

/** "Always", rows of comparisons joined by all/any, or (when the rows can't show it) the condition as JSON. */
function ConditionEditor({ kind, units, when, editable, onChange }: {
  kind: DesignerKind; units: DesignerUnits; when: Condition | undefined; editable: boolean; onChange: (when: Condition | undefined) => void;
}) {
  const t = useT();
  const shown = rowsOf(when);
  const [asJson, setAsJson] = useState(shown === null);
  const [text, setText] = useState(when ? JSON.stringify(when, null, 2) : '');
  const [jsonError, setJsonError] = useState(false);
  const facts = Object.keys(kind.facts);
  const factLabel = (f: string) => {
    const key = `workflowDesigner.fact.${f}`;
    return t(key) === key ? f : t(key);
  };
  const example = JSON.stringify({ all: [{ [facts[0] ?? 'total']: kind.facts[facts[0]] === 'boolean' ? true : { gt: 500 } }, { not: { [facts.find((f) => kind.facts[f] === 'boolean') ?? 'urgent']: true } }] }, null, 2);

  if (asJson || shown === null) {
    return (
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.when')}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{t('workflowDesigner.whenJson')}</Typography>
          {rowsOf(when) !== null && <Button size="small" onClick={() => setAsJson(false)}>{t('workflowDesigner.whenRows')}</Button>}
        </Box>
        <TextField
          multiline minRows={3} size="small" value={text} disabled={!editable} error={jsonError}
          placeholder={t('workflowDesigner.whenAlways')}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) { setJsonError(false); onChange(undefined); return; }
            try { onChange(JSON.parse(e.target.value)); setJsonError(false); } catch { setJsonError(true); }
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Typography component="pre" variant="caption" sx={{ m: 0, p: 1, flex: 1, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto' }}>{example}</Typography>
          <Button size="small" startIcon={<ContentCopyIcon fontSize="small" />} onClick={() => void navigator.clipboard.writeText(example).catch(() => {})}>{t('workflowConfig.copy')}</Button>
        </Box>
      </Box>
    );
  }

  const { join, rows } = shown;
  const update = (nextRows: Row[], nextJoin = join) => onChange(conditionOf(nextJoin, nextRows, kind.facts));
  const valueField = (r: Row, i: number) => {
    const type = kind.facts[r.fact];
    const setValue = (value: string) => update(rows.map((x, j) => (j === i ? { ...x, value } : x)));
    if (type === 'boolean') {
      return (
        <TextField select size="small" value={r.value} disabled={!editable} onChange={(e) => setValue(e.target.value)} sx={{ width: 110 }}>
          <MenuItem value="true">{t('workflowDesigner.yes')}</MenuItem>
          <MenuItem value="false">{t('workflowDesigner.no')}</MenuItem>
        </TextField>
      );
    }
    // A department's code: offered from the organization's departments.
    if (r.fact === 'requester.department' && r.op === 'eq') {
      return (
        <TextField select size="small" value={r.value} disabled={!editable} onChange={(e) => setValue(e.target.value)} sx={{ minWidth: 200 }}>
          {units.departments.filter((d) => d.code).map((d) => <MenuItem key={d.code!} value={d.code!}>{d.name} ({d.code})</MenuItem>)}
        </TextField>
      );
    }
    return (
      <TextField size="small" value={r.value} disabled={!editable} onChange={(e) => setValue(e.target.value)} sx={{ minWidth: 160 }}
        placeholder={type === 'number' ? '500' : t('workflowDesigner.listHint')} inputProps={{ inputMode: type === 'number' ? 'decimal' : 'text' }} />
    );
  };

  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ minWidth: 110 }}>{t('workflowDesigner.when')}</Typography>
        {rows.length === 0 && <Typography variant="body2" color="text.secondary">{t('workflowDesigner.whenAlways')}</Typography>}
        {rows.length > 1 && (
          <TextField select size="small" value={join} disabled={!editable} onChange={(e) => update(rows, e.target.value as 'all' | 'any')} sx={{ minWidth: 190 }}>
            <MenuItem value="all">{t('workflowDesigner.join.all')}</MenuItem>
            <MenuItem value="any">{t('workflowDesigner.join.any')}</MenuItem>
          </TextField>
        )}
        <Box sx={{ flex: 1 }} />
        {editable && <Button size="small" onClick={() => { setText(when ? JSON.stringify(when, null, 2) : ''); setAsJson(true); }}>{t('workflowDesigner.whenAsJson')}</Button>}
      </Box>
      {rows.map((r, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', pl: { sm: '118px' } }}>
          <TextField select size="small" value={r.fact} disabled={!editable} sx={{ minWidth: 200 }}
            onChange={(e) => {
              const fact = e.target.value;
              const op = OPS[kind.facts[fact]]?.[0] ?? 'eq';
              update(rows.map((x, j) => (j === i ? { fact, op, value: kind.facts[fact] === 'boolean' ? 'true' : '' } : x)));
            }}>
            {facts.map((f) => <MenuItem key={f} value={f}>{factLabel(f)}</MenuItem>)}
          </TextField>
          {kind.facts[r.fact] !== 'boolean' && (
            <TextField select size="small" value={r.op} disabled={!editable} sx={{ minWidth: 150 }} onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>
              {(OPS[kind.facts[r.fact]] ?? []).map((o) => <MenuItem key={o} value={o}>{t(`workflowDesigner.op.${o}`)}</MenuItem>)}
            </TextField>
          )}
          {valueField(r, i)}
          {editable && <IconButton size="small" aria-label={t('workflowDesigner.removeCondition')} onClick={() => update(rows.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>}
        </Box>
      ))}
      {editable && facts.length > 0 && (
        <Box sx={{ pl: { sm: '118px' } }}>
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => {
            const fact = facts[0];
            update([...rows, { fact, op: OPS[kind.facts[fact]][0], value: kind.facts[fact] === 'boolean' ? 'true' : '' }]);
          }}>{t('workflowDesigner.addCondition')}</Button>
        </Box>
      )}
    </Box>
  );
}
