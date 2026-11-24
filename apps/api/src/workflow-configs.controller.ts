import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { validateWorkflowConfig, type WorkflowConfigError } from '@worktime3/shared/workflowConfig';
import { DbService } from './db.service';
import { AuditService } from './audit.service';
import { WorkflowsService } from './workflows.service';
import { can, callerUserId, isOrgOwner } from './access';
import { departments, teams } from './db/schema';
import type { AuthenticatedRequest } from './jwt.guard';

/** The errors of assignees naming a department or team (by code) this organization doesn't have. */
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
  return assignees.flatMap((a, i) =>
    (a.startsWith('department:') || a.startsWith('team:')) && !known.has(a)
      ? [{ path: `steps[${i}].assignTo`, code: a.startsWith('team:') ? 'unknown-team' : 'unknown-department' }]
      : []);
}

/**
 * Admin settings -> Workflows: the configurable kinds of workflow (the modules' catalogues) and the organization's
 * own configuration of each (shared/workflowConfig.ts). Whoever sees Admin settings reads them; only an owner changes
 * them, since they decide who decides about whose requests (like the roles). Running workflows keep their steps.
 */
@Controller()
export class WorkflowConfigsController {
  constructor(
    private readonly dbService: DbService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly audit: AuditService,
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
        const { blocks, facts, rejectModes, defaultConfig } = (await this.workflowsSvc.catalogueOf(db, orgId, id, variant?.key))!;
        kinds.push({
          id,
          variant: variant?.key ?? null,
          variantLabel: variant?.label ?? null,
          variantLabels: variant?.labels ?? null,
          optional: !!kind.variants,
          blocks: Object.fromEntries(Object.entries(blocks).map(([name, b]) => [name, { assignees: b.assignees, label: b.label, once: !!b.once, last: !!b.last, after: b.after ?? [], canReturn: !!b.returnAction, required: !!b.required }])),
          facts,
          rejectModes,
          defaultConfig,
          config: await this.workflowsSvc.ownConfig(db, orgId, id, variant?.key),
        });
      }
    }
    // The departments and teams by code, for `department:<code>` and `team:<code>`.
    const units = {
      departments: await db.select({ code: departments.code, name: departments.name }).from(departments).where(and(eq(departments.organization_id, orgId), eq(departments.is_active, true))),
      teams: await db.select({ code: teams.code, name: teams.name }).from(teams).where(eq(teams.organization_id, orgId)),
    };
    return { ok: true, kinds, units, editable: await isOrgOwner(db, orgId, callerId) };
  }

  /** `{config}`: the organization's own configuration, or null to use the default again. */
  @Put('organizations/:orgId/workflow-configs/:kind')
  async save(@Param('orgId') orgId: string, @Param('kind') kindId: string, @Body() body: { config?: unknown }, @Req() req: AuthenticatedRequest, @Query('variant') variantParam?: string) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgOwner(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
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
