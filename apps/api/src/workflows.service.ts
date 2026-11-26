import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db.service';
import { reachesAll } from './access';
import {
  compileWorkflow, nextApplicableStep, stepFieldValues, validateWorkflowConfig,
  type CompiledWorkflowStep, type StepField, type StepMessage, type WorkflowConfig, type WorkflowKindCatalogue,
} from '@worktime3/shared/workflowConfig';
import { workflows, workflow_definitions, team_members, organization_memberships } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { NotificationsService } from './notifications.service';

/** Employee asks their manager to reopen an already-approved month, with a reason. */
export const REOPEN_TIMESHEET_WORKFLOW_NAME = 'reopen approved timesheet';
/** A submitted month awaiting its owner's manager to approve or reject it. */
export const APPROVE_TIMESHEET_WORKFLOW_NAME = 'approve timesheet';
/** A vacation request awaiting its owner's manager to approve or reject it. */
export const APPROVE_ABSENCE_WORKFLOW_NAME = 'approve absence';
/** A person's month of project time on one project, awaiting that project's owner. */
export const APPROVE_PROJECT_TIMESHEET_WORKFLOW_NAME = 'approve project timesheet';

/**
 * The core's workflows that go to the submitter's manager; they follow the manager when it changes.
 * Plugins add theirs (WorkflowsService.registerManagerRoutedWorkflow).
 */
export const MANAGER_ROUTED_WORKFLOW_NAMES: readonly string[] = [
  REOPEN_TIMESHEET_WORKFLOW_NAME,
  APPROVE_TIMESHEET_WORKFLOW_NAME,
  APPROVE_ABSENCE_WORKFLOW_NAME,
];

/**
 * A step as the engine runs it. Steps of a configurable kind come compiled from the organization's configuration
 * (shared/workflowConfig.ts: `actions`, `returnActions`, `reject`, `when`, `blocks`); older definitions name one
 * `onApprove`/`onReject` action each.
 */
export interface WorkflowStepDefinition extends Partial<Omit<CompiledWorkflowStep, 'key' | 'label' | 'assignTo'>> {
  key: string;
  label: string;
  /** `manager` (the submitter's manager) or `permission:<object>` (everyone holding it with edit on all). */
  assignTo: string;
  /** Text key of the history entry when the step is done (default `approvals.event.approved`). */
  doneKey?: string;
  /** Text key of the step's button on the Workflow page (default `approvals.approve`). */
  actionKey?: string;
  /** false: the step cannot be rejected (it is work to do, not a decision). */
  rejectable?: boolean;
  /** true: the Workflow page does the step in the kind's Inspect dialog (it shows what the step needs). */
  inDialog?: boolean;
  onApprove?: { action: string };
  onReject?: { action: string };
  /** Human label for the kind of record this step's workflow concerns, e.g. "Timesheet Period". */
  source?: string;
  /** Name of the frontend formatter (see Timesheet.tsx's `getSourceTitle`) that renders that record's title. */
  source_name?: string;
}

/** What a registered action handler receives — everything it needs, nothing about workflows itself. */
export interface WorkflowActionContext {
  sourceTable: string;
  sourceTableUuid: string;
  actorUserId: string;
  decisionNote: string | null;
  /** The step being decided (configurable kinds): its key and label, e.g. for a thread event. */
  stepKey?: string;
  stepLabel?: string;
  /** The step's label per language, when the configuration gives them. */
  stepLabels?: Partial<Record<string, string>>;
  /** The step's blocks (its name in the reader's language when the configuration gives none). */
  stepBlocks?: string[];
  /** The step was done without anybody (a manager's review without a manager). */
  automatic?: boolean;
  /** What the actor filled in the step's fields (a block with `fields`), checked, with the fields. */
  values?: Record<string, string | number | boolean>;
  fields?: StepField[];
  /** The answers are for the requester only (the step's `privateAnswers`). */
  privateAnswers?: boolean;
  /** An automatic step (e.g. a message): who it goes to, and what it sends. */
  recipients?: string[];
  message?: StepMessage;
}
export type WorkflowActionHandler = (db: Db, ctx: WorkflowActionContext) => Promise<void>;
/**
 * One step in a workflow's history (`workflow_data.history`): what happened (`key`, a text key of the
 * web app's, e.g. `approvals.event.approved`, or a plugin's own), who did it and when. The core writes
 * submitted and the decision; modules and plugins add what follows (`recordEvent`).
 */
export interface WorkflowEvent {
  key: string;
  by: string | null;
  at: string;
  note?: string | null;
}

/**
 * A workflow's history: the stored one, else what its timestamps tell (rows from before the history
 * was kept: who decided is not known then).
 */
export function workflowHistory(
  data: unknown,
  row: { started: string | null; finished: string | null; status: string | null },
): WorkflowEvent[] {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (Array.isArray(d.history)) {
    return (d.history as unknown[]).filter((e): e is WorkflowEvent => !!e && typeof e === 'object' && typeof (e as WorkflowEvent).key === 'string' && typeof (e as WorkflowEvent).at === 'string');
  }
  const out: WorkflowEvent[] = [];
  if (row.started) out.push({ key: 'approvals.event.submitted', by: typeof d.submittedByUserId === 'string' ? d.submittedByUserId : null, at: row.started });
  if (row.finished && (row.status === 'approved' || row.status === 'rejected')) {
    out.push({ key: `approvals.event.${row.status}`, by: null, at: row.finished, note: typeof d.decisionNote === 'string' ? d.decisionNote : null });
  }
  return out;
}

export type SourceOrgResolver = (db: Db, sourceTableUuid: string) => Promise<string | null>;

/**
 * A configurable kind of workflow a module offers (shared/workflowConfig.ts): its catalogue of building blocks and
 * facts, the record table it is about and how to read a record's facts for the steps' conditions.
 */
