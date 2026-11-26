/**
 * Configurable workflows: a module offers a kind of workflow (e.g. `expenses.report`) with building blocks (what a
 * step does: review, process, pay, ...) and facts (what a condition may test: total, categories, ...); an
 * organization's owner arranges them in a JSON document (which blocks, in which order, who decides, when a step
 * applies, what rejecting does). The code decides what a block does; the JSON never runs anything else.
 *
 *   { "version": 1, "steps": [
 *       { "key": "manager", "do": ["review"], "assignTo": "manager", "reject": "back" },
 *       { "key": "finance", "do": ["review"], "assignTo": "permission:nav.expensePayout", "when": { "total": { "gt": 500 } } },
 *       { "key": "pay", "do": ["pay"], "assignTo": "permission:nav.expenseProcessing" } ] }
 *
 * A step does one block (`do` holds exactly one: a list only so that the format stays as it was).
 *
 * Pure, used by the API (validation, running) and the browser (the editor's checks). Keep it erasable TypeScript.
 */

export const WORKFLOW_CONFIG_VERSION = 1;

/** A department's or team's code (`department:<code>`, `team:<code>`): lower-case letters, digits and -, up to 40. */
export const UNIT_CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A code from a request: trimmed and lower-case; null = none, undefined = not a valid code. */
export function cleanUnitCode(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toLowerCase();
  if (!code) return null;
  return UNIT_CODE.test(code) ? code : undefined;
}

/** A code made from a name (the suggestion when a department or team is created). */
export function codeFromName(name: string): string {
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return slug || 'unit';
}
export const MAX_WORKFLOW_STEPS = 8;
const KEY = /^[a-z0-9_]{1,30}$/;
const LANGS = ['de', 'fr', 'it', 'en'] as const;

/**
 * `none` = the step can't be rejected; `back` = back to the person who submitted, to change and submit again;
 * `end` = rejected for good (e.g. an absence: the person asks anew).
 */
export type RejectMode = 'none' | 'back' | 'end';
export const REJECT_MODES: readonly RejectMode[] = ['none', 'back', 'end'];

/** A fact's type: what a condition may compare it with. */
export type FactType = 'number' | 'string' | 'strings' | 'boolean';

/** A condition on the facts of the record (shared `evaluateCondition`). */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Record<string, unknown>;

/** A field a step asks its assignees to fill (a block with `fields`, e.g. a request's "form"). */
export type StepFieldType = 'text' | 'number' | 'date' | 'checkbox';
export const STEP_FIELD_TYPES: readonly StepFieldType[] = ['text', 'number', 'date', 'checkbox'];
export const MAX_STEP_FIELDS = 8;
export interface StepField {
  key: string;
  type: StepFieldType;
  label: Partial<Record<(typeof LANGS)[number], string>>;
  required?: boolean;
}

export interface WorkflowStepConfig {
  key: string;
  /** The blocks done in this step, in order (one or more of the kind's). */
  do: string[];
  /** `manager`, `permission:<object>`, `department:<code>`, `team:<code>` or `person:<user id>`. */
  assignTo: string;
  when?: Condition;
  reject?: RejectMode;
  label?: Partial<Record<(typeof LANGS)[number], string>>;
  /** Every assignee does the step, each on their own (a department, team or permission); default: one for all. */
  each?: boolean;
  /** What the step asks (only with a block that has `fields`). */
  fields?: StepField[];
  /**
   * The answers are for the requester only (with `fields`): the others see that someone answered, not what, and a
   * message step sends them to the requester alone.
   */
  privateAnswers?: boolean;
  /** What an automatic message block sends (only with a block that has `message`). */
  message?: StepMessage;
}

/** A message step's mail: subject and text per language, and whether the form steps' answers go with it. */
export interface StepMessage {
  subject: Partial<Record<(typeof LANGS)[number], string>>;
  text?: Partial<Record<(typeof LANGS)[number], string>>;
  answers?: boolean;
}
export const MAX_MESSAGE_SUBJECT = 120;
export const MAX_MESSAGE_TEXT = 2000;

