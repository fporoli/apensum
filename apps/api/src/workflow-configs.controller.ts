import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { validateWorkflowConfig, type WorkflowConfigError } from '@worktime3/shared/workflowConfig';
import { withFlowType } from '@worktime3/shared/flows';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { AuditService } from './audit.service';
import { WorkflowsService } from './workflows.service';
import { can, callerUserId } from './access';
import { departments, organization_memberships, static_data, teams, users } from './db/schema';
import type { AuthenticatedRequest } from './jwt.guard';

/** The errors of assignees naming a department or team (by code), or a person, this organization doesn't have. */
export async function unknownUnits(db: NonNullable<ReturnType<DbService['getDb']>>, orgId: string, assignees: string[]): Promise<WorkflowConfigError[]> {
  const codes = (prefix: string) => [...new Set(assignees.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length)))];
  const depCodes = codes('department:');
  const teamCodes = codes('team:');
  const known = new Set<string>();
  if (depCodes.length) {
    for (const r of await db.select({ code: departments.code }).from(departments).where(and(eq(departments.organization_id, orgId), inArray(departments.code, depCodes)))) known.add(`department:${r.code}`);
  }
  if (teamCodes.length) {
    for (const r of await db.select({ code: teams.code }).from(teams).where(and(eq(teams.organization_id, orgId), inArray(teams.code, teamCodes)))) known.add(`team:${r.code}`);
  }
  const personIds = codes('person:');
  if (personIds.length) {
    const rows = await db.select({ id: organization_memberships.user_id }).from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active'), inArray(organization_memberships.user_id, personIds)));
    for (const r of rows) known.add(`person:${r.id}`);
  }
  return assignees.flatMap((a, i) =>
    (a.startsWith('department:') || a.startsWith('team:') || a.startsWith('person:')) && !known.has(a)
      ? [{ path: `steps[${i}].assignTo`, code: a.startsWith('team:') ? 'unknown-team' : a.startsWith('person:') ? 'unknown-person' : 'unknown-department' }]
      : []);
}

/**
 * Admin settings -> Workflows: the configurable kinds of workflow (the modules' catalogues) and the organization's
 * own configuration of each (shared/workflowConfig.ts). Whoever sees Admin settings reads them; whoever holds
 * `section.admin.workflows` edit changes them (the owner, and a role the owner gives it to: it decides who decides about
 * whose flows). Running workflows keep their steps.
 */
