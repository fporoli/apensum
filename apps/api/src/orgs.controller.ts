import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { keepingFeed, withoutFeed } from './membership-settings';
import { validLicenses } from './licenses';
import { randomUUID } from 'node:crypto';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, can, canManageRole, isOrgMember, reachesAll, roleNeedsOwner } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { sendMail } from './mailer';
import { isValidEmail } from './auth.controller';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { parseBranding, validateBranding, type OrgBranding } from '@worktime3/shared/branding';
import { MODULES, licensedIn, resolveModules, validateModules } from '@worktime3/shared/modules';
import {
  organizations,
  organization_memberships,
  organization_invitations,
  organization_domains,
  users,
  roles,
  membership_roles,
} from './db/schema';

import { appBaseUrl } from './app-url';

export { appBaseUrl };

export function buildInviteEmail(orgName: string, token: string): { subject: string; text: string } {
  const link = `${appBaseUrl()}/?invite=${encodeURIComponent(token)}`;
  return {
    subject: `You've been invited to ${orgName} on Apensum`,
    text: `Hi,\n\nYou've been invited to join "${orgName}".\n\nAccept it here: ${link}\n\nOr paste this token on the Invited tab of the login screen: ${token}\n`,
  };
}


const ORG_COLUMNS = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  type: organizations.type,
  avatar_url: organizations.avatar_url,
  settings: organizations.settings,
};

/** Default reporting currency when an org hasn't set one in `settings.defaultCurrency` yet. */
const FALLBACK_DEFAULT_CURRENCY = 'CHF';

/**
 * Whether a role may be granted in organization `orgId`: a global role (`organization_id`
 * null) unless the organization has its own copy of it, or one of the organization's roles.
 */
/** Branding as written to the audit log and version history: the logo replaced by its size. */
export function brandingForLog(branding: OrgBranding): Record<string, unknown> {
  const { logo, ...rest } = branding;
  return logo ? { ...rest, logo: `<image, ${logo.length} chars>` } : rest;
}

export function isRoleAssignableInOrg(role: { organization_id: string | null }, orgId: string, orgHasCopy: boolean): boolean {
  if (role.organization_id === null) return !orgHasCopy;
  return role.organization_id === orgId;
}