export interface WorkflowConfig {
  version: number;
  steps: WorkflowStepConfig[];
}

/** What a building block does and where it may stand; part of a kind's catalogue (code). */
export interface WorkflowBlock {
  /** Who may do it: `manager`, `department`, `team`, `person`, and `permission:<object>` for each object allowed. */
  assignees: string[];
  /** The action run when the step is approved (registered with WorkflowsService). */
  action: string;
  /** The action run when the step is rejected (reject `back` or `end`); none = the block can't be rejected. */
  returnAction?: string;
  /** At most once in a workflow. */
  once?: boolean;
  /** Blocks that must be done before it (in an earlier step or earlier in the same step). */
  after?: string[];
  /** Only in the last step, as its last block (such a step has no condition: it always comes). */
  last?: boolean;
  /** Every configuration has it (e.g. a payment run's "paid": without it a run would never be paid). */
  required?: boolean;
  /** A decision about someone's submission (approve or not): whoever submitted never decides it (four eyes). */
  decides?: boolean;
  /** Done in the kind's dialog on the Workflow page (it shows what the step needs). */
  inDialog?: boolean;
  /** Text keys: the history entry when done, the Workflow page's button. */
  doneKey?: string;
  actionKey?: string;
  /** The step asks its fields (`WorkflowStepConfig.fields`), filled by whoever does it. */
  fields?: boolean;
  /** The step may ask fields as well (none = it asks nothing), e.g. a review that has an amount entered. */
  fieldsOptional?: boolean;
  /** Done by the system the moment the workflow reaches it (nobody acts on it); alone in its step. */
  automatic?: boolean;
  /** The step sends a message (`WorkflowStepConfig.message`) to its assignees. */
  message?: boolean;
  /** English name, the step's label when the configuration gives none. */
  label: string;
}

/** A kind of workflow a module offers (its catalogue). */
export interface WorkflowKindCatalogue {
  id: string;
  /** The workflow definition's name (`workflow_definitions.name`) of this kind. */
  definitionName: string;
  blocks: Record<string, WorkflowBlock>;
  facts: Record<string, FactType>;
  /** Which reject modes the kind supports. */
  rejectModes: RejectMode[];
  /**
   * false: the first step may be work instead of a decision (e.g. a payment run, made by someone who checked it);
   * default: a submission is always looked at first (the first step can be sent back).
   */
  firstStepDecides?: boolean;
  /** Its steps may go to every assignee, each on their own (`each`). */
  each?: boolean;
  /** The configuration an organization without its own uses. */
  defaultConfig: WorkflowConfig;
  /** Shown with the steps on the Workflow page (`source`/`source_name` of the engine's step). */
  source?: string;
  source_name?: string;
}