@Controller()
export class WorkflowConfigsController {
  constructor(
    private readonly dbService: DbService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  @Get('organizations/:orgId/workflow-configs')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const empty = { ok: true, kinds: [], editable: false };
    const db = this.dbService.getDb();
    if (!db) return { ...empty, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.admin', 'see'))) return empty;
    const kinds = [];
    for (const [id, kind] of this.workflowsSvc.kinds()) {
      // A kind with variants (request types) is listed once per variant; without its own configuration it has none.
      const variants: ({ key: string; label: string; labels?: Record<string, string> } | null)[] = kind.variants ? await kind.variants(db, orgId) : [null];
      for (const variant of variants) {
        const { blocks, facts, rejectModes, defaultConfig, firstStepDecides, each } = (await this.workflowsSvc.catalogueOf(db, orgId, id, variant?.key))!;
        kinds.push({
          id,
          variant: variant?.key ?? null,
          variantLabel: variant?.label ?? null,
          variantLabels: variant?.labels ?? null,
          optional: !!kind.variants,
          blocks: Object.fromEntries(Object.entries(blocks).map(([name, b]) => [name, { assignees: b.assignees, label: b.label, once: !!b.once, last: !!b.last, after: b.after ?? [], canReturn: !!b.returnAction, required: !!b.required, fields: !!b.fields, fieldsOptional: !!b.fieldsOptional, automatic: !!b.automatic, message: !!b.message }])),
          each: !!each,
          facts,
          rejectModes,
          firstStepDecides: firstStepDecides !== false,
          defaultConfig,
          config: await this.workflowsSvc.ownConfig(db, orgId, id, variant?.key),
        });
      }
    }
    // The departments and teams by code, for `department:<code>` and `team:<code>`.
    const units = {
      departments: await db.select({ code: departments.code, name: departments.name }).from(departments).where(and(eq(departments.organization_id, orgId), eq(departments.is_active, true))),
      teams: await db.select({ code: teams.code, name: teams.name }).from(teams).where(eq(teams.organization_id, orgId)),
      // The active members, for `person:<id>` (names only, as the directory shows them to everyone).
      people: await db.select({ id: users.id, name: users.display_name, email: users.email }).from(organization_memberships)
        .innerJoin(users, eq(users.id, organization_memberships.user_id))
        .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active'))),
    };
    // Who a `permission:<object>` step goes to today (the engine's own rule: active members holding <object>:edit:all),
    // so the designer can say it; [] = nobody, the step then goes to HR, then the owners.
    const objects = [...new Set(kinds.flatMap((k) => Object.values(k.blocks).flatMap((b) => b.assignees.filter((a) => a.startsWith('permission:')).map((a) => a.slice('permission:'.length)))))];
    const holders: Record<string, string[]> = Object.fromEntries(objects.map((o) => [o, []]));
    if (objects.length) {
      const rows = await db.execute(sql`
        SELECT DISTINCT split_part(rp.permission_id, ':', 1) AS object, m.user_id FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN role_permissions rp ON rp.role_id = mr.role_id
        WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > now())
          AND rp.permission_id IN (${sql.join(objects.map((o) => sql`${`${o}:edit:all`}`), sql`, `)})`);
      for (const r of rows.rows as { object: string; user_id: string }[]) holders[r.object]?.push(r.user_id);
    }
    // The organization's flow types with their names and whether they are confidential (to add or rename one).
    const [typeRow] = await db.select({ values: static_data.values, translation: static_data.translation }).from(static_data)
      .where(and(eq(static_data.entity, 'flows'), eq(static_data.enum_name, 'flow_type'), sql`(${static_data.organization_id} = ${orgId}::uuid OR ${static_data.organization_id} IS NULL)`))
      .orderBy(sql`${static_data.organization_id} NULLS LAST`).limit(1);
    const typeValues = (typeRow?.values ?? {}) as Record<string, { confidential?: boolean } | null>;
    const typeNames = (typeRow?.translation ?? {}) as Record<string, Record<string, string>>;
    const flowTypes = Object.keys(typeValues).map((key) => ({
      key,
      names: Object.fromEntries(Object.entries(typeNames).flatMap(([lang, t]) => (t?.[key] ? [[lang, t[key]]] : []))),
      confidential: typeValues[key]?.confidential === true,
    }));
    return { ok: true, kinds, flowTypes, units: { ...units, holders }, editable: await can(db, orgId, callerId, 'section.admin.workflows', 'edit') };
  }

  /**
   * Adds or renames one of the organization's flow types (`{names: {de, fr, it, en}, confidential}`), the list
   * static_data flows/flow_type: in the organization's copy, made from the list for all organizations when it has none.
   * Whoever designs the flows (section.admin.workflows edit) does it, so a new type gets its steps in one place.
   */
  @Put('organizations/:orgId/flow-types/:key')
  async saveType(@Param('orgId') orgId: string, @Param('key') key: string, @Body() body: { names?: unknown; confidential?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'section.admin.workflows', 'edit'))) return { ok: false, error: 'forbidden' };
    const where = (org: boolean) => and(eq(static_data.entity, 'flows'), eq(static_data.enum_name, 'flow_type'), org ? eq(static_data.organization_id, orgId) : isNull(static_data.organization_id));
    const [own] = await db.select().from(static_data).where(where(true));
    const [global] = own ? [] : await db.select().from(static_data).where(where(false));
    const base = own ?? global;
    const next = withFlowType(base ? { values: base.values, translation: base.translation as Record<string, Record<string, string>> | null } : null, key, body?.names, body?.confidential === true);
    if ('error' in next) return { ok: false, error: next.error };
    if (own) {
      await db.update(static_data).set(next).where(eq(static_data.id, own.id));
      void this.versions.record('static_data', own.id, 'update_delta', callerId, next).catch(() => {});
    } else {
      const row = { organization_id: orgId, entity: 'flows', enum_name: 'flow_type', ...next };
      const [created] = await db.insert(static_data).values(row).returning({ id: static_data.id });
      void this.versions.record('static_data', created.id, 'insert', callerId, { id: created.id, ...row }).catch(() => {});
    }
    void this.audit.record(orgId, callerId, 'flow-type.save', 'flow_type', key).catch(() => {});
    return { ok: true, key };
  }

  /** `{config}`: the organization's own configuration, or null to use the default again. */
  @Put('organizations/:orgId/workflow-configs/:kind')
  async save(@Param('orgId') orgId: string, @Param('kind') kindId: string, @Body() body: { config?: unknown }, @Req() req: AuthenticatedRequest, @Query('variant') variantParam?: string) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'section.admin.workflows', 'edit'))) return { ok: false, error: 'forbidden' };
    const kind = this.workflowsSvc.kinds().get(kindId);
    if (!kind) return { ok: false, error: 'unknown-kind' };
    // A kind with variants needs one of the organization's (a request type).
    const variant = kind.variants ? variantParam : undefined;
    if (kind.variants && !(await kind.variants(db, orgId)).some((v) => v.key === variant)) return { ok: false, error: 'unknown-variant' };
    if (body?.config === null) {
      await this.workflowsSvc.saveConfig(db, orgId, kindId, null, callerId, variant);
      void this.audit.record(orgId, callerId, 'workflow.config', 'workflow_kind', kindId).catch(() => {});
      return { ok: true, config: null };
    }
    const checked = validateWorkflowConfig((await this.workflowsSvc.catalogueOf(db, orgId, kindId, variant))!, body?.config);
    if (!checked.ok) return { ok: false, error: 'invalid-config', errors: checked.errors };
    // A department or team named as assignee (by its code) must be this organization's.
    const errors = await unknownUnits(db, orgId, checked.value.steps.map((s) => s.assignTo));
    if (errors.length) return { ok: false, error: 'invalid-config', errors };
    await this.workflowsSvc.saveConfig(db, orgId, kindId, checked.value, callerId, variant);
    // That the configuration changed, never what it says (admins read the audit log).
    void this.audit.record(orgId, callerId, 'workflow.config', 'workflow_kind', kindId).catch(() => {});
    return { ok: true, config: checked.value };
  }
}