export interface WorkflowKind {
  catalogue: WorkflowKindCatalogue;
  description: string;
  sourceTable: string;
  facts?: (db: Db, sourceTableUuid: string) => Promise<Record<string, unknown>>;
  /**
   * One configuration per variant (e.g. per request type, its key): the variants an organization has. A variant's
   * definition is `<definitionName>:<variant>`; without a stored configuration it has no workflow (start returns null).
   */
  variants?: (db: Db, organizationId: string) => Promise<{ key: string; label: string }[]>;
  /** The catalogue for an organization (and variant), e.g. with facts from its form's fields; else `catalogue`. */
  catalogueFor?: (db: Db, organizationId: string, variant?: string) => Promise<WorkflowKindCatalogue>;
  /**
   * Runs when a workflow of the kind finishes approved (its last step done): e.g. the record becomes "approved" only
   * then, not at a first approval with more to come.
   */
  onFinished?: (db: Db, sourceTableUuid: string, actorUserId: string, core: { versions: VersionsService }) => Promise<void>;
}
/**
 * Loads the records of one source table for the Workflow page (GET workflows/assigned-to-me): one
 * object per id with at least `id`, `user_id`, `user_display_name`, `user_email`, plus whatever the
 * page shows of it (the web part's workflow kind reads it from the item's `field`).
 */
export type SourceRecordLoader = (db: Db, ids: string[]) => Promise<Array<{ id: string } & Record<string, unknown>>>;

/**
 * Shared engine behind every workflow_definitions-driven approval in the
 * app: create a workflow, find the one pending for a record, and
 * approve/reject it (authorizing, recording the decision, and running
 * whatever side effect that workflow type calls for). Used both by
 * WorkflowsController's generic `/workflows/:id/approve` endpoint and by
 * TimesheetsController's period-id-based approve/reject, which now delegate
 * here instead of mutating timesheet_periods directly.
 *
 * This service knows nothing about timesheets or any other specific source
 * table — it only dispatches by name. A step's `onApprove`/`onReject.action`
 * (e.g. "timesheet.approve") is looked up in `actionHandlers`, registered by
 * whichever module owns that kind of record (e.g. TimesheetsController
 * registers the "timesheet.*" actions in its `onModuleInit`). Each workflow
 * row holds its organization (`organization_id`, 107).
 */
@Injectable()
export class WorkflowsService {
  private readonly actionHandlers = new Map<string, WorkflowActionHandler>();
  private readonly sourceRecordLoaders = new Map<string, { field: string; load: SourceRecordLoader }>();
  private readonly managerRouted = new Set<string>(MANAGER_ROUTED_WORKFLOW_NAMES);
  private readonly kindsById = new Map<string, WorkflowKind>();

  /** A kind's definition name (one per variant for kinds with variants). */
  private definitionNameOf(kind: WorkflowKind, variant?: string): string {
    return kind.variants && variant ? `${kind.catalogue.definitionName}:${variant}` : kind.catalogue.definitionName;
  }

  /** The kind's catalogue for an organization (and variant). */
  async catalogueOf(db: Db, organizationId: string, kindId: string, variant?: string): Promise<WorkflowKindCatalogue | null> {
    const kind = this.kindsById.get(kindId);
    if (!kind) return null;
    return kind.catalogueFor ? kind.catalogueFor(db, organizationId, variant) : kind.catalogue;
  }

  /** The kind a workflow of `sourceTable` belongs to. */
  private kindOfTable(sourceTable: string): WorkflowKind | undefined {
    return [...this.kindsById.values()].find((k) => k.sourceTable === sourceTable);
  }