export interface WorkflowConfigError {
  /** Where: `steps[2].assignTo`, `steps[0].when.total`, ... */
  path: string;
  /** What: a kebab-case code (the web app's `workflowConfig.error.<code>`). */
  code: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The kind of an assignee (`manager`, `department`, `team`, `permission`, `person`, `requester`), or null. */
export function assigneeKind(value: string): 'manager' | 'department' | 'team' | 'permission' | 'person' | 'requester' | null {
  if (value === 'manager') return 'manager';
  if (value === 'requester') return 'requester';
  if (value.startsWith('person:') && UUID.test(value.slice('person:'.length))) return 'person';
  if (value.startsWith('department:') && UNIT_CODE.test(value.slice('department:'.length))) return 'department';
  if (value.startsWith('team:') && UNIT_CODE.test(value.slice('team:'.length))) return 'team';
  if (/^permission:[a-zA-Z0-9.]+$/.test(value)) return 'permission';
  return null;
}

/** Whether `block` may go to `assignTo`. */
function assigneeAllowed(block: WorkflowBlock, assignTo: string): boolean {
  const kind = assigneeKind(assignTo);
  if (kind === 'manager') return block.assignees.includes('manager');
  if (kind === 'department') return block.assignees.includes('department');
  if (kind === 'team') return block.assignees.includes('team');
  if (kind === 'person') return block.assignees.includes('person');
  if (kind === 'requester') return block.assignees.includes('requester');
  if (kind === 'permission') return block.assignees.includes(assignTo);
  return false;
}

const NUMBER_OPS = ['gt', 'gte', 'lt', 'lte', 'eq'];
const LIST_OPS = ['any', 'all', 'none'];

/** The errors of a condition (empty = fine). */
function conditionErrors(cond: unknown, facts: Record<string, FactType>, path: string, depth = 0): WorkflowConfigError[] {
  if (depth > 4) return [{ path, code: 'condition-too-deep' }];
  if (!isObject(cond) || Object.keys(cond).length !== 1) return [{ path, code: 'invalid-condition' }];
  const [[name, value]] = Object.entries(cond);
  if (name === 'all' || name === 'any') {
    if (!Array.isArray(value) || value.length === 0) return [{ path: `${path}.${name}`, code: 'invalid-condition' }];
    return value.flatMap((c, i) => conditionErrors(c, facts, `${path}.${name}[${i}]`, depth + 1));
  }
  if (name === 'not') return conditionErrors(value, facts, `${path}.not`, depth + 1);
  const type = facts[name];
  const at = `${path}.${name}`;
  if (!type) return [{ path: at, code: 'unknown-fact' }];
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [{ path: at, code: 'invalid-comparison' }];
  if (!isObject(value) || Object.keys(value).length !== 1) return [{ path: at, code: 'invalid-comparison' }];
  const [[op, operand]] = Object.entries(value);
  if (type === 'number') return NUMBER_OPS.includes(op) && typeof operand === 'number' && Number.isFinite(operand) ? [] : [{ path: at, code: 'invalid-comparison' }];
  if (type === 'string') {
    if (op === 'eq' && typeof operand === 'string') return [];
    if (op === 'in' && Array.isArray(operand) && operand.every((x) => typeof x === 'string')) return [];
    return [{ path: at, code: 'invalid-comparison' }];
  }
  return LIST_OPS.includes(op) && Array.isArray(operand) && operand.length > 0 && operand.every((x) => typeof x === 'string')
    ? []
    : [{ path: at, code: 'invalid-comparison' }];
}

/** A step's fields as a configuration gives them: their errors, else the fields. */
function stepFieldsErrors(raw: unknown, path: string): { errors: WorkflowConfigError[]; fields: StepField[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { errors: [{ path, code: 'no-fields' }], fields: [] };
  if (raw.length > MAX_STEP_FIELDS) return { errors: [{ path, code: 'too-many-fields' }], fields: [] };
  const errors: WorkflowConfigError[] = [];
  const keys = new Set<string>();
  const fields: StepField[] = [];
  raw.forEach((f, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(f)) { errors.push({ path: at, code: 'not-an-object' }); return; }
    for (const k of Object.keys(f)) if (!['key', 'type', 'label', 'required'].includes(k)) errors.push({ path: `${at}.${k}`, code: 'unknown-field' });
    const key = typeof f.key === 'string' ? f.key : '';
    if (!KEY.test(key)) errors.push({ path: `${at}.key`, code: 'invalid-key' });
    else if (keys.has(key)) errors.push({ path: `${at}.key`, code: 'duplicate-key' });
    keys.add(key);
    if (!STEP_FIELD_TYPES.includes(f.type as StepFieldType)) errors.push({ path: `${at}.type`, code: 'invalid-field-type' });
    const label = f.label;
    if (!isObject(label) || Object.keys(label).length === 0
      || Object.entries(label).some(([l, v]) => !(LANGS as readonly string[]).includes(l) || typeof v !== 'string' || !v.trim() || v.length > 60)) {
      errors.push({ path: `${at}.label`, code: 'invalid-label' });
    }
    if (f.required !== undefined && typeof f.required !== 'boolean') errors.push({ path: `${at}.required`, code: 'invalid-required' });
    fields.push({ key, type: f.type as StepFieldType, label: label as StepField['label'], ...(f.required ? { required: true } : {}) });
  });
  return { errors, fields };
}

/** A message as a configuration gives it, or null: a subject in at least one language, texts within their limits. */
function stepMessageOf(raw: unknown): StepMessage | null {
  if (!isObject(raw)) return null;
  if (Object.keys(raw).some((k) => !['subject', 'text', 'answers'].includes(k))) return null;
  const langMap = (v: unknown, max: number, required: boolean) => {
    if (v === undefined) return required ? null : {};
    if (!isObject(v)) return null;
    const out: Partial<Record<(typeof LANGS)[number], string>> = {};
    for (const [l, t] of Object.entries(v)) {
      if (!(LANGS as readonly string[]).includes(l) || typeof t !== 'string' || t.length > max) return null;
      if (t.trim()) out[l as (typeof LANGS)[number]] = t.trim();
    }
    return required && Object.keys(out).length === 0 ? null : out;
  };
  const subject = langMap(raw.subject, MAX_MESSAGE_SUBJECT, true);
  const text = langMap(raw.text, MAX_MESSAGE_TEXT, false);
  if (!subject || !text || (raw.answers !== undefined && typeof raw.answers !== 'boolean')) return null;
  return { subject, ...(Object.keys(text).length ? { text } : {}), ...(raw.answers ? { answers: true } : {}) };
}

/** A message's text in a language (else English, else any), or ''. */
export function messageText(map: StepMessage['subject'] | undefined, lang: string): string {
  if (!map) return '';
  return map[lang as (typeof LANGS)[number]] ?? map.en ?? Object.values(map).find(Boolean) ?? '';
}

/** A field's label in a language (else English, else any). */
export function stepFieldLabel(field: StepField, lang: string): string {
  return field.label[lang as (typeof LANGS)[number]] ?? field.label.en ?? Object.values(field.label).find(Boolean) ?? field.key;
}

/**
 * The values someone gives a step's fields, checked (browser and API alike): text up to 500 characters, numbers,
 * dates (YYYY-MM-DD), checkboxes; a required one must be given (a required checkbox ticked). Unknown keys are dropped.
 */
export function stepFieldValues(fields: readonly StepField[], raw: unknown): { ok: true; values: Record<string, string | number | boolean> } | { ok: false; error: string; field: string } {
  const given = isObject(raw) ? raw : {};
  const values: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    let v = given[f.key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v === false);
    if (empty) {
      if (f.required) return { ok: false, error: 'step-field-required', field: f.key };
      continue;
    }
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/['’\s]/g, '').replace(',', '.')) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e9) return { ok: false, error: 'step-field-invalid', field: f.key };
      values[f.key] = n;
    } else if (f.type === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { ok: false, error: 'step-field-invalid', field: f.key };
      values[f.key] = v;
    } else if (f.type === 'checkbox') {
      if (v !== true) return { ok: false, error: 'step-field-invalid', field: f.key };
      values[f.key] = true;
    } else {
      if (typeof v !== 'string' || v.length > 500) return { ok: false, error: 'step-field-invalid', field: f.key };
      values[f.key] = v;
    }
  }
  return { ok: true, values };
}

