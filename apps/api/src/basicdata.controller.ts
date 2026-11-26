import { Body, Controller, Get, Logger, Param, Post, Put, Req, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { WorkflowKindCatalogue } from '@worktime3/shared/workflowConfig';
import { DbService } from './db.service';
import { callerUserId, can, isOrgMember, permissionIdsOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { BasicDataService, nestOrgKeys, scopeToOrg } from './basicdata.service';
import { users } from './db/schema';
import { FieldsService } from './fields.service';
import { WorkflowsService } from './workflows.service';
import type { Db } from './db.service';
import { BASICDATA_FORM, BASICDATA_NESTED_KEYS_BY_GROUP, basicdataGroupOfKey, editableKeys, mergeForm, orgCustomKeys, validateFields, type ResolvedForm } from '@worktime3/shared/fields';
import type { Executor } from './access';

/**
 * Nested objects and lists the field registry does not describe yet (docs/FIELD_CONFIG.md, "Basic
 * data specifics"). Anyone may change them via a change request.
 */
const NESTED_KEYS = ['bankAccounts', 'emergencyContacts', 'partner', 'children'] as const;

/**
 * Every key an HR/admin direct edit may set: the code's writable fields plus the nested ones. An
 * org's template adds its custom fields to these (see `allowedKeys`).
 */
const ALL_KEYS = [...editableKeys(BASICDATA_FORM, 'hr'), ...NESTED_KEYS];

/** Keys an employee may change about themselves through a change request (`editableBy: 'self'`). */
const SELF_SERVICE_KEYS = [...editableKeys(BASICDATA_FORM, 'self'), ...NESTED_KEYS];

/** The keys an editor may write under an org's merged template: its non-retired fields plus the nested lists. */
export function allowedKeys(form: ResolvedForm, editor: 'hr' | 'self'): string[] {
  return [...editableKeys(form, editor), ...NESTED_KEYS];
}

/**
 * The keys stored in the organization's own section: its custom fields, the birth date, which its
 * vacation rules count with, so that no other organization's edit changes an entitlement here, and the
 * personnel number, which each employer assigns (payroll and expense processing read it, payrollPersonalien).
 */
export function orgOwnedKeys(form: ResolvedForm): string[] {
  return [...orgCustomKeys(form), 'birthDate', 'personnelNumber'];
}

/**
 * Registry fields stored in real `users` columns rather than the basicdata jsonb: `update()` routes
 * them to a `users` update instead of merging them into users.basicdata.
 */
const USER_COLUMN_MAP: Record<string, string> = Object.fromEntries(
  BASICDATA_FORM.fields
    .filter((f) => !f.readOnly && f.storage.kind === 'column' && f.storage.table === 'users')
    .map((f) => [f.key, f.storage.column]),
);

export { ALL_KEYS as BASICDATA_HR_KEYS, SELF_SERVICE_KEYS as BASICDATA_SELF_KEYS, USER_COLUMN_MAP as BASICDATA_USER_COLUMNS };

// ---------------------------------------------------------------------------------------------
// Section permissions: each basic-data group is `section.basicdata.<group>`. `see` shows it;
// `edit` lets the employee request changes to their own data (HR approves), while an `edit`
// grant reaching beyond `own` (HR: `all`) edits directly and approves requests.

export const BASICDATA_GROUPS = Object.keys(BASICDATA_NESTED_KEYS_BY_GROUP);

export interface SectionAccess {
  see: boolean;
  /** May ask for a change of their own data (needs approval). */
  request: boolean;
  /** May change it directly / approve change requests for it. */
  direct: boolean;
}

/** Section ids granting `edit` only on one's own data: dropped to decide direct edits. */
function withoutOwnSectionEdits(held: Set<string>): Set<string> {
  return new Set([...held].filter((id) => !(id.startsWith('section.basicdata.') && id.endsWith(':edit:own'))));
}

/** What the caller may do with each basic-data section of `targetUserId`. */
export async function basicdataSectionAccess(
  db: Executor,
  orgId: string,
  callerId: string,
  targetUserId: string,
): Promise<Record<string, SectionAccess>> {
  const held = await permissionIdsOf(db, orgId, callerId);
  const beyondOwn = withoutOwnSectionEdits(held);
  const isSelf = callerId === targetUserId;
  const out: Record<string, SectionAccess> = {};
  for (const group of BASICDATA_GROUPS) {
    const object = `section.basicdata.${group}`;
    const see = await can(db, orgId, callerId, object, 'see', targetUserId, held);
    const direct = see && (await can(db, orgId, callerId, object, 'edit', targetUserId, beyondOwn));
    const request = see && !direct && isSelf && (await can(db, orgId, callerId, object, 'edit', targetUserId, held));
    out[group] = { see, request, direct };
  }
  return out;
}

/**
 * Drops the keys of sections the caller may not see. Keys that belong to no section are kept
 * only for callers who see every section.
 */
export function filterBasicDataBySections(
  data: Record<string, unknown>,
  form: { fields: { key: string; group: string }[] },
  visible: (group: string) => boolean,
): Record<string, unknown> {
  const all = BASICDATA_GROUPS.every(visible);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const group = basicdataGroupOfKey(form, key);
    if (group ? visible(group) : all) out[key] = value;
  }
  return out;
}

/** The sections a patch touches (null when a key belongs to none). */
export function sectionsOfPatch(patch: Record<string, unknown>, form: { fields: { key: string; group: string }[] }): Set<string> | null {
  const groups = new Set<string>();
  for (const key of Object.keys(patch)) {
    if (key === 'orgs') {
      // An org's custom fields, nested by `nestOrgKeys`.
      for (const section of Object.values(patch.orgs ?? {}) as Record<string, unknown>[]) {
        const inner = sectionsOfPatch(section ?? {}, form);
        if (!inner) return null;
        for (const g of inner) groups.add(g);
      }
      continue;
    }
    const group = basicdataGroupOfKey(form, key);
    if (!group) return null;
    groups.add(group);
  }
  return groups;
}

/** Keep only known top-level keys from `keys`, and cap overall size so nobody can stuff arbitrary payloads in here. */
function sanitizePatch(body: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in (body as Record<string, unknown>)) patch[key] = (body as Record<string, unknown>)[key];
  }
  if (Object.keys(patch).length === 0) return null;
  if (JSON.stringify(patch).length > 20_000) return null;
  return patch;
}