  constructor(
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Register what happens when a step's onApprove/onReject names this action. */
  registerAction(name: string, handler: WorkflowActionHandler): void {
    this.actionHandlers.set(name, handler);
  }

  /** Register how the Workflow page gets a source table's records, and the item field it puts them in (e.g. `expense_report`). */
  registerSourceRecords(sourceTable: string, field: string, load: SourceRecordLoader): void {
    this.sourceRecordLoaders.set(sourceTable, { field, load });
  }

  /**
   * Adds what happened to a record after its approval (e.g. an expense report's processing) to the
   * history of its newest workflow; nothing when it has none. `key` is a text key of the web app's.
   */
  async recordEvent(db: Db, sourceTable: string, sourceTableUuid: string, event: { key: string; by: string; note?: string | null }): Promise<void> {
    const [row] = await db
      .select({ id: workflows.workflow_id, data: workflows.workflow_data, started: workflows.workflow_started, finished: workflows.workflow_finished, status: workflows.step_status })
      .from(workflows)
      .where(and(eq(workflows.source_table, sourceTable), eq(workflows.source_table_uuid, sourceTableUuid)))
      .orderBy(sql`${workflows.workflow_started} DESC NULLS LAST`)
      .limit(1);
    if (!row) return;
    const history = [...workflowHistory(row.data, row), { key: event.key, by: event.by, at: new Date().toISOString(), note: event.note ?? null }];
    await db.update(workflows).set({ workflow_data: { ...(row.data as Record<string, unknown>), history } }).where(eq(workflows.workflow_id, row.id));
  }

  /** The registered record loaders (WorkflowsController adds their records to each item). */
  sourceRecords(): ReadonlyMap<string, { field: string; load: SourceRecordLoader }> {
    return this.sourceRecordLoaders;
  }

  /** Register a configurable kind of workflow (its steps then come from the organization's configuration). */
  registerKind(kind: WorkflowKind): void {
    this.kindsById.set(kind.catalogue.id, kind);
    this.managerRouted.add(kind.catalogue.definitionName);
  }

  /** The configurable kinds, by id. */
  kinds(): ReadonlyMap<string, WorkflowKind> {
    return this.kindsById;
  }

  /** The organization's own configuration of a kind (or one of its variants), validated, or null when it has none. */
  async ownConfig(db: Db, organizationId: string, kindId: string, variant?: string): Promise<WorkflowConfig | null> {
    const kind = this.kindsById.get(kindId);
    if (!kind) return null;
    const [row] = await db
      .select({ config: workflow_definitions.config })
      .from(workflow_definitions)
      .where(and(eq(workflow_definitions.organization_id, organizationId), eq(workflow_definitions.name, this.definitionNameOf(kind, variant))));
    if (!row?.config) return null;
    // A stored configuration the catalogue no longer accepts (a module or a form changed) counts as none.
    const checked = validateWorkflowConfig((await this.catalogueOf(db, organizationId, kindId, variant))!, row.config);
    return checked.ok ? checked.value : null;
  }

  /**
   * Stores an organization's configuration of a kind (null = back to the default). The caller validated it; new
   * workflows use it, running ones keep their steps.
   */
  async saveConfig(db: Db, organizationId: string, kindId: string, config: WorkflowConfig | null, callerId: string, variant?: string): Promise<void> {
    const kind = this.kindsById.get(kindId);
    if (!kind) throw new Error(`unknown workflow kind ${kindId}`);
    const catalogue = (await this.catalogueOf(db, organizationId, kindId, variant))!;
    const steps = compileWorkflow(catalogue, config ?? catalogue.defaultConfig);
    const definition = await this.ensureDefinition(db, organizationId, this.definitionNameOf(kind, variant), kind.description, steps as unknown as WorkflowStepDefinition[]);
    await db.update(workflow_definitions).set({ config }).where(eq(workflow_definitions.workflow_def_id, definition.workflow_def_id));
    void this.versions.record('workflow_definitions', definition.workflow_def_id, 'update_delta', callerId, { config }).catch(() => {});
  }

  /**
   * Starts a workflow of a configurable kind for a record: its steps from the organization's configuration (kept with
   * the workflow), the first step that applies, its assignees notified. A review step going to a manager nobody has
   * (the top of the chain) is done at once ("approved automatically"), as are steps whose condition doesn't hold
   * ("skipped"); when no step is left the workflow is approved. `autoApproved`: the first step was done that way.
   */
  async start(
    db: Db,
    params: {
      kind: string;
      /** For a kind with variants: which one (without its own configuration it has no workflow: null). */
      variant?: string;
      organizationId: string;
      sourceTableUuid: string;
      actorUserId: string;
      workflowData: Record<string, unknown>;
      notification: { title: string; body?: string };
    },
  ): Promise<{ id: string; autoApproved: boolean; finished: boolean } | null> {
    const kind = this.kindsById.get(params.kind);
    if (!kind) throw new Error(`unknown workflow kind ${params.kind}`);
    const own = await this.ownConfig(db, params.organizationId, params.kind, params.variant);
    if (!own && kind.variants) return null;
    const catalogue = (await this.catalogueOf(db, params.organizationId, params.kind, params.variant))!;
    const steps = compileWorkflow(catalogue, own ?? catalogue.defaultConfig) as unknown as WorkflowStepDefinition[];
    const definition = await this.ensureDefinition(db, params.organizationId, this.definitionNameOf(kind, params.variant), kind.description, steps);
    const now = new Date().toISOString();
    const history: WorkflowEvent[] = [{ key: 'approvals.event.submitted', by: params.actorUserId, at: now }];
    const placed = await this.place(db, {
      steps, from: 0, organizationId: params.organizationId, sourceTable: kind.sourceTable, sourceTableUuid: params.sourceTableUuid,
      submittedBy: params.actorUserId, actor: params.actorUserId, history,
    });
    const values = {
      workflow_def_id: definition.workflow_def_id,
      organization_id: params.organizationId,
      source_table: kind.sourceTable,
      source_table_uuid: params.sourceTableUuid,
      workflow_data: { ...params.workflowData, submittedByUserId: params.actorUserId, history: placed.history },
      workflow_started: now,
      step: placed.index >= 0 ? steps[placed.index].key : steps[steps.length - 1].key,
      step_status: placed.index >= 0 ? 'pending' : 'approved',
      workflow_step_started: now,
      ...(placed.index >= 0 ? {} : { workflow_step_finished: now, workflow_finished: now }),
      assigned_to_user_id: placed.assignees,
      assigned_to_team_id: null,
      steps,
    };
    const [workflow] = await db.insert(workflows).values(values).returning({ id: workflows.workflow_id });
    void this.versions.record('workflows', workflow.id, 'insert', params.actorUserId, { id: workflow.id, ...values }).catch(() => {});
    if (placed.index < 0) await kind.onFinished?.(db, params.sourceTableUuid, params.actorUserId, { versions: this.versions });
    if (placed.index >= 0) {
      void this.notifyAssignees(db, {
        organizationId: params.organizationId, sourceTable: kind.sourceTable, assignedToUserId: placed.assignees, excludeUserId: params.actorUserId, type: 'workflow.assigned',
        title: params.notification.title, body: params.notification.body, sourceTableUuid: params.sourceTableUuid, workflowId: workflow.id,
      }).catch((err) => console.error('notify-assignees-failed', err));
    }
    return { id: workflow.id, autoApproved: placed.autoApproved.includes(steps[0].key), finished: placed.index < 0 };
  }

  /**
   * From step `from` on: skips the steps whose condition doesn't hold, does at once a review that goes to a manager
   * nobody has, and returns the step that waits (with its assignees and the history so far), or -1 when none is left.
   */
  private async place(
    db: Db,
    p: {
      steps: WorkflowStepDefinition[]; from: number; organizationId: string | null; sourceTable: string; sourceTableUuid: string;
      submittedBy: string | undefined; actor: string; history: WorkflowEvent[];
    },
  ): Promise<{ index: number; assignees: string[]; history: WorkflowEvent[]; autoApproved: string[] }> {
    const history = [...p.history];
    const autoApproved: string[] = [];
    const kind = this.kindOfTable(p.sourceTable);
    let facts: Record<string, unknown> | null = null;
    const readFacts = async () => (facts ??= kind?.facts ? await kind.facts(db, p.sourceTableUuid).catch(() => ({})) : {});
    for (let from = p.from; ;) {
      const { index, skipped } = await nextApplicableStep(p.steps, from, readFacts);
      const at = new Date().toISOString();
      for (const key of skipped) history.push({ key: 'approvals.event.skipped', by: null, at, note: p.steps.find((s) => s.key === key)?.label ?? key });
      if (index < 0) return { index, assignees: [], history, autoApproved };
      const step = p.steps[index];
      const assignees = await this.stepAssignees(db, p.organizationId, step, p.submittedBy, p.actor);
      // An automatic step (a message): the system does it now, to its assignees, and the workflow moves on.
      if (step.automatic) {
        for (const action of step.actions ?? []) {
          await this.runNamedAction(db, action, {
            sourceTable: p.sourceTable, sourceTableUuid: p.sourceTableUuid, actorUserId: p.actor, decisionNote: null,
            stepKey: step.key, stepLabel: step.label, stepLabels: step.labels, stepBlocks: step.blocks, automatic: true, recipients: assignees, ...(step.message ? { message: step.message } : {}),
          }).catch((err) => console.error('workflow-automatic-step-failed', err));
        }
        history.push({ key: step.doneKey ?? 'approvals.event.sent', by: null, at, note: step.label });
        from = index + 1;
        continue;
      }
      if (assignees.length) return { index, assignees, history, autoApproved };
      // Only a manager's review without a manager gets here: done at once, as submitting did before.
      for (const action of step.actions ?? []) {
        await this.runNamedAction(db, action, { sourceTable: p.sourceTable, sourceTableUuid: p.sourceTableUuid, actorUserId: p.actor, decisionNote: null, stepKey: step.key, stepLabel: step.label, stepLabels: step.labels, stepBlocks: step.blocks, automatic: true });
      }
      history.push({ key: 'approvals.event.autoApproved', by: null, at });
      autoApproved.push(step.key);
      from = index + 1;
    }
  }

  /**
   * Marks the block `block` of a record's pending step done when the module did the work on its own page (e.g.
   * expense processing): the step's last block moves the workflow on (without running its actions again), an earlier
   * one is recorded in the history (`eventKey`). False when the record has no pending configurable step with it.
   */
  async completeBlock(db: Db, sourceTable: string, sourceTableUuid: string, block: string, eventKey: string, callerId: string, note: string | null = null): Promise<boolean> {
    const workflow = await this.loadWorkflow(
      db,
      and(eq(workflows.source_table, sourceTable), eq(workflows.source_table_uuid, sourceTableUuid), eq(workflows.step_status, 'pending')),
    );
    if (!workflow) return false;
    const step = this.stepsOf(workflow).find((s) => s.key === workflow.step);
    const blocks = step?.blocks ?? [];
    if (!blocks.includes(block)) return false;
    if (blocks[blocks.length - 1] !== block) {
      await this.recordEvent(db, sourceTable, sourceTableUuid, { key: eventKey, by: callerId, note });
      return true;
    }
    return (await this.advance(db, workflow, workflow.organization_id, callerId, 'approved', note, false)).ok;
  }

  /**
   * The person who submitted withdraws: the record's pending workflow ends (rejected, "withdrawn" in its history).
   * The caller authorized it and changes the record itself.
   */
  async withdraw(db: Db, sourceTable: string, sourceTableUuid: string, callerId: string): Promise<boolean> {
    const workflow = await this.loadWorkflow(
      db,
      and(eq(workflows.source_table, sourceTable), eq(workflows.source_table_uuid, sourceTableUuid), eq(workflows.step_status, 'pending')),
    );
    if (!workflow) return false;
    const now = new Date().toISOString();
    const history = [...workflowHistory(workflow.workflow_data, { started: workflow.started, finished: null, status: 'pending' }), { key: 'approvals.event.withdrawn', by: callerId, at: now }];
    const patch = { step_status: 'rejected', workflow_step_finished: now, workflow_finished: now, workflow_data: { ...(workflow.workflow_data as Record<string, unknown>), history } };
    await db.update(workflows).set(patch).where(eq(workflows.workflow_id, workflow.id));
    void this.versions.record('workflows', workflow.id, 'update_delta', callerId, patch).catch(() => {});
    return true;
  }

  /** Whether an organization's stored workflow configurations name `department:<code>` or `team:<code>`. */
  async unitInUse(db: Db, organizationId: string, unit: 'department' | 'team', code: string): Promise<boolean> {
    const rows = await db.execute(sql`
      SELECT 1 FROM workflow_definitions
      WHERE organization_id = ${organizationId}::uuid AND config IS NOT NULL AND strpos(config::text, ${`"${unit}:${code}"`}) > 0 LIMIT 1`);
    return rows.rows.length > 0;
  }

  /** A department's or team's code changed: the organization's stored configurations follow (running workflows have their assignees). */
  async renameUnit(db: Db, organizationId: string, unit: 'department' | 'team', from: string, to: string): Promise<void> {
    await db.execute(sql`
      UPDATE workflow_definitions SET config = replace(config::text, ${`"${unit}:${from}"`}, ${`"${unit}:${to}"`})::jsonb
      WHERE organization_id = ${organizationId}::uuid AND config IS NOT NULL AND strpos(config::text, ${`"${unit}:${from}"`}) > 0`);
  }

  /** A workflow's steps: the ones it started with, else (older workflows) its definition's. */
  private stepsOf(workflow: { own_steps?: unknown; steps: unknown }): WorkflowStepDefinition[] {
    const steps = Array.isArray(workflow.own_steps) ? workflow.own_steps : workflow.steps;
    return Array.isArray(steps) ? (steps as WorkflowStepDefinition[]) : [];
  }

  /** Register a workflow (by definition name) that goes to the submitter's manager and follows it when it changes. */
  registerManagerRoutedWorkflow(name: string): void {
    this.managerRouted.add(name);
  }

  /** Every team this user belongs to, across whatever memberships they hold — used to resolve team-assigned workflows. */
  async callerTeamIds(db: Db, userId: string): Promise<string[]> {
    const rows = await db
      .select({ team_id: team_members.team_id })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .where(eq(organization_memberships.user_id, userId));
    return rows.map((r) => r.team_id);
  }

  /**
   * Find-or-create a per-org workflow definition by name, so nobody has to set these up by hand.
   * The step config is entirely code-defined (there's no UI to edit it), so an existing row is kept
   * in sync with whatever the caller just passed in rather than left stale from when it was first created.
   */
  async ensureDefinition(db: Db, organizationId: string, name: string, description: string, steps: WorkflowStepDefinition[]) {
    const [existing] = await db
      .select({ workflow_def_id: workflow_definitions.workflow_def_id })
      .from(workflow_definitions)
      .where(and(eq(workflow_definitions.organization_id, organizationId), eq(workflow_definitions.name, name)));
    if (existing) {
      await db.update(workflow_definitions).set({ description, steps }).where(eq(workflow_definitions.workflow_def_id, existing.workflow_def_id));
      return existing;
    }
    const [created] = await db
      .insert(workflow_definitions)
      .values({ organization_id: organizationId, name, description, steps })
      .returning({ workflow_def_id: workflow_definitions.workflow_def_id });
    return created;
  }

  /** Create one workflow row with a single pending step, assigned to one or more users and/or a team. The requester's text lives in `workflowData`. */
  async createWorkflow(
    db: Db,
    params: {
      workflowDefId: string;
      sourceTable: string;
      sourceTableUuid: string;
      step: string;
      assignedToUserId?: string[];
      assignedToTeamId?: string;
      workflowData: Record<string, unknown>;
      actorUserId: string;
      /** Human copy for the notification sent to every resolved assignee. */
      notification: { title: string; body?: string };
    },
  ) {
    const now = new Date().toISOString();
    const [definition] = await db
      .select({ organization_id: workflow_definitions.organization_id })
      .from(workflow_definitions)
      .where(eq(workflow_definitions.workflow_def_id, params.workflowDefId));
    if (!definition) throw new Error('workflow-definition-not-found');
    const values = {
      workflow_def_id: params.workflowDefId,
      organization_id: definition.organization_id,
      source_table: params.sourceTable,
      source_table_uuid: params.sourceTableUuid,
      // Captures who to notify back on resolve() — generically, for every workflow type,
      // without a per-source-table lookup.
      workflow_data: {
        ...params.workflowData,
        submittedByUserId: params.actorUserId,
        history: [{ key: 'approvals.event.submitted', by: params.actorUserId, at: now }] satisfies WorkflowEvent[],
      },
      workflow_started: now,
      step: params.step,
      step_status: 'pending',
      workflow_step_started: now,
      assigned_to_user_id: params.assignedToUserId ?? null,
      assigned_to_team_id: params.assignedToTeamId ?? null,
    };
    const [workflow] = await db.insert(workflows).values(values).returning({ id: workflows.workflow_id });
    void this.versions.record('workflows', workflow.id, 'insert', params.actorUserId, { id: workflow.id, ...values }).catch(() => {});

    void this.notifyAssignees(db, {
      organizationId: definition.organization_id,
      sourceTable: params.sourceTable,
      assignedToUserId: params.assignedToUserId,
      assignedToTeamId: params.assignedToTeamId,
      excludeUserId: params.actorUserId,
      type: 'workflow.assigned',
      title: params.notification.title,
      body: params.notification.body,
      sourceTableUuid: params.sourceTableUuid,
      workflowId: workflow.id,
    }).catch((err) => console.error('notify-assignees-failed', err));

    return workflow;
  }

  /** Resolve a workflow's assignees (direct users and/or a team's members) and notify each of them once. */
  private async notifyAssignees(
    db: Db,
    params: {
      organizationId: string;
      sourceTable: string;
      assignedToUserId?: string[];
      assignedToTeamId?: string;
      excludeUserId: string;
      type: string;
      title: string;
      body?: string;
      sourceTableUuid: string;
      workflowId: string;
    },
  ) {
    const recipientIds = new Set(params.assignedToUserId ?? []);
    if (params.assignedToTeamId) {
      const rows = await db
        .select({ user_id: organization_memberships.user_id })
        .from(team_members)
        .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
        .where(eq(team_members.team_id, params.assignedToTeamId));
      for (const row of rows) recipientIds.add(row.user_id);
    }
    recipientIds.delete(params.excludeUserId);
    if (recipientIds.size === 0) return;

    await this.notifications.notifyMany({
      organizationId: params.organizationId,
      recipientUserIds: [...recipientIds],
      type: params.type,
      title: params.title,
      body: params.body,
      sourceTable: params.sourceTable,
      sourceTableUuid: params.sourceTableUuid,
      workflowId: params.workflowId,
      data: { workflowId: params.workflowId, sourceTable: params.sourceTable, sourceTableUuid: params.sourceTableUuid },
    });
  }

  /**
   * Managers are dated (employee_assignments), so a pending request sent to someone's manager
   * moves to whoever is their manager today: after an assignment changes, and whenever a dated
   * change has come into force since. Only requests still with one of the person's managers
   * (current or past) move; a request already elsewhere, or a person without a manager now, stays.
   * The new manager is notified. Returns how many requests moved.
   */
  async rerouteToCurrentManagers(db: Db): Promise<number> {
    const names = sql.join([...this.managerRouted].map((n) => sql`${n}`), sql`, `);
    // Kinds with variants have one definition per variant (`<name>:<variant>`).
    const prefixes = [...this.kindsById.values()].filter((k) => k.variants).map((k) => `${k.catalogue.definitionName}:`);
    const prefixed = prefixes.length ? sql.join(prefixes.map((p) => sql` OR starts_with(d.name, ${p})`), sql``) : sql``;
    const pendingResult = await db.execute(sql`
      SELECT w.workflow_id, w.organization_id, w.source_table, w.source_table_uuid, w.assigned_to_user_id[1] AS assignee,
             (w.workflow_data->>'submittedByUserId')::uuid AS subject
      FROM workflows w
      JOIN workflow_definitions d ON d.workflow_def_id = w.workflow_def_id
      WHERE w.step_status = 'pending' AND (d.name IN (${names})${prefixed})
        AND cardinality(w.assigned_to_user_id) = 1
        -- Only steps that go to the manager (a later step, e.g. processing, has its own assignees).
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(w.steps, d.steps)) = 'array' THEN COALESCE(w.steps, d.steps) ELSE '[]'::jsonb END) st
                        WHERE st->>'key' = w.step AND COALESCE(st->>'assignTo', 'manager') <> 'manager')
        AND jsonb_exists(w.workflow_data, 'submittedByUserId')`);
    const pending = pendingResult.rows as { workflow_id: string; organization_id: string; source_table: string; source_table_uuid: string; assignee: string; subject: string }[];
    if (pending.length === 0) return 0;
    const values = sql.join(
      pending.map((p) => sql`(${p.workflow_id}::uuid, ${p.organization_id}::uuid, ${p.subject}::uuid, ${p.assignee}::uuid)`),
      sql`, `,
    );
    const result = await db.execute(sql`
      WITH pending(workflow_id, organization_id, subject, assignee) AS (VALUES ${values}),
      moved AS (
        SELECT p.*, (
          SELECT a.manager_user_id FROM employee_assignments a
          WHERE a.organization_id = p.organization_id AND a.user_id = p.subject AND a.valid_from <= CURRENT_DATE
          ORDER BY a.valid_from DESC LIMIT 1
        ) AS manager
        FROM pending p
      )
      UPDATE workflows w SET assigned_to_user_id = ARRAY[m.manager]
      FROM moved m
      WHERE w.workflow_id = m.workflow_id AND w.step_status = 'pending' AND w.assigned_to_user_id[1] = m.assignee
        AND m.manager IS NOT NULL AND m.manager <> m.assignee
        AND EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.organization_id = m.organization_id AND ea.user_id = m.subject AND ea.manager_user_id = m.assignee
        )
      RETURNING w.workflow_id, w.source_table, w.source_table_uuid, m.organization_id, m.manager`);
    const rows = result.rows as { workflow_id: string; source_table: string; source_table_uuid: string; organization_id: string; manager: string }[];
    for (const r of rows) {
      void this.versions.record('workflows', r.workflow_id, 'update_delta', null, { assigned_to_user_id: [r.manager] }).catch(() => {});
      void this.notifications
        .notifyMany({
          organizationId: r.organization_id,
          recipientUserIds: [r.manager],
          type: 'workflow.assigned',
          title: 'A request was passed on to you as the new manager',
          sourceTable: r.source_table,
          sourceTableUuid: r.source_table_uuid,
          workflowId: r.workflow_id,
          data: { workflowId: r.workflow_id, sourceTable: r.source_table, sourceTableUuid: r.source_table_uuid },
        })
        .catch(() => {});
    }
    return rows.length;
  }

  /** The pending workflow (if any) for a record — lets a record-specific endpoint (e.g. timesheet-periods/:id/approve) delegate to it. */
  async findPending(db: Db, sourceTable: string, sourceTableUuid: string, definitionName?: string) {
    const conditions = [
      eq(workflows.source_table, sourceTable),
      eq(workflows.source_table_uuid, sourceTableUuid),
      eq(workflows.step_status, 'pending'),
    ];
    if (definitionName) conditions.push(eq(workflow_definitions.name, definitionName));
    const [row] = await db
      .select({ id: workflows.workflow_id })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(and(...conditions));
    return row ?? null;
  }

  /**
   * The organization of a workflow the caller acts on (assignee, through a team, or an approvals grant
   * reaching everyone), else null: the same people `resolve` lets decide.
   */
  async actorOrganization(db: Db, workflowId: string, callerId: string): Promise<string | null> {
    const [workflow] = await db
      .select({ organization_id: workflows.organization_id, assigned_to_user_id: workflows.assigned_to_user_id, assigned_to_team_id: workflows.assigned_to_team_id })
      .from(workflows)
      .where(eq(workflows.workflow_id, workflowId));
    if (!workflow) return null;
    const organizationId = workflow.organization_id;
    if ((workflow.assigned_to_user_id ?? []).includes(callerId)) return organizationId;
    if (workflow.assigned_to_team_id && (await this.callerTeamIds(db, callerId)).includes(workflow.assigned_to_team_id)) return organizationId;
    return (await reachesAll(db, organizationId, callerId, 'nav.approvals', 'edit')) ? organizationId : null;
  }

  /**
   * Approve or reject a workflow's pending step: authorizes, records it, runs the step's side effect,
   * and moves on to the next step (new assignees, notified) or finishes the workflow after the last.
   */
  async resolve(
    db: Db,
    workflowId: string,
    callerId: string,
    outcome: 'approved' | 'rejected',
    note: string | undefined,
    values?: unknown,
  ): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
    // A dated manager change may have come into force since the request was routed.
    await this.rerouteToCurrentManagers(db).catch(() => 0);
    const workflow = await this.loadWorkflow(db, eq(workflows.workflow_id, workflowId));
    if (!workflow) return { ok: false, error: 'workflow-not-found' };

    const organizationId = workflow.organization_id;
    const isDirectAssignee = (workflow.assigned_to_user_id ?? []).includes(callerId);
    const isTeamAssignee = workflow.assigned_to_team_id
      ? (await this.callerTeamIds(db, callerId)).includes(workflow.assigned_to_team_id)
      : false;
    // An approvals grant reaching everyone (admin by default) may resolve any workflow of the org.
    const isOverride = organizationId ? await reachesAll(db, organizationId, callerId, 'nav.approvals', 'edit') : false;
    if (!isDirectAssignee && !isTeamAssignee && !isOverride) return { ok: false, error: 'forbidden' };
    if (workflow.step_status !== 'pending') return { ok: false, error: 'not-pending' };
    // Four eyes: nobody decides their own submission, not even with a grant reaching every workflow.
    const step = this.stepsOf(workflow).find((s) => s.key === workflow.step);
    const submittedBy = (workflow.workflow_data as Record<string, unknown> | null)?.submittedByUserId;
    if (step?.decides && submittedBy === callerId) return { ok: false, error: 'own-submission' };
    // A step with fields: what the caller fills, checked (only when done; sending back asks nothing).
    let given: Record<string, string | number | boolean> | undefined;
    if (outcome === 'approved' && step?.fields?.length) {
      const checked = stepFieldValues(step.fields, values);
      if (!checked.ok) return { ok: false, error: checked.error, field: checked.field };
      given = checked.values;
    }
    return this.advance(db, workflow, organizationId, callerId, outcome, note?.trim() || null, true, given, isDirectAssignee);
  }

