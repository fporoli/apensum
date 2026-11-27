import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { FlowsService } from './flows.service';
import { WorkflowsService } from './workflows.service';
import { FLOW_STEPS_KIND } from './flow-steps';
import { callerUserId, can, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { TriggersService, triggersOf, type KnownEvent, type TriggerRunDetail } from './triggers.service';
import { triggerKeyPrefix, validateTrigger, type FlowTrigger } from './triggers';
import { sqlToday } from './clock';
import { freeTypeKey, templateConfig, templateNeedsDepartment } from '@worktime3/shared/triggerTemplates';
import { validateWorkflowConfig } from '@worktime3/shared/workflowConfig';
import { saveFlowType } from './flow-types';

/** What the caller may do with the organization's triggers. */
interface TriggerAccess {
  callerId: string;
  /** Designs the flows (`section.admin.workflows` edit): changes the triggers of events that are not sensitive. */
  designer: boolean;
  /** The events whose triggers the caller sees. */
  events: Set<string>;
  /** The events whose triggers the caller changes. */
  editable: Set<string>;
}

/**
 * Auslöser (Admin settings -> Flow-Designer -> Auslöser, and HR-Prozesse's settings, docs/dev/FLOWS.md): the
 * organization's triggers and the events the core and the plugins offer. Triggers of an event about sensitive data
 * (`TriggerEventDef.sensitive`: sickness, permits, exits) are seen and changed only by who edits that permission's
 * object for everyone (HR), with or without the Flow-Designer: nobody else sees them at all, not the owner or an admin
 * either (people's data goes to HR, CLAUDE.md). The others' triggers are changed by who designs the flows and read by
 * admins. `POST .../run` runs them now (after an exit date changed).
 */
@Controller('organizations/:orgId/flow-triggers')
export class FlowTriggersController {
  constructor(
    private readonly db: DbService,
    private readonly triggers: TriggersService,
    private readonly flows: FlowsService,
    private readonly workflows: WorkflowsService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  private async access(db: Db, orgId: string, req: AuthenticatedRequest): Promise<TriggerAccess | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const designer = await can(db, orgId, callerId, 'section.admin.workflows', 'edit');
    const reader = designer || (await can(db, orgId, callerId, 'nav.admin', 'see'));
    const events = new Set<string>();
    const editable = new Set<string>();
    const sensitive = new Map<string, boolean>();
    for (const [id, e] of this.triggers.events()) {
      const object = e.def.sensitive;
      if (!object) {
        if (reader) events.add(id);
        if (designer) editable.add(id);
        continue;
      }
      if (!sensitive.has(object)) sensitive.set(object, await reachesAll(db, orgId, callerId, object, 'edit'));
      if (sensitive.get(object)) {
        events.add(id);
        editable.add(id);
      }
    }
    return { callerId, designer, events, editable };
  }

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const empty = { ok: true, editable: false, designer: false, events: [], triggers: [], flowTypes: [], departments: [], templates: [] };
    const db = this.db.getDb();
    if (!db) return { ...empty, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.events.size === 0) return empty;
    const on = await this.triggers.eventsOn(db, orgId);
    const known = this.triggers.events();
    const events = [...known.values()].filter((e) => a.events.has(e.def.id)).map((e: KnownEvent) => ({
      id: e.def.id, label: e.def.label, placeholders: e.def.placeholders, defaultLeadDays: e.def.defaultLeadDays,
      sensitive: !!e.def.sensitive, module: e.module, on: on.has(e.def.id), editable: a.editable.has(e.def.id),
    }));
    const triggers = (await triggersOf(db, orgId)).filter((t) => a.events.has(t.event));
    // The flow types with their own steps (the only ones a trigger's flow can go through) and the departments.
    const kind = this.workflows.kinds().get(FLOW_STEPS_KIND);
    const flowTypes: { key: string; label: string; labels: Record<string, string> | null }[] = [];
    for (const v of kind?.variants ? await kind.variants(db, orgId) : []) {
      if (await this.workflows.ownConfig(db, orgId, FLOW_STEPS_KIND, v.key)) flowTypes.push({ key: v.key, label: v.label, labels: (v as { labels?: Record<string, string> }).labels ?? null });
    }
    const departments = (await db.execute(sql`
      SELECT id, name, code FROM departments WHERE organization_id = ${orgId}::uuid AND is_active ORDER BY name
    `)).rows as { id: string; name: string; code: string | null }[];
    // The Vorlagen of the events the caller sets up whose module is on (the core's, a plugin's: HR-Prozesse's).
    const templates = [...this.triggers.templates().values()].filter((tpl) => a.editable.has(tpl.event) && on.has(tpl.event));
    return { ok: true, editable: a.editable.size > 0, designer: a.designer, events, triggers, flowTypes, departments, templates };
  }

  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.editable.size === 0) return { ok: false, error: 'forbidden' };
    const checked = await this.checked(db, orgId, body, a);
    if (!checked.ok) return checked;
    const v = checked.value;
    const [row] = (await db.execute(sql`
      INSERT INTO flow_triggers (organization_id, event, enabled, lead_days, flow_type, target, department_id, confidential, label)
      VALUES (${orgId}::uuid, ${v.event}, ${v.enabled}, ${v.leadDays}, ${v.flowType}, ${v.target}, ${v.departmentId}::uuid, ${v.confidential}, ${v.label})
      RETURNING id`)).rows as { id: string }[];
    void this.versions.record('flow_triggers', row.id, 'insert', a.callerId, { organization_id: orgId, ...v }).catch(() => {});
    void this.audit.record(orgId, a.callerId, 'flow-trigger.create', 'flow_trigger', row.id, { event: v.event }).catch(() => {});
    await this.triggers.run(db, orgId, a.callerId).catch(() => null);
    return { ok: true, id: row.id };
  }

  @Put(':id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.editable.size === 0) return { ok: false, error: 'forbidden' };
    const old = await this.load(db, orgId, id, a);
    if (!old) return { ok: false, error: 'not-found' };
    if (!a.editable.has(old.event)) return { ok: false, error: 'forbidden' };
    const checked = await this.checked(db, orgId, body, a);
    if (!checked.ok) return checked;
    const v = checked.value;
    await db.execute(sql`
      UPDATE flow_triggers SET event = ${v.event}, enabled = ${v.enabled}, lead_days = ${v.leadDays}, flow_type = ${v.flowType}, target = ${v.target},
        department_id = ${v.departmentId}::uuid, confidential = ${v.confidential}, label = ${v.label}
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid`);
    void this.versions.record('flow_triggers', id, 'update', a.callerId, { organization_id: orgId, ...v }).catch(() => {});
    void this.audit.record(orgId, a.callerId, 'flow-trigger.update', 'flow_trigger', id, { event: v.event }).catch(() => {});
    await this.triggers.run(db, orgId, a.callerId).catch(() => null);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.editable.size === 0) return { ok: false, error: 'forbidden' };
    const old = await this.load(db, orgId, id, a);
    if (!old) return { ok: false, error: 'not-found' };
    if (!a.editable.has(old.event)) return { ok: false, error: 'forbidden' };
    // Its open flows end with it (as a disabled trigger's do).
    const today = ((await db.execute(sql`SELECT ${sqlToday()}::text AS d`)).rows[0] as { d: string }).d;
    await this.flows.closeTasks(db, orgId, 'trigger', [], today, triggerKeyPrefix(id));
    await db.execute(sql`DELETE FROM flow_triggers WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid`);
    void this.versions.record('flow_triggers', id, 'delete', a.callerId, { organization_id: orgId, event: old.event }).catch(() => {});
    void this.audit.record(orgId, a.callerId, 'flow-trigger.delete', 'flow_trigger', id, { event: old.event }).catch(() => {});
    return { ok: true };
  }

  /**
   * Creates a Vorlage (`{event, departmentId}`, the core's shared/triggerTemplates.ts or a plugin's `TriggerSource.templates`): its flow type (confidential, names in four
   * languages, a key not yet taken), the type's one step (an e-mail to the person from the template, to the department
   * by its code), and the event's trigger, or the event's existing trigger now goes through the type. For whoever may
   * set up the event's triggers (HR for its own events, without the Flow-Designer): the type is fixed by the template.
   */
  @Post('templates')
  async template(@Param('orgId') orgId: string, @Body() body: { event?: unknown; departmentId?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.editable.size === 0) return { ok: false, error: 'forbidden' };
    const tpl = typeof body?.event === 'string' ? this.triggers.templates().get(body.event) : undefined;
    if (!tpl || !a.editable.has(tpl.event) || !(await this.triggers.eventsOn(db, orgId)).has(tpl.event)) return { ok: false, error: 'unknown-event' };
    // A department only where the template's steps go to one (else to everyone holding its permission).
    let department: { id: string; code: string | null } | null = null;
    if (templateNeedsDepartment(tpl)) {
      if (typeof body.departmentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.departmentId)) return { ok: false, error: 'invalid-department' };
      [department] = (await db.execute(sql`
        SELECT id, code FROM departments WHERE id = ${body.departmentId}::uuid AND organization_id = ${orgId}::uuid AND is_active`)).rows as { id: string; code: string | null }[];
      if (!department) return { ok: false, error: 'unknown-department' };
      if (!department.code) return { ok: false, error: 'department-needs-code' };
    }
    const kind = this.workflows.kinds().get(FLOW_STEPS_KIND);
    if (!kind?.variants) return { ok: false, error: 'flows-off' };
    const key = freeTypeKey(tpl.typeKey, (await kind.variants(db, orgId)).map((v) => v.key));
    const saved = await saveFlowType(db, this.versions, orgId, a.callerId, key, tpl.typeName, true);
    if (!saved.ok) return saved;
    const checked = validateWorkflowConfig((await this.workflows.catalogueOf(db, orgId, FLOW_STEPS_KIND, key))!, templateConfig(tpl, department?.code ?? null));
    if (!checked.ok) return { ok: false, error: 'invalid-config', errors: checked.errors };
    await this.workflows.saveConfig(db, orgId, FLOW_STEPS_KIND, checked.value, a.callerId, key);
    void this.audit.record(orgId, a.callerId, 'flow-type.save', 'flow_type', key).catch(() => {});
    // One trigger per event: an existing one goes through the new type from now on.
    const existing = (await triggersOf(db, orgId)).find((t) => t.event === tpl.event);
    if (existing) {
      // The department stays where the template has none (a Free Flow's, should the type go).
      const departmentId = department?.id ?? existing.departmentId;
      await db.execute(sql`UPDATE flow_triggers SET flow_type = ${key}, department_id = ${departmentId}::uuid, enabled = TRUE WHERE id = ${existing.id}::uuid AND organization_id = ${orgId}::uuid`);
      void this.versions.record('flow_triggers', existing.id, 'update_delta', a.callerId, { flow_type: key, department_id: departmentId, enabled: true }).catch(() => {});
    } else {
      const [row] = (await db.execute(sql`
        INSERT INTO flow_triggers (organization_id, event, enabled, lead_days, flow_type, target, department_id, confidential)
        VALUES (${orgId}::uuid, ${tpl.event}, TRUE, ${tpl.leadDays}, ${key}, 'department', ${department?.id ?? null}::uuid, TRUE) RETURNING id`)).rows as { id: string }[];
      void this.versions.record('flow_triggers', row.id, 'insert', a.callerId, { organization_id: orgId, event: tpl.event, lead_days: tpl.leadDays, flow_type: key, department_id: department?.id ?? null }).catch(() => {});
    }
    void this.audit.record(orgId, a.callerId, 'flow-trigger.template', 'flow_trigger', tpl.event).catch(() => {});
    await this.triggers.run(db, orgId, a.callerId).catch(() => null);
    return { ok: true, key };
  }

  /**
   * The last runs (flow_trigger_runs, newest first, at most 50): when, who started it (none: the hourly job), and the
   * counts of the triggers the caller sees, summed from those alone (a sensitive trigger's flows stay with HR).
   * `quiet=1` includes the runs that changed nothing.
   */
  @Get('runs')
  async runs(@Param('orgId') orgId: string, @Query('quiet') quiet: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, runs: [] };
    const a = await this.access(db, orgId, req);
    if (!a || a.events.size === 0) return { ok: true, runs: [] };
    const rows = (await db.execute(sql`
      SELECT r.id, r.ran_at, r.by_user_id, COALESCE(u.display_name, u.email) AS by_name, r.details
      FROM flow_trigger_runs r LEFT JOIN users u ON u.id = r.by_user_id
      WHERE r.organization_id = ${orgId}::uuid
        AND (${quiet === '1'} OR r.opened > 0 OR r.updated > 0 OR r.closed > 0 OR r.errors > 0)
      ORDER BY r.ran_at DESC LIMIT 200`)).rows as { id: string; ran_at: string; by_user_id: string | null; by_name: string | null; details: TriggerRunDetail[] | null }[];
    const runs = [];
    for (const r of rows) {
      const details = (Array.isArray(r.details) ? r.details : []).filter((d) => a.events.has(d.event));
      const sum = (k: 'opened' | 'updated' | 'closed') => details.reduce((n, d) => n + (d[k] || 0), 0);
      const run = { id: r.id, at: r.ran_at, by: r.by_user_id ? r.by_name ?? '' : null, opened: sum('opened'), updated: sum('updated'), closed: sum('closed'), details };
      // A run that changed only what the caller doesn't see is quiet to them.
      if (quiet !== '1' && !details.some((d) => d.opened || d.updated || d.closed || d.error)) continue;
      runs.push(run);
      if (runs.length === 50) break;
    }
    return { ok: true, runs };
  }

  /** Runs the organization's triggers now: for whoever changes any of them (HR after an exit date, the Flow-Designer). */
  @Post('run')
  async runNow(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const a = await this.access(db, orgId, req);
    if (!a || a.editable.size === 0) return { ok: false, error: 'forbidden' };
    return this.triggers.run(db, orgId, a.callerId);
  }

  /** A trigger of the organization the caller may see, or null. */
  private async load(db: Db, orgId: string, id: string, a: TriggerAccess): Promise<FlowTrigger | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const t = (await triggersOf(db, orgId)).find((x) => x.id === id);
    return t && a.events.has(t.event) ? t : null;
  }

  /** The body checked, with its department in the organization and its event one the caller may see. */
  private async checked(db: Db, orgId: string, body: unknown, a: TriggerAccess) {
    const checked = validateTrigger(body, [...a.editable]);
    if (!checked.ok) return checked;
    const v = checked.value;
    if (v.departmentId) {
      const rows = (await db.execute(sql`SELECT 1 FROM departments WHERE id = ${v.departmentId}::uuid AND organization_id = ${orgId}::uuid AND is_active`)).rows;
      if (!rows.length) return { ok: false as const, error: 'unknown-department' };
    }
    return checked;
  }
}