/** The workflows of change requests: source table `basicdata`, the person's user id (one open request at a time). */
export const BASICDATA_SOURCE = 'basicdata';

/**
 * A change of one's own personal data (My Data -> "Request a correction"): a flow, reviewed by the steps the
 * organization set (Flow-Designer; default HR, `section.basicdata.personalien` edit on everyone), each a decision;
 * rejecting is final (the person asks anew). The change is applied once the last step approved it. Facts: the
 * changed fields and their sections, e.g. a second step only when the bank details change.
 */
export const BASICDATA_CHANGE_CATALOGUE: WorkflowKindCatalogue = {
  id: 'basicdata.change',
  definitionName: 'basicdata change',
  rejectModes: ['none', 'end'],
  facts: { fields: 'strings', sections: 'strings' },
  blocks: {
    review: {
      label: 'Review', action: 'basicdata.reviewed', returnAction: 'basicdata.reject', decides: true,
      assignees: ['department', 'team', 'person', ...BASICDATA_GROUPS.map((g) => `permission:section.basicdata.${g}`), 'permission:section.people.employment'],
    },
  },
  defaultConfig: {
    version: 1,
    steps: [{ key: 'hr_review', do: ['review'], assignTo: 'permission:section.basicdata.personalien', reject: 'end', label: { de: 'Prüfung HR', fr: 'Contrôle RH', it: 'Verifica RH', en: 'HR review' } }],
  },
  source: 'Personal data',
  source_name: 'getBasicDataChangeTitle',
};

/** The keys a request changes (an organization's own section's keys too), and their sections. */
export function changedFieldsOf(data: Record<string, unknown>, form: ResolvedForm): { fields: string[]; sections: string[] } {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (key === 'orgs' && value && typeof value === 'object') {
      for (const section of Object.values(value as Record<string, unknown>)) {
        for (const inner of Object.keys((section ?? {}) as Record<string, unknown>)) keys.add(inner);
      }
    } else keys.add(key);
  }
  const fields = [...keys].sort();
  const sections = [...new Set(fields.map((k) => basicdataGroupOfKey(form, k)).filter((g): g is string => !!g))].sort();
  return { fields, sections };
}