/**
 * Checks an organization's configuration against the kind's catalogue: known blocks and facts, allowed assignees,
 * the blocks' order, the reject modes. The first step is always there (no `when`) and decides (its blocks may be
 * rejected), so a submission never passes without anybody looking at it.
 */
export function validateWorkflowConfig(kind: WorkflowKindCatalogue, raw: unknown): { ok: true; value: WorkflowConfig } | { ok: false; errors: WorkflowConfigError[] } {
  const errors: WorkflowConfigError[] = [];
  if (!isObject(raw)) return { ok: false, errors: [{ path: '', code: 'not-an-object' }] };
  if (raw.version !== WORKFLOW_CONFIG_VERSION) errors.push({ path: 'version', code: 'unknown-version' });
  const steps = raw.steps;
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, errors: [...errors, { path: 'steps', code: 'no-steps' }] };
  if (steps.length > MAX_WORKFLOW_STEPS) errors.push({ path: 'steps', code: 'too-many-steps' });
  const keys = new Set<string>();
  const done = new Set<string>();
  const out: WorkflowStepConfig[] = [];
  steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!isObject(s)) { errors.push({ path: at, code: 'not-an-object' }); return; }
    for (const k of Object.keys(s)) if (!['key', 'do', 'assignTo', 'when', 'reject', 'label', 'each', 'fields', 'privateAnswers', 'message'].includes(k)) errors.push({ path: `${at}.${k}`, code: 'unknown-field' });
    const key = typeof s.key === 'string' ? s.key : '';
    if (!KEY.test(key)) errors.push({ path: `${at}.key`, code: 'invalid-key' });
    else if (keys.has(key)) errors.push({ path: `${at}.key`, code: 'duplicate-key' });
    keys.add(key);
    const blocks = Array.isArray(s.do) ? s.do : [];
    if (!Array.isArray(s.do) || blocks.length === 0 || !blocks.every((b) => typeof b === 'string')) errors.push({ path: `${at}.do`, code: 'no-blocks' });
    // One block per step: two things to do are two steps.
    else if (blocks.length > 1) errors.push({ path: `${at}.do`, code: 'one-block' });
    const assignTo = typeof s.assignTo === 'string' ? s.assignTo : '';
    if (!assigneeKind(assignTo)) errors.push({ path: `${at}.assignTo`, code: 'invalid-assignee' });
    blocks.forEach((b: string, j: number) => {
      const block = kind.blocks[b];
      const bAt = `${at}.do[${j}]`;
      if (!block) { errors.push({ path: bAt, code: 'unknown-block' }); return; }
      if (block.once && done.has(b)) errors.push({ path: bAt, code: 'block-once' });
      for (const before of block.after ?? []) if (!done.has(before)) errors.push({ path: bAt, code: 'block-order' });
      if (block.last && (i !== steps.length - 1 || j !== blocks.length - 1)) errors.push({ path: bAt, code: 'block-last' });
      if (assigneeKind(assignTo) && !assigneeAllowed(block, assignTo)) errors.push({ path: `${at}.assignTo`, code: 'assignee-not-allowed' });
      done.add(b);
    });
    // Default: the kind's way of rejecting (back, else end) where every block can be rejected, else none.
    const rejecting = kind.rejectModes.find((m) => m !== 'none') ?? 'none';
    const reject = s.reject === undefined ? (blocks.every((b: string) => kind.blocks[b]?.returnAction) ? rejecting : 'none') : s.reject;
    if (!REJECT_MODES.includes(reject as RejectMode) || !kind.rejectModes.includes(reject as RejectMode)) errors.push({ path: `${at}.reject`, code: 'invalid-reject' });
    else if (reject !== 'none' && !blocks.every((b: string) => kind.blocks[b]?.returnAction)) errors.push({ path: `${at}.reject`, code: 'not-rejectable' });
    if (s.when !== undefined) {
      if (i === 0 && kind.firstStepDecides !== false) errors.push({ path: `${at}.when`, code: 'first-step-condition' });
      else if (blocks.some((b: string) => kind.blocks[b]?.last)) errors.push({ path: `${at}.when`, code: 'last-step-condition' });
      else errors.push(...conditionErrors(s.when, kind.facts, `${at}.when`));
    }
    if (i === 0 && reject === 'none' && kind.firstStepDecides !== false) errors.push({ path: `${at}.reject`, code: 'first-step-decides' });
    let label: WorkflowStepConfig['label'];
    if (s.label !== undefined) {
      if (!isObject(s.label) || Object.entries(s.label).some(([l, v]) => !(LANGS as readonly string[]).includes(l) || typeof v !== 'string' || v.length > 60)) {
        errors.push({ path: `${at}.label`, code: 'invalid-label' });
      } else label = s.label as WorkflowStepConfig['label'];
    }
    // Each on their own: only where a step reaches several people, and only for kinds that offer it.
    const each = s.each === true;
    if (s.each !== undefined && typeof s.each !== 'boolean') errors.push({ path: `${at}.each`, code: 'invalid-each' });
    else if (each && (!kind.each || !['department', 'team', 'permission'].includes(assigneeKind(assignTo) ?? '') || blocks.some((b: string) => kind.blocks[b]?.automatic))) errors.push({ path: `${at}.each`, code: 'each-not-allowed' });
    // An automatic block (nobody acts on it) stands alone in its step.
    if (blocks.length > 1 && blocks.some((b: string) => kind.blocks[b]?.automatic)) errors.push({ path: `${at}.do`, code: 'automatic-alone' });
    // The message a block with `message` sends: required with it, refused without.
    const sends = blocks.some((b: string) => kind.blocks[b]?.message);
    let message: StepMessage | undefined;
    if (s.message !== undefined && !sends) errors.push({ path: `${at}.message`, code: 'message-not-allowed' });
    else if (sends) {
      const m = stepMessageOf(s.message);
      if (!m) errors.push({ path: `${at}.message`, code: 'invalid-message' });
      else message = m;
    }
    // The fields a block with `fields` asks: required with it, allowed with `fieldsOptional`, refused without.
    const requiresFields = blocks.some((b: string) => kind.blocks[b]?.fields);
    const asks = requiresFields || (s.fields !== undefined && blocks.length > 0 && blocks.every((b: string) => kind.blocks[b]?.fieldsOptional));
    let fields: StepField[] | undefined;
    if (s.fields !== undefined && !asks) errors.push({ path: `${at}.fields`, code: 'fields-not-allowed' });
    else if (asks) {
      const checked = stepFieldsErrors(s.fields, `${at}.fields`);
      if (checked.errors.length) errors.push(...checked.errors);
      else fields = checked.fields;
    }
    const privateAnswers = s.privateAnswers === true;
    if (s.privateAnswers !== undefined && typeof s.privateAnswers !== 'boolean') errors.push({ path: `${at}.privateAnswers`, code: 'invalid-private' });
    else if (privateAnswers && !asks) errors.push({ path: `${at}.privateAnswers`, code: 'private-not-allowed' });
    out.push({
      key, do: blocks as string[], assignTo, ...(s.when !== undefined ? { when: s.when as Condition } : {}), reject: reject as RejectMode, ...(label ? { label } : {}),
      ...(each ? { each: true } : {}), ...(fields ? { fields } : {}), ...(fields && privateAnswers ? { privateAnswers: true } : {}),
      ...(message ? { message } : {}),
    });
  });
  for (const [name, block] of Object.entries(kind.blocks)) if (block.required && !done.has(name)) errors.push({ path: 'steps', code: 'block-required' });
  return errors.length ? { ok: false, errors } : { ok: true, value: { version: WORKFLOW_CONFIG_VERSION, steps: out } };
}