  /**
   * Marks a record's pending step `stepKey` done when the module did the work itself (e.g. expense
   * processing on its own page): the workflow moves on as if the step was approved, without running
   * the step's action again. The caller authorizes. Nothing when no workflow waits at that step.
   */
  async completeStep(db: Db, sourceTable: string, sourceTableUuid: string, stepKey: string, callerId: string, note: string | null = null): Promise<boolean> {
    const workflow = await this.loadWorkflow(
      db,
      and(eq(workflows.source_table, sourceTable), eq(workflows.source_table_uuid, sourceTableUuid), eq(workflows.step, stepKey), eq(workflows.step_status, 'pending')),
    );
    if (!workflow) return false;
    return (await this.advance(db, workflow, workflow.organization_id, callerId, 'approved', note, false)).ok;
  }

  private async loadWorkflow(db: Db, where: SQL | undefined) {
    const [workflow] = await db
      .select({
        id: workflows.workflow_id,
        organization_id: workflows.organization_id,
        source_table: workflows.source_table,
        source_table_uuid: workflows.source_table_uuid,
        step: workflows.step,
        step_status: workflows.step_status,
        assigned_to_user_id: workflows.assigned_to_user_id,
        assigned_to_team_id: workflows.assigned_to_team_id,
        workflow_data: workflows.workflow_data,
        started: workflows.workflow_started,
        definition_name: workflow_definitions.name,
        steps: workflow_definitions.steps,
        own_steps: workflows.steps,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(where)
      .orderBy(sql`${workflows.workflow_started} DESC NULLS LAST`)
      .limit(1);
    return workflow ?? null;
  }

  private async advance(
    db: Db,
    workflow: NonNullable<Awaited<ReturnType<WorkflowsService['loadWorkflow']>>>,
    organizationId: string | null,
    callerId: string,
    outcome: 'approved' | 'rejected',
    decisionNote: string | null,
    runAction: boolean,
    values?: Record<string, string | number | boolean>,
    asAssignee = false,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const stepDefs = this.stepsOf(workflow);
    const index = stepDefs.findIndex((s) => s.key === workflow.step);
    const stepDef = index >= 0 ? stepDefs[index] : undefined;
    if (outcome === 'rejected' && (stepDef?.rejectable === false || stepDef?.reject === 'none')) return { ok: false, error: 'not-rejectable' };
    const submittedByUserId = (workflow.workflow_data as Record<string, unknown> | null)?.submittedByUserId as string | undefined;

    // The step's own work first (a later step done at once may build on it).
    if (runAction) await this.runAction(db, { ...workflow, steps: stepDefs }, outcome, callerId, decisionNote, values);

    const now = new Date().toISOString();
    // What the caller filled in, kept per step and person (`workflow_data.inputs`).
    const priorData = workflow.workflow_data as Record<string, unknown>;
    const inputs = values && workflow.step
      ? { inputs: { ...(priorData.inputs as Record<string, unknown> ?? {}), [workflow.step]: { ...((priorData.inputs as Record<string, Record<string, unknown>> | undefined)?.[workflow.step] ?? {}), [callerId]: { values, at: now } } } }
      : {};
    const event: WorkflowEvent = {
      key: outcome === 'rejected' ? (stepDef?.reject === 'back' ? 'approvals.event.returned' : 'approvals.event.rejected') : (stepDef?.doneKey ?? 'approvals.event.approved'),
      by: callerId,
      at: now,
      note: decisionNote,
    };
    const soFar = [...workflowHistory(workflow.workflow_data, { started: workflow.started, finished: null, status: 'pending' }), event];
    // Each on their own: the step stays until every assignee did it (one who sends it back sends it back for all).
    const remaining = (workflow.assigned_to_user_id ?? []).filter((id) => id !== callerId);
    if (outcome === 'approved' && stepDef?.each && asAssignee && remaining.length > 0) {
      const patch = { assigned_to_user_id: remaining, workflow_data: { ...priorData, ...inputs, history: soFar } };
      await db.update(workflows).set(patch).where(eq(workflows.workflow_id, workflow.id));
      void this.versions.record('workflows', workflow.id, 'update_delta', callerId, patch).catch(() => {});
      if (organizationId) void this.audit.record(organizationId, callerId, 'workflow.approved', 'workflow', workflow.id).catch(() => {});
      return { ok: true };
    }
    const placed = outcome === 'approved' && index >= 0
      ? await this.place(db, {
        steps: stepDefs, from: index + 1, organizationId, sourceTable: workflow.source_table, sourceTableUuid: workflow.source_table_uuid,
        submittedBy: submittedByUserId, actor: callerId, history: soFar,
      })
      : { index: -1, assignees: [], history: soFar, autoApproved: [] };
    const next = placed.index >= 0 ? stepDefs[placed.index] : undefined;
    const workflowData = {
      ...(workflow.workflow_data as Record<string, unknown>),
      ...inputs,
      ...(index <= 0 ? { decisionNote } : {}),
      history: placed.history satisfies WorkflowEvent[],
    };
    const patch = next
      ? {
          step: next.key,
          step_status: 'pending',
          workflow_step_started: now,
          workflow_step_finished: null,
          assigned_to_user_id: placed.assignees,
          assigned_to_team_id: null,
          workflow_data: workflowData,
        }
      : { step_status: outcome, workflow_step_finished: now, workflow_finished: now, workflow_data: workflowData };
    await db.update(workflows).set(patch).where(eq(workflows.workflow_id, workflow.id));
    void this.versions.record('workflows', workflow.id, 'update_delta', callerId, patch).catch(() => {});
    if (!next && outcome === 'approved') await this.kindOfTable(workflow.source_table)?.onFinished?.(db, workflow.source_table_uuid, callerId, { versions: this.versions });

    if (organizationId) {
      void this.audit.record(organizationId, callerId, `workflow.${outcome}`, 'workflow', workflow.id).catch(() => {});
      if (next) {
        void this.notifyAssignees(db, {
          organizationId,
          sourceTable: workflow.source_table,
          assignedToUserId: placed.assignees,
          excludeUserId: callerId,
          type: 'workflow.assigned',
          title: `A flow needs your step: ${next.label}`,
          sourceTableUuid: workflow.source_table_uuid,
          workflowId: workflow.id,
        }).catch((err) => console.error('notify-assignees-failed', err));
      }
      // The submitter hears of the decision on the first step and of the end, not of every step between.
      if (submittedByUserId && submittedByUserId !== callerId && (outcome === 'rejected' || index <= 0 || !next)) {
        const returned = outcome === 'rejected' && stepDef?.reject === 'back';
        void this.notifications
          .notifyMany({
            organizationId,
            recipientUserIds: [submittedByUserId],
            type: outcome === 'approved' ? 'workflow.approved' : returned ? 'workflow.returned' : 'workflow.rejected',
            title: outcome === 'approved' ? 'Your submission was approved' : returned ? 'Your submission was sent back to you' : 'Your submission was rejected',
            body: decisionNote ?? undefined,
            sourceTable: workflow.source_table,
            sourceTableUuid: workflow.source_table_uuid,
            workflowId: workflow.id,
            data: { workflowId: workflow.id, sourceTable: workflow.source_table, sourceTableUuid: workflow.source_table_uuid },
          })
          .catch((err) => console.error('notify-submitter-failed', err));
      }
    }
    return { ok: true };
  }

  /**
   * Who a step goes to: `manager` = the submitter's manager today; `permission:<object>` = every active member
   * holding `<object>:edit:all`; `department:<id>` = its members and its leader today. The submitter never decides
   * their own step (four eyes). Nobody left: a manager's review of a configurable kind gets nobody (done at once by
   * `place`, the top of the chain); any other step goes to HR (`section.people.employment` edit on everyone), then
   * the organization's owners, then the one who completed the step before, so a request is never lost.
   */
  private async stepAssignees(db: Db, organizationId: string | null, step: WorkflowStepDefinition, submittedByUserId: string | undefined, fallback: string): Promise<string[]> {
    if (!organizationId) return [fallback];
    const holders = async (permissionId: string) => {
      const rows = await db.execute(sql`
        SELECT DISTINCT m.user_id FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN role_permissions rp ON rp.role_id = mr.role_id
        WHERE m.organization_id = ${organizationId}::uuid AND m.status = 'active'
          AND (m.exit_at IS NULL OR m.exit_at > now()) AND rp.permission_id = ${permissionId}`);
      return (rows.rows as { user_id: string }[]).map((r) => r.user_id);
    };
    // Four eyes on decisions: the submitter never decides their own submission (work steps they may do).
    const others = (ids: string[]) => [...new Set(ids)].filter((id) => !step.decides || id !== submittedByUserId);
    let ids: string[] = [];
    if (step.assignTo.startsWith('permission:')) {
      ids = await holders(`${step.assignTo.slice('permission:'.length)}:edit:all`);
    } else if (step.assignTo.startsWith('department:')) {
      // By its code (or, older configurations, its id): the leader and everyone whose assignment in force is in it.
      const ref = step.assignTo.slice('department:'.length);
      const rows = await db.execute(sql`
        WITH dep AS (SELECT id, leader_user_id FROM departments
                     WHERE organization_id = ${organizationId}::uuid AND (code = ${ref} OR id::text = ${ref}) LIMIT 1)
        SELECT leader_user_id AS user_id FROM dep WHERE leader_user_id IS NOT NULL
        UNION
        SELECT a.user_id FROM employee_assignments a
        JOIN organization_memberships m ON m.organization_id = a.organization_id AND m.user_id = a.user_id AND m.status = 'active'
        WHERE a.organization_id = ${organizationId}::uuid AND a.department_id = (SELECT id FROM dep)
          AND a.valid_from = (SELECT max(b.valid_from) FROM employee_assignments b
                              WHERE b.organization_id = a.organization_id AND b.user_id = a.user_id AND b.valid_from <= CURRENT_DATE)`);
      ids = (rows.rows as { user_id: string }[]).map((r) => r.user_id);
    } else if (step.assignTo.startsWith('team:')) {
      // By its code: its lead and its active members.
      const code = step.assignTo.slice('team:'.length);
      const rows = await db.execute(sql`
        WITH t AS (SELECT id, lead_user_id FROM teams WHERE organization_id = ${organizationId}::uuid AND code = ${code} LIMIT 1)
        SELECT lead_user_id AS user_id FROM t WHERE lead_user_id IS NOT NULL
        UNION
        SELECT m.user_id FROM team_members tm JOIN organization_memberships m ON m.id = tm.membership_id
        WHERE tm.team_id = (SELECT id FROM t) AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > now())`);
      ids = (rows.rows as { user_id: string }[]).map((r) => r.user_id);
    } else if (step.assignTo.startsWith('person:')) {
      // One person, while an active member of the organization.
      const rows = await db.execute(sql`
        SELECT m.user_id FROM organization_memberships m
        WHERE m.organization_id = ${organizationId}::uuid AND m.user_id::text = ${step.assignTo.slice('person:'.length)}
          AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > now())`);
      ids = (rows.rows as { user_id: string }[]).map((r) => r.user_id);
    } else if (step.assignTo === 'requester' && submittedByUserId) {
      ids = [submittedByUserId];
    } else if (step.assignTo === 'manager' && submittedByUserId) {
      const rows = await db.execute(sql`
        SELECT manager_user_id FROM employee_assignments
        WHERE organization_id = ${organizationId}::uuid AND user_id = ${submittedByUserId}::uuid AND valid_from <= CURRENT_DATE
        ORDER BY valid_from DESC LIMIT 1`);
      const manager = (rows.rows as { manager_user_id: string | null }[])[0]?.manager_user_id;
      if (manager) ids = [manager];
    }
    ids = others(ids);
    // An automatic step (a message) goes to whom it names, or to nobody: no stand-ins.
    if (ids.length || step.automatic) return ids;
    // A configurable kind's manager review without a manager: nobody (done at once); older definitions as before.
    if (step.review && step.assignTo === 'manager') return [];
    if (!step.blocks) return [fallback];
    ids = others(await holders('section.people.employment:edit:all'));
    if (ids.length) return ids;
    const owners = await db.execute(sql`
      SELECT DISTINCT m.user_id FROM organization_memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id
      WHERE m.organization_id = ${organizationId}::uuid AND m.status = 'active' AND r.name = 'owner'`);
    ids = others((owners.rows as { user_id: string }[]).map((r) => r.user_id));
    return ids.length ? ids : [fallback];
  }

  /**
   * What actually happens when a workflow's one step is resolved — dispatched purely by the step
   * definition's `onApprove`/`onReject.action` name (e.g. "timesheet.approve") to whatever handler
   * was registered for it. Unknown/unregistered actions, and "none", are simply no-ops: this service
   * has no idea what any given action does, only who to ask.
   */
  private async runAction(
    db: Db,
    workflow: { source_table: string; source_table_uuid: string; step: string | null; steps: unknown },
    outcome: 'approved' | 'rejected',
    actorUserId: string,
    decisionNote: string | null,
    values?: Record<string, string | number | boolean>,
  ) {
    const stepDefs = Array.isArray(workflow.steps) ? (workflow.steps as WorkflowStepDefinition[]) : [];
    const stepDef = stepDefs.find((s) => s.key === workflow.step);
    const names = outcome === 'approved'
      ? stepDef?.actions ?? [stepDef?.onApprove?.action]
      : stepDef?.returnActions ?? [stepDef?.onReject?.action];
    for (const name of names) {
      await this.runNamedAction(db, name, {
        sourceTable: workflow.source_table, sourceTableUuid: workflow.source_table_uuid, actorUserId, decisionNote, stepKey: stepDef?.key, stepLabel: stepDef?.label, stepLabels: stepDef?.labels, stepBlocks: stepDef?.blocks,
        ...(values && outcome === 'approved' ? { values, fields: stepDef?.fields, ...(stepDef?.privateAnswers ? { privateAnswers: true } : {}) } : {}),
      });
    }
  }

  /** Runs one registered action; unknown ones and "none" are no-ops. */
  private async runNamedAction(db: Db, actionName: string | undefined, ctx: WorkflowActionContext) {
    if (!actionName || actionName === 'none') return;
    const handler = this.actionHandlers.get(actionName);
    if (!handler) return;
    await handler(db, ctx);
  }
}