@Controller()
export class BasicDataController implements OnModuleInit {
  private readonly log = new Logger('BasicDataController');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versionsService: VersionsService,
    private readonly basicData: BasicDataService,
    private readonly fields: FieldsService,
    private readonly workflowsSvc: WorkflowsService,
  ) {}

  /** The change request is a flow: its kind, what its steps do, and its records on the Flows page. */
  onModuleInit() {
    this.workflowsSvc.registerKind({
      catalogue: BASICDATA_CHANGE_CATALOGUE,
      description: 'A change of personal data a person asked for: reviewed by the steps the organization set (HR by default).',
      sourceTable: BASICDATA_SOURCE,
      facts: async (_db, userId) => {
        const pending = await this.basicData.pending(userId);
        return pending ? changedFieldsOf(pending.data, mergeForm(BASICDATA_FORM)) : {};
      },
      // The last approval applies the change (in the organization the flow belongs to: its own section only).
      onFinished: async (db, userId, actorUserId) => {
        const pending = await this.basicData.pending(userId);
        const orgId = await this.flowOrganization(db, userId, false);
        if (!pending || !orgId) return;
        const result = await this.basicData.resolveRequest(userId, pending.version, 'approved', actorUserId, null, orgId, USER_COLUMN_MAP);
        if (result.ok) void this.audit.record(orgId, actorUserId, 'basicdata.approve', 'user', userId, { version: pending.version }).catch(() => {});
      },
    });
    // An approval with more to come changes nothing yet.
    this.workflowsSvc.registerAction('basicdata.reviewed', async () => {});
    this.workflowsSvc.registerAction('basicdata.reject', async (db, ctx) => {
      const pending = await this.basicData.pending(ctx.sourceTableUuid);
      const orgId = await this.flowOrganization(db, ctx.sourceTableUuid, true);
      if (!pending || !orgId) return;
      const result = await this.basicData.resolveRequest(ctx.sourceTableUuid, pending.version, 'rejected', ctx.actorUserId, ctx.decisionNote, orgId);
      if (result.ok) void this.audit.record(orgId, ctx.actorUserId, 'basicdata.reject', 'user', ctx.sourceTableUuid, { version: pending.version }).catch(() => {});
    });
    // On the Flows page: whose data, and which fields (the values only in the review dialog, by the caller's sections).
    this.workflowsSvc.registerSourceRecords(BASICDATA_SOURCE, 'basicdata_change', async (db, ids) => {
      if (!ids.length) return [];
      const rows = (await db.execute(sql`
        SELECT u.id, u.display_name, u.email,
          (SELECT bv.history -> (jsonb_array_length(bv.history) - 1) FROM versions bv
            WHERE bv.source_table = ${BASICDATA_SOURCE} AND bv.source_table_uuid = u.id AND jsonb_array_length(bv.history) > 0) AS latest
        FROM users u WHERE u.id = ANY(${`{${ids.join(',')}}`}::uuid[])`)).rows as { id: string; display_name: string | null; email: string; latest: { status?: string; data?: Record<string, unknown>; requested_at?: string } | null }[];
      const form = mergeForm(BASICDATA_FORM);
      return rows.map((r) => ({
        id: r.id, user_id: r.id, user_display_name: r.display_name ?? r.email, user_email: r.email,
        requested_at: r.latest?.requested_at ?? null,
        ...(r.latest?.status === 'changerequested' && r.latest.data ? changedFieldsOf(r.latest.data, form) : { fields: [], sections: [] }),
      }));
    });
  }

  /** The organization of the person's newest change-request flow (`pending`: only one still waiting). */
  private async flowOrganization(db: Db, userId: string, pending: boolean): Promise<string | null> {
    const [row] = (await db.execute(sql`
      SELECT organization_id FROM workflows WHERE source_table = ${BASICDATA_SOURCE} AND source_table_uuid = ${userId}::uuid
        ${pending ? sql`AND step_status = 'pending'` : sql``}
      ORDER BY workflow_started DESC NULLS LAST LIMIT 1`)).rows as { organization_id: string | null }[];
    return row?.organization_id ?? null;
  }

  @Get('organizations/:orgId/users/:userId/basicdata')
  async get(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, basicdata: {}, pending: null };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].see)) return { ok: false, error: 'forbidden' };
    const visible = (g: string) => sections[g]?.see === true;
    const form = await this.form(orgId);

    const [basicdata, pending, [account]] = await Promise.all([
      this.basicData.get(userId),
      this.basicData.pending(userId),
      db
        .select({ email: users.email, display_name: users.display_name, first_name: users.first_name, middle_name: users.middle_name, last_name: users.last_name })
        .from(users)
        .where(eq(users.id, userId)),
    ]);
    const merged = {
      ...scopeToOrg(basicdata, orgId),
      displayName: account?.display_name ?? '',
      firstName: account?.first_name ?? '',
      middleName: account?.middle_name ?? '',
      lastName: account?.last_name ?? '',
    };
    return {
      ok: true,
      basicdata: filterBasicDataBySections(merged, form, visible),
      pending: pending && { ...pending, data: filterBasicDataBySections(scopeToOrg(pending.data, orgId), form, visible) },
      sections,
      // Older clients: direct edit when every visible section is directly editable.
      canEditDirectly: BASICDATA_GROUPS.every((g) => !sections[g].see || sections[g].direct),
      companyEmail: visible('personalien') ? account?.email ?? null : null,
    };
  }

  @Get('organizations/:orgId/users/:userId/basicdata/versions')
  async versions(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, history: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].see)) return { ok: false, error: 'forbidden' };
    const form = await this.form(orgId);
    const history = await this.basicData.history(userId);
    return {
      ok: true,
      history: history.map((e) => ({ ...e, data: filterBasicDataBySections(scopeToOrg(e.data, orgId), form, (g) => sections[g]?.see === true) })),
    };
  }

  @Put('organizations/:orgId/users/:userId/basicdata')
  async update(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { patch?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].direct)) return { ok: false, error: 'forbidden' };
    const form = await this.form(orgId);
    const sanitized = sanitizePatch(body.patch, allowedKeys(form, 'hr'));
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    const touched = sectionsOfPatch(sanitized, form);
    if (!touched || [...touched].some((g) => !sections[g]?.direct)) return { ok: false, error: 'forbidden' };
    const checked = this.validate(form, sanitized);
    if (!checked.ok) return checked;
    const patch = nestOrgKeys(checked.patch, orgOwnedKeys(form), orgId);

    const userColumnPatch: Partial<typeof users.$inferInsert> = {};
    const basicdataPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const column = USER_COLUMN_MAP[key];
      if (column) (userColumnPatch as Record<string, unknown>)[column] = value;
      else basicdataPatch[key] = value;
    }

    if (Object.keys(userColumnPatch).length > 0) {
      await db.update(users).set(userColumnPatch).where(eq(users.id, userId));
      void this.versionsService.record('users', userId, 'update_delta', callerId, userColumnPatch).catch(() => {});
    }
    if (Object.keys(basicdataPatch).length > 0) {
      await this.basicData.applyDirectEdit(userId, basicdataPatch, callerId);
    }
    void this.audit.record(orgId, callerId, 'basicdata.update', 'user', userId, { fields: Object.keys(patch) }).catch(() => {});
    return { ok: true };
  }

  @Post('organizations/:orgId/users/:userId/basicdata/request')
  async requestChange(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { patch?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (callerId !== userId) return { ok: false, error: 'forbidden' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    const form = await this.form(orgId);
    const sanitized = sanitizePatch(body.patch, allowedKeys(form, 'self'));
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    // A request may only touch sections the employee may edit (directly editable ones count too).
    const touched = sectionsOfPatch(sanitized, form);
    if (!touched || [...touched].some((g) => !sections[g]?.request && !sections[g]?.direct)) return { ok: false, error: 'forbidden' };
    const checked = this.validate(form, sanitized);
    if (!checked.ok) return checked;
    const patch = nestOrgKeys(checked.patch, orgOwnedKeys(form), orgId);

    const result = await this.basicData.requestChange(userId, patch, callerId);
    if (!result.ok) return result;
    void this.audit.record(orgId, callerId, 'basicdata.request', 'user', userId, { fields: Object.keys(patch) }).catch(() => {});
    // It goes to HR as a flow (Flows: "To do" for the reviewers, "Mine" for the person).
    try {
      await this.workflowsSvc.start(db, {
        kind: BASICDATA_CHANGE_CATALOGUE.id,
        organizationId: orgId,
        sourceTableUuid: userId,
        actorUserId: callerId,
        workflowData: {},
        notification: { title: 'A change of personal data to review', text: { key: 'notice.basicdata.review' } },
      });
    } catch (err) {
      this.log.error(`basic data request flow for ${userId} failed: ${err instanceof Error ? err.message : err}`);
    }
    return result;
  }

  @Post('organizations/:orgId/users/:userId/basicdata/versions/:versionNr/approve')
  async approve(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('versionNr') versionNr: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    // A request with a flow is decided there (its steps, who decides).
    const flow = await this.workflowsSvc.findPending(db, BASICDATA_SOURCE, userId);
    if (flow) return this.workflowsSvc.resolve(db, flow.id, callerId, 'approved', undefined);
    if (!(await this.mayResolve(db, orgId, callerId, userId))) return { ok: false, error: 'forbidden' };

    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'approved', callerId, null, orgId, USER_COLUMN_MAP);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.approve', 'user', userId, { version: Number(versionNr) }).catch(() => {});
    return result;
  }

  @Post('organizations/:orgId/users/:userId/basicdata/versions/:versionNr/reject')
  async reject(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('versionNr') versionNr: string,
    @Body() body: { note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const flow = await this.workflowsSvc.findPending(db, BASICDATA_SOURCE, userId);
    if (flow) return this.workflowsSvc.resolve(db, flow.id, callerId, 'rejected', body.note);
    if (!(await this.mayResolve(db, orgId, callerId, userId))) return { ok: false, error: 'forbidden' };

    const note = (body.note ?? '').trim() || null;
    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'rejected', callerId, note, orgId);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.reject', 'user', userId, { version: Number(versionNr) }).catch(() => {});
    return result;
  }

  /** Approving/rejecting a change request needs direct edit on every section it touches. */
  private async mayResolve(db: Executor, orgId: string, callerId: string, userId: string): Promise<boolean> {
    const pending = await this.basicData.pending(userId);
    if (!pending) return true; // resolveRequest reports the missing request itself
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    const touched = sectionsOfPatch(scopeToOrg(pending.data, orgId), await this.form(orgId));
    if (!touched) return BASICDATA_GROUPS.every((g) => sections[g].direct);
    return [...touched].every((g) => sections[g]?.direct);
  }

  /** The org's merged basic-data template (code defaults when it cannot be read). */
  private async form(orgId: string): Promise<ResolvedForm> {
    return (await this.fields.resolved(orgId, BASICDATA_FORM.id)) ?? mergeForm(BASICDATA_FORM);
  }

  /** Checks the patch against the org's merged basic-data template; returns normalized values. */
  private validate(form: ResolvedForm, patch: Record<string, unknown>) {
    const { errors, values } = validateFields(form, patch);
    if (errors.length > 0) return { ok: false as const, error: 'invalid-field', fields: errors };
    return { ok: true as const, patch: values };
  }

  @Get('organizations/:orgId/basicdata/pending')
  async pendingForOrg(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    // Only requests the caller may resolve (direct edit on every section a request touches).
    const rows = await this.basicData.pendingForOrg(orgId);
    const out = [];
    for (const r of rows) {
      // A request with a flow is on the Flows page (older ones, from before, stay here).
      if (await this.workflowsSvc.findPending(db, BASICDATA_SOURCE, r.user_id)) continue;
      if (await this.mayResolve(db, orgId, callerId, r.user_id)) out.push({ ...r, entry: { ...r.entry, data: scopeToOrg(r.entry.data, orgId) } });
    }
    return out;
  }
}