/** Whether a (validated) condition holds for the facts; a fact that is missing counts as not matching. */
export function evaluateCondition(cond: Condition, facts: Record<string, unknown>): boolean {
  const [[name, value]] = Object.entries(cond as Record<string, unknown>);
  if (name === 'all') return (value as Condition[]).every((c) => evaluateCondition(c, facts));
  if (name === 'any') return (value as Condition[]).some((c) => evaluateCondition(c, facts));
  if (name === 'not') return !evaluateCondition(value as Condition, facts);
  const fact = facts[name];
  if (typeof value === 'boolean') return fact === value;
  const [[op, operand]] = Object.entries(value as Record<string, unknown>);
  if (typeof fact === 'number') {
    const n = operand as number;
    return op === 'gt' ? fact > n : op === 'gte' ? fact >= n : op === 'lt' ? fact < n : op === 'lte' ? fact <= n : fact === n;
  }
  if (typeof fact === 'string') return op === 'eq' ? fact === operand : (operand as string[]).includes(fact);
  if (Array.isArray(fact)) {
    const list = operand as string[];
    return op === 'any' ? list.some((x) => fact.includes(x)) : op === 'all' ? list.every((x) => fact.includes(x)) : !list.some((x) => fact.includes(x));
  }
  return false;
}

/** One step as the engine runs it (WorkflowsService), compiled from a configuration and stored with each workflow. */
export interface CompiledWorkflowStep {
  key: string;
  label: string;
  labels?: WorkflowStepConfig['label'];
  assignTo: string;
  /** The blocks, in order. */
  blocks: string[];
  /** Run in order when the step is approved. */
  actions: string[];
  /** Run when the step is sent back (reject `back`). */
  returnActions: string[];
  reject: RejectMode;
  rejectable: boolean;
  inDialog?: boolean;
  doneKey?: string;
  actionKey?: string;
  when?: Condition;
  /** Whether nobody to assign means the step is done without anybody (a review whose manager is missing). */
  review?: boolean;
  /** A decision about the submission: the submitter is never among its assignees (four eyes). */
  decides?: boolean;
  /** Every assignee does it, each on their own. */
  each?: boolean;
  /** What it asks whoever does it. */
  fields?: StepField[];
  /** Its answers are for the requester only. */
  privateAnswers?: boolean;
  /** Done by the system when reached: its actions run with the step's assignees as recipients. */
  automatic?: boolean;
  /** What it sends. */
  message?: StepMessage;
  source?: string;
  source_name?: string;
}