@Controller('organizations')
export class OrgsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** Why the caller may not give or take the role (grant, revoke, invite), or null. */
  private async refusal(db: Db, orgId: string, callerId: string, roleId: string): Promise<'forbidden' | 'owner-required' | null> {
    if (await canManageRole(db, orgId, callerId, roleId)) return null;
    return (await roleNeedsOwner(db, roleId)) ? 'owner-required' : 'forbidden';
  }

  /** The role exists and may be granted in this organization (see `isRoleAssignableInOrg`). */
  private async roleAssignable(db: Db, orgId: string, roleId: string): Promise<boolean> {
    const [role] = await db
      .select({ name: roles.name, organization_id: roles.organization_id })
      .from(roles)
      .where(eq(roles.id, roleId));
    if (!role) return false;
    const [orgCopy] =
      role.organization_id === null
        ? await db.select({ id: roles.id }).from(roles).where(and(eq(roles.organization_id, orgId), eq(roles.name, role.name)))
        : [];
    return isRoleAssignableInOrg(role, orgId, !!orgCopy);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return null;
    const [org] = await db.select(ORG_COLUMNS).from(organizations).where(eq(organizations.id, id));
    if (!org) return null;
    const { settings, ...rest } = org;
    const settingsObj = settings as Record<string, unknown> | null;
    const defaultCurrency = settingsObj?.defaultCurrency;
    return {
      ...rest,
      default_currency: typeof defaultCurrency === 'string' ? defaultCurrency : FALLBACK_DEFAULT_CURRENCY,
    };
  }


  /** Look and feel (colors, logo) for every member; empty when not a member or not set. */
  @Get(':id/branding')
  async getBranding(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, branding: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return { ok: true, branding: {} };
    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, id));
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    return { ok: true, branding: parseBranding(settings.branding) };
  }

  /**
   * Replaces the organization's branding (missing fields fall back to the app's defaults).
   * Same gate as the rest of Organization settings.
   */
  @Put(':id/branding')
  async setBranding(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, id, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const result = validateBranding(body);
    if (!result.ok) return result;
    const { branding } = result;
    const settings =
      Object.keys(branding).length > 0
        ? sql`${organizations.settings} || ${JSON.stringify({ branding })}::jsonb`
        : sql`${organizations.settings} - 'branding'`;
    const updated = await db.update(organizations).set({ settings }).where(eq(organizations.id, id)).returning({ id: organizations.id });
    if (updated.length === 0) return { ok: false, error: 'not-found' };
    const logged = { settings: { branding: brandingForLog(branding) } };
    void this.audit.record(id, callerId, 'organization.branding', 'organization', id, logged).catch(() => {});
    void this.versions.record('organizations', id, 'update_delta', callerId, logged).catch(() => {});
    return { ok: true, branding };
  }

  /**
   * Which optional modules (packages/shared/src/modules.ts) the organization uses, for every member
   * (the web app hides switched-off ones); `catalogue` lists every module with its default and
   * whether it is licensed; `licenses` = the organization's valid licenses (module id -> last day, null = open).
   */
  @Get(':id/modules')
  async getModules(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const catalogue = MODULES.map((m) => ({ id: m.id, caption: m.caption, defaultEnabled: m.defaultEnabled, licensed: m.licensed === true }));
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, modules: resolveModules(undefined), catalogue, licenses: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return { ok: true, modules: resolveModules(undefined), catalogue, licenses: {} };
    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, id));
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const licenses = await validLicenses(db, id);
    return { ok: true, modules: resolveModules(settings.modules, Object.keys(licenses)), catalogue, licenses };
  }

  /**
   * Switches modules on or off: `{ "<module id>": true|false, ... }`, merged into the stored choice.
   * A licensed module (`licensed` in its definition) goes on only with a license, which only the
   * operator's CLI gives (cli/operator.ts); it can always go off.
   */
  @Put(':id/modules')
  async setModules(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, id, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const result = validateModules(body);
    if (!result.ok) return result;
    const licenses = Object.keys(await validLicenses(db, id));
    if (licensedIn(result.modules).some((m) => result.modules[m] && !licenses.includes(m))) return { ok: false, error: 'module-licensed' };
    const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, id));
    if (!org) return { ok: false, error: 'not-found' };
    const stored = ((org.settings ?? {}) as Record<string, unknown>).modules;
    const modules = { ...(stored && typeof stored === 'object' ? (stored as Record<string, boolean>) : {}), ...result.modules };
    await db
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ modules })}::jsonb` })
      .where(eq(organizations.id, id));
    const logged = { settings: { modules } };
    void this.audit.record(id, callerId, 'organization.modules', 'organization', id, logged).catch(() => {});
    void this.versions.record('organizations', id, 'update_delta', callerId, logged).catch(() => {});
    return { ok: true, modules: resolveModules(modules, licenses) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; avatarUrl?: string | null; defaultCurrency?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, id, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };
    if (body.defaultCurrency !== undefined && !/^[A-Za-z]{3}$/.test(body.defaultCurrency)) {
      return { ok: false, error: 'invalid-default-currency' };
    }

    const patch: Partial<typeof organizations.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
    // Merged into the existing settings JSON rather than a dedicated column — same bucket
    // every other org-level, rarely-queried setting already lives in (see 006-fold-org-settings-and-sso.sql).
    const settingsPatch: Record<string, unknown> = {};
    if (body.defaultCurrency !== undefined) settingsPatch.defaultCurrency = body.defaultCurrency.toUpperCase();
    if (Object.keys(settingsPatch).length > 0) {
      patch.settings = sql`${organizations.settings} || ${JSON.stringify(settingsPatch)}::jsonb`;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(organizations).set(patch).where(eq(organizations.id, id));
      void this.audit.record(id, callerId, 'organization.update', 'organization', id, { ...patch, settings: settingsPatch }).catch(() => {});
      void this.versions.record('organizations', id, 'update_delta', callerId, { ...patch, settings: settingsPatch }).catch(() => {});
    }
    return { ok: true };
  }

  @Get(':id/members')
  async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return [];
    const rows = await db
      .select({
        id: organization_memberships.id,
        user_id: organization_memberships.user_id,
        status: organization_memberships.status,
        email: users.email,
        display_name: users.display_name,
        start_date: organization_memberships.start_date,
        joined_at: organization_memberships.joined_at,
        settings: organization_memberships.settings,
        role_id: roles.id,
        role_name: roles.name,
      })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .leftJoin(membership_roles, eq(membership_roles.membership_id, organization_memberships.id))
      .leftJoin(roles, eq(roles.id, membership_roles.role_id))
      .where(eq(organization_memberships.organization_id, id));

    // Department, function and manager come from each person's assignment in force today.
    const assigned = await db.execute(sql`
      SELECT DISTINCT ON (a.user_id) a.user_id, a.manager_user_id, m.display_name AS manager_name,
             a.department_id, d.name AS department_name, a.job_function
      FROM employee_assignments a
      LEFT JOIN users m ON m.id = a.manager_user_id
      LEFT JOIN departments d ON d.id = a.department_id
      WHERE a.organization_id = ${id} AND a.valid_from <= CURRENT_DATE
      ORDER BY a.user_id, a.valid_from DESC`);
    type Current = { user_id: string; manager_user_id: string | null; manager_name: string | null; department_id: string | null; department_name: string | null; job_function: string | null };
    const current = new Map((assigned.rows as Current[]).map((r) => [r.user_id, r]));

    // A membership can hold several roles now — fold the joined rows back into one entry per member.
    const byMembership = new Map<
      string,
      {
        id: string;
        user_id: string;
        status: string;
        email: string;
        display_name: string;
        manager_user_id: string | null;
        manager_display_name: string | null;
        department_id: string | null;
        department_name: string | null;
        job_function: string | null;
        start_date: string | null;
        settings: unknown;
        role_ids: string[];
        role_names: string[];
      }
    >();
    for (const row of rows) {
      let entry = byMembership.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          user_id: row.user_id,
          status: row.status,
          email: row.email,
          display_name: row.display_name,
          manager_user_id: current.get(row.user_id)?.manager_user_id ?? null,
          manager_display_name: current.get(row.user_id)?.manager_name ?? null,
          department_id: current.get(row.user_id)?.department_id ?? null,
          department_name: current.get(row.user_id)?.department_name ?? null,
          job_function: current.get(row.user_id)?.job_function ?? null,
          start_date: row.start_date ?? row.joined_at?.slice(0, 10) ?? null,
          settings: withoutFeed(row.settings),
          role_ids: [],
          role_names: [],
        };
        byMembership.set(row.id, entry);
      }
      if (row.role_id) entry.role_ids.push(row.role_id);
      if (row.role_name) entry.role_names.push(row.role_name);
    }
    return [...byMembership.values()];
  }

  /**
   * Admin-only: free-form per-membership data. The manager line is dated now: it is set through
   * employment assignments (`organizations/:orgId/users/:userId/assignments`).
   */
  @Patch(':id/members/:membershipId')
  async updateMember(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { managerUserId?: string | null; settings?: Record<string, unknown> },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await reachesAll(db, id, callerId, 'nav.users', 'edit'))) return { ok: false, error: 'forbidden' };
    if (body.managerUserId !== undefined) return { ok: false, error: 'use-employment-assignments' };

    const [membership] = await db
      .select({ user_id: organization_memberships.user_id, settings: organization_memberships.settings })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };

    const patch: Partial<typeof organization_memberships.$inferInsert> = {};
    // The person's calendar feed is theirs alone: never set from here, never in the history.
    if (body.settings !== undefined) patch.settings = keepingFeed(body.settings, membership.settings);
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };

    await db.update(organization_memberships).set(patch).where(eq(organization_memberships.id, membershipId));
    const logged = { settings: withoutFeed(patch.settings) };
    void this.audit.record(id, callerId, 'membership.update', 'membership', membershipId).catch(() => {});
    void this.versions.record('organization_memberships', membershipId, 'update_delta', callerId, logged).catch(() => {});
    return { ok: true };
  }

  @Post(':id/members/:membershipId/roles')
  async grantRole(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { roleId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.roleId) return { ok: false, error: 'role-id-required' };
    const [membership] = await db
      .select({ organization_id: organization_memberships.organization_id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };
    if (!(await this.roleAssignable(db, id, body.roleId))) return { ok: false, error: 'invalid-role' };
    // Owner, admin and HR are the owners' to give; the other roles also an admin's.
    const refused = await this.refusal(db, id, callerId, body.roleId);
    if (refused) return { ok: false, error: refused };
    await db
      .insert(membership_roles)
      .values({ membership_id: membershipId, role_id: body.roleId, granted_by_user_id: callerId })
      .onConflictDoNothing();
    void this.audit.record(id, callerId, 'role.grant', 'membership', membershipId, { roleId: body.roleId }).catch(() => {});
    return { ok: true };
  }

  @Delete(':id/members/:membershipId/roles/:roleId')
  async revokeRole(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [membership] = await db
      .select({ id: organization_memberships.id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };
    const refused = await this.refusal(db, id, callerId, roleId);
    if (refused) return { ok: false, error: refused };
    const existingRoles = await db
      .select({ role_id: membership_roles.role_id })
      .from(membership_roles)
      .where(eq(membership_roles.membership_id, membershipId));
    // A membership must always keep at least one role — revoke by removing the whole membership instead.
    if (existingRoles.length <= 1) return { ok: false, error: 'last-role' };
    const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, roleId));
    const revoked = await db.transaction(async (tx) => {
      if (role?.name === 'owner') {
        // Only owners make owners, so an organization never loses its last one. The lock makes two at once wait.
        const owners = await tx.execute(
          sql`SELECT mr.membership_id FROM membership_roles mr
              JOIN roles r ON r.id = mr.role_id
              JOIN organization_memberships m ON m.id = mr.membership_id
              WHERE m.organization_id = ${id} AND m.status = 'active' AND r.name = 'owner'
              FOR UPDATE OF mr`,
        );
        // Compared with the stored id: the one in the path may be written differently.
        if (!owners.rows.some((o: Record<string, unknown>) => o.membership_id !== membership.id)) return false;
      }
      await tx
        .delete(membership_roles)
        .where(and(eq(membership_roles.membership_id, membership.id), eq(membership_roles.role_id, roleId)));
      return true;
    });
    if (!revoked) return { ok: false, error: 'last-owner' };
    void this.audit.record(id, callerId, 'role.revoke', 'membership', membershipId, { roleId }).catch(() => {});
    return { ok: true };
  }

  @Post(':id/invite')
  async invite(
    @Param('id') id: string,
    @Body() body: { email: string; roleId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const callerId = await callerUserId(db, principal);
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, id, callerId))) return { ok: false, error: 'forbidden' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    if (!(await this.roleAssignable(db, id, body.roleId))) return { ok: false, error: 'invalid-role' };
    // The same rule as granting it.
    const refused = await this.refusal(db, id, callerId, body.roleId);
    if (refused) return { ok: false, error: refused };
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, id));
    if (!org) return { ok: false, error: 'unknown-organization' };
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const [inserted] = await db
      .insert(organization_invitations)
      .values({
        organization_id: id,
        email,
        role_id: body.roleId,
        token,
        invited_by_user_id: callerId,
        expires_at: expiresAt,
      })
      .returning({ id: organization_invitations.id });
    const mail = buildInviteEmail(org.name, token);
    // The link only ever goes to the invited address: an inviter who knew it could become that person.
    // So the mail is the action itself, and an invitation nobody received is taken back.
    try {
      await sendMail({ to: email, ...mail });
    } catch {
      await db.delete(organization_invitations).where(eq(organization_invitations.id, inserted.id));
      return { ok: false, error: 'invitation-mail-failed' };
    }
    void this.audit.record(id, callerId, 'invitation.send', 'organization_invitation', inserted.id, { email, roleId: body.roleId }).catch(() => {});
    void this.versions
      .record('organization_invitations', inserted.id, 'insert', callerId, { id: inserted.id, organization_id: id, email, role_id: body.roleId, expires_at: expiresAt })
      .catch(() => {});
    return { ok: true, id: inserted.id };
  }

  @Get(':id/invitations')
  async invitations(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, id, callerId, 'nav.invitations', 'see'))) return [];
    return db
      .select({
        id: organization_invitations.id,
        email: organization_invitations.email,
        status: organization_invitations.status,
        expires_at: organization_invitations.expires_at,
        role_name: roles.name,
        invited_by: users.display_name,
      })
      .from(organization_invitations)
      .innerJoin(roles, eq(roles.id, organization_invitations.role_id))
      .innerJoin(users, eq(users.id, organization_invitations.invited_by_user_id))
      .where(eq(organization_invitations.organization_id, id));
  }

  @Delete('invitations/:invitationId')
  async revokeInvitation(@Param('invitationId') invitationId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [invitation] = await db
      .select({ organization_id: organization_invitations.organization_id, status: organization_invitations.status })
      .from(organization_invitations)
      .where(eq(organization_invitations.id, invitationId));
    if (!invitation) return { ok: false, error: 'invitation-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, invitation.organization_id, callerId, 'nav.invitations', 'edit'))) {
      return { ok: false, error: 'forbidden' };
    }
    if (invitation.status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    await db
      .update(organization_invitations)
      .set({ status: 'revoked' })
      .where(eq(organization_invitations.id, invitationId));
    void this.audit
      .record(invitation.organization_id, callerId, 'invitation.revoke', 'organization_invitation', invitationId)
      .catch(() => {});
    void this.versions.record('organization_invitations', invitationId, 'update_delta', callerId, { status: 'revoked' }).catch(() => {});
    return { ok: true };
  }

  @Get(':id/domains')
  async domains(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, id, callerId, 'nav.orgSettings', 'see'))) return [];
    return db
      .select({
        id: organization_domains.id,
        domain: organization_domains.domain,
        verified_at: organization_domains.verified_at,
        auto_join_enabled: organization_domains.auto_join_enabled,
      })
      .from(organization_domains)
      .where(eq(organization_domains.organization_id, id))
      .orderBy(asc(organization_domains.domain));
  }

  @Post(':id/domains')
  async upsertDomain(
    @Param('id') id: string,
    @Body() body: { domain: string; autoJoin: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, id, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const domain = (body.domain ?? '').trim().toLowerCase();
    if (!domain) return { ok: false, error: 'domain-required' };
    const [row] = await db
      .insert(organization_domains)
      .values({
        organization_id: id,
        domain,
        verification_token: randomUUID(),
        auto_join_enabled: body.autoJoin ?? false,
      })
      .onConflictDoUpdate({
        target: organization_domains.domain,
        set: { auto_join_enabled: body.autoJoin ?? false },
      })
      .returning({ id: organization_domains.id });
    void this.audit
      .record(id, callerId, 'domain.upsert', 'organization_domain', domain, { autoJoin: body.autoJoin ?? false })
      .catch(() => {});
    void this.versions.record('organization_domains', row.id, 'update_delta', callerId, { domain, auto_join_enabled: body.autoJoin ?? false }).catch(() => {});
    return { ok: true };
  }

  @Get(':id/sso')
  async sso(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, id, callerId, 'nav.orgSettings', 'see'))) return null;
    const [org] = await db.select({ sso_config: organizations.sso_config }).from(organizations).where(eq(organizations.id, id));
    const config = org?.sso_config as Record<string, unknown> | undefined;
    if (!config || !config.protocol) return null;
    return {
      protocol: config.protocol,
      idp_entity_id: config.idp_entity_id,
      idp_sso_url: config.idp_sso_url,
      is_active: config.is_active ?? false,
      updated_at: config.updated_at,
    };
  }

  @Post(':id/sso')
  async upsertSso(
    @Param('id') id: string,
    @Body() body: { protocol: string; idpEntityId: string; idpSsoUrl: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, id, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    if (!body.idpEntityId?.trim() || !body.idpSsoUrl?.trim()) return { ok: false, error: 'idp-fields-required' };
    const protocol = body.protocol;
    const idpEntityId = body.idpEntityId.trim();
    const idpSsoUrl = body.idpSsoUrl.trim();
    const ssoConfig = {
      protocol,
      idp_entity_id: idpEntityId,
      idp_sso_url: idpSsoUrl,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    await db.update(organizations).set({ sso_config: ssoConfig }).where(eq(organizations.id, id));
    void this.audit.record(id, callerId, 'sso.upsert', 'organization', id, { protocol, idpEntityId }).catch(() => {});
    void this.versions.record('organizations', id, 'update_delta', callerId, { sso_config: ssoConfig }).catch(() => {});
    return { ok: true };
  }
}
