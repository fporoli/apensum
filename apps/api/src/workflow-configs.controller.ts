import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { validateWorkflowConfig, type WorkflowConfigError } from '@worktime3/shared/workflowConfig';
import { DbService } from './db.service';
import { AuditService } from './audit.service';
import { WorkflowsService } from './workflows.service';
import { can, callerUserId, isOrgOwner } from './access';
import { departments } from './db/schema';
import type { AuthenticatedRequest } from './jwt.guard';

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
      const { blocks, facts, rejectModes, defaultConfig } = kind.catalogue;
      kinds.push({
        id,
        blocks: Object.fromEntries(Object.entries(blocks).map(([name, b]) => [name, { assignees: b.assignees, label: b.label, once: !!b.once, last: !!b.last, after: b.after ?? [], canReturn: !!b.returnAction }])),
        facts,
        rejectModes,
        defaultConfig,
        config: await this.workflowsSvc.ownConfig(db, orgId, id),
      });
    }
    return { ok: true, kinds, editable: await isOrgOwner(db, orgId, callerId) };
  }

  /** `{config}`: the organization's own configuration, or null to use the default again. */
  @Put('organizations/:orgId/workflow-configs/:kind')
  async save(@Param('orgId') orgId: string, @Param('kind') kindId: string, @Body() body: { config?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgOwner(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const kind = this.workflowsSvc.kinds().get(kindId);
    if (!kind) return { ok: false, error: 'unknown-kind' };
    if (body?.config === null) {
      await this.workflowsSvc.saveConfig(db, orgId, kindId, null, callerId);
      void this.audit.record(orgId, callerId, 'workflow.config', 'workflow_kind', kindId).catch(() => {});
      return { ok: true, config: null };
    }
    const checked = validateWorkflowConfig(kind.catalogue, body?.config);
    if (!checked.ok) return { ok: false, error: 'invalid-config', errors: checked.errors };
    // A department named as assignee must be this organization's.
    const named = checked.value.steps.map((s, i) => ({ i, id: s.assignTo.startsWith('department:') ? s.assignTo.slice('department:'.length) : null })).filter((x) => x.id);
    if (named.length) {
      const rows = await db.select({ id: departments.id }).from(departments)
        .where(and(eq(departments.organization_id, orgId), inArray(departments.id, named.map((x) => x.id!))));
      const known = new Set(rows.map((r) => r.id));
      const errors: WorkflowConfigError[] = named.filter((x) => !known.has(x.id!)).map((x) => ({ path: `steps[${x.i}].assignTo`, code: 'unknown-department' }));
      if (errors.length) return { ok: false, error: 'invalid-config', errors };
    }
    await this.workflowsSvc.saveConfig(db, orgId, kindId, checked.value, callerId);
    // That the configuration changed, never what it says (admins read the audit log).
    void this.audit.record(orgId, callerId, 'workflow.config', 'workflow_kind', kindId).catch(() => {});
    return { ok: true, config: checked.value };
  }
}