/** The engine's steps of a (validated) configuration. */
export function compileWorkflow(kind: WorkflowKindCatalogue, config: WorkflowConfig): CompiledWorkflowStep[] {
  return config.steps.map((s) => {
    const blocks = s.do.map((b) => kind.blocks[b]);
    const reject = s.reject ?? 'none';
    const lastBlock = blocks[blocks.length - 1];
    return {
      key: s.key,
      // English, else the label in another language, else the blocks' names.
      label: s.label?.en ?? Object.values(s.label ?? {}).find(Boolean) ?? blocks.map((b) => b.label).join(' + '),
      ...(s.label ? { labels: s.label } : {}),
      assignTo: s.assignTo,
      blocks: s.do,
      actions: blocks.map((b) => b.action),
      returnActions: reject !== 'none' ? blocks.map((b) => b.returnAction!).filter(Boolean) : [],
      reject,
      rejectable: reject !== 'none',
      ...(blocks.some((b) => b.inDialog) ? { inDialog: true } : {}),
      ...(lastBlock.doneKey ? { doneKey: lastBlock.doneKey } : {}),
      ...(blocks[0].actionKey ? { actionKey: blocks[0].actionKey } : {}),
      ...(s.when ? { when: s.when } : {}),
      ...(s.do.length === 1 && s.do[0] === 'review' ? { review: true } : {}),
      ...(blocks.some((b) => b.decides) ? { decides: true } : {}),
      ...(s.each ? { each: true } : {}),
      ...(s.fields ? { fields: s.fields } : {}),
      ...(s.fields && s.privateAnswers ? { privateAnswers: true } : {}),
      ...(blocks.some((b) => b.automatic) ? { automatic: true } : {}),
      ...(s.message ? { message: s.message } : {}),
      ...(kind.source ? { source: kind.source } : {}),
      ...(kind.source_name ? { source_name: kind.source_name } : {}),
    };
  });
}

/**
 * The index of the first step from `from` on whose condition holds (`facts` asked only when a step has one), and the
 * keys of the steps skipped on the way; -1 when none is left (the workflow is done).
 */
export async function nextApplicableStep(
  steps: readonly { key: string; when?: Condition }[],
  from: number,
  facts: () => Promise<Record<string, unknown>>,
): Promise<{ index: number; skipped: string[] }> {
  const skipped: string[] = [];
  let known: Record<string, unknown> | null = null;
  for (let i = from; i < steps.length; i++) {
    const when = steps[i].when;
    if (!when) return { index: i, skipped };
    known ??= await facts();
    if (evaluateCondition(when, known)) return { index: i, skipped };
    skipped.push(steps[i].key);
  }
  return { index: -1, skipped };
}
