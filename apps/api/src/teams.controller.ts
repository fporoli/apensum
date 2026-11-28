import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, can, canManageItem, canManageTeamMembers, isOrgMember, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { teams, team_members, organization_memberships, users, roles, projects } from './db/schema';
import { WorkflowsService } from './workflows.service';
import { cleanUnitCode, codeFromName } from '@worktime3/shared/workflowConfig';
import type { Db } from './db.service';

const leadUsers = alias(users, 'lead_users');

@Controller()
export class TeamsController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly workflows: WorkflowsService,
  ) {}

  /** Whether another team of the organization has `code`. */
  private async codeTaken(db: Db, orgId: string, code: string, exceptId?: string): Promise<boolean> {
    const rows = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.organization_id, orgId), eq(teams.code, code)));
    return rows.some((r) => r.id !== exceptId);
  }

  /** `base`, or `base-2`, `base-3`, ... whichever the organization doesn't use yet. */
  private async freeCode(db: Db, orgId: string, base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const code = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
      if (!(await this.codeTaken(db, orgId, code))) return code;
    }
  }

  @Get('organizations/:orgId/teams')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        code: teams.code,
        lead_user_id: teams.lead_user_id,
        lead_display_name: leadUsers.display_name,
        member_count: sql<number>`count(${team_members.membership_id})::int`,
      })
      .from(teams)
      .leftJoin(team_members, eq(team_members.team_id, teams.id))
      .leftJoin(leadUsers, eq(leadUsers.id, teams.lead_user_id))
      .where(eq(teams.organization_id, orgId))
      .groupBy(teams.id, leadUsers.display_name)
      .orderBy(asc(teams.name));
  }

  @Post('organizations/:orgId/teams')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; description?: string; leadUserId?: string | null; code?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, orgId, callerId, 'nav.management', 'edit'))) {
      return { ok: false, error: 'forbidden' };
    }
    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    // The creator becomes the team's lead by default, so they can manage its members
    // right away. Only Team Management on all teams (admin) may hand initial leadership to someone else.
    let leadUserId: string | null;
    if (body.leadUserId !== undefined) {
      if (body.leadUserId !== callerId && !(await reachesAll(db, orgId, callerId, 'nav.management', 'edit'))) {
        return { ok: false, error: 'forbidden-lead' };
      }
      leadUserId = body.leadUserId;
    } else {
      leadUserId = callerId;
    }
    if (leadUserId && leadUserId !== callerId && !(await isOrgMember(db, orgId, leadUserId))) return { ok: false, error: 'leader-not-a-member' };
    // Its code (workflows name it): the one given, else one made from the name.
    const given = cleanUnitCode(body.code);
    if (given === undefined) return { ok: false, error: 'invalid-code' };
    if (given && (await this.codeTaken(db, orgId, given))) return { ok: false, error: 'duplicate-code' };
    const code = given ?? (await this.freeCode(db, orgId, codeFromName(name)));
    const [team] = await db
      .insert(teams)
      .values({ organization_id: orgId, name, description: body.description ?? null, lead_user_id: leadUserId, code })
      .returning({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        code: teams.code,
        lead_user_id: teams.lead_user_id,
      });
    void this.versions.record('teams', team.id, 'insert', callerId, team).catch(() => {});
    return { ok: true, team, id: team.id };
  }

  @Patch('teams/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; leadUserId?: string | null; code?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db
      .select({ organization_id: teams.organization_id, lead_user_id: teams.lead_user_id, code: teams.code })
      .from(teams)
      .where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    // Teams the caller leads (`own`), or any team (`all`). That includes handing the lead to someone else.
    if (!(await canManageItem(db, team.organization_id, callerId, [team.lead_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    const patch: Partial<typeof teams.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.leadUserId !== undefined) {
      if (body.leadUserId && body.leadUserId !== team.lead_user_id && !(await isOrgMember(db, team.organization_id, body.leadUserId))) {
        return { ok: false, error: 'leader-not-a-member' };
      }
      patch.lead_user_id = body.leadUserId;
    }
    if (body.code !== undefined) {
      const code = cleanUnitCode(body.code);
      if (!code) return { ok: false, error: 'invalid-code' };
      if (code !== team.code && (await this.codeTaken(db, team.organization_id, code, id))) return { ok: false, error: 'duplicate-code' };
      if (code !== team.code) patch.code = code;
    }
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };

    const [updated] = await db
      .update(teams)
      .set(patch)
      .where(eq(teams.id, id))
      .returning({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        code: teams.code,
        lead_user_id: teams.lead_user_id,
      });
    // Workflows name teams by code: their stored configurations follow the new one.
    if (patch.code && team.code) await this.workflows.renameUnit(db, team.organization_id, 'team', team.code, patch.code);
    void this.versions.record('teams', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true, team: updated };
  }

  @Delete('teams/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db
      .select({ organization_id: teams.organization_id, lead_user_id: teams.lead_user_id, code: teams.code })
      .from(teams)
      .where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await canManageItem(db, team.organization_id, callerId, [team.lead_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }
    if (team.code && (await this.workflows.unitInUse(db, team.organization_id, 'team', team.code))) return { ok: false, error: 'team-in-workflow' };

    // A team that limits projects stays until it is removed from them (070), so no project
    // silently opens up to everyone.
    const used = await db.execute(sql`SELECT 1 FROM project_teams WHERE team_id = ${id} LIMIT 1`);
    if (used.rows.length > 0) return { ok: false, error: 'team-has-projects' };

    await db.delete(teams).where(eq(teams.id, id));
    void this.versions.record('teams', id, 'delete', callerId, team).catch(() => {});
    return { ok: true };
  }

  @Get('teams/:id/members')
  async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, team.organization_id, callerId))) return [];
    return db
      .select({
        team_id: team_members.team_id,
        membership_id: team_members.membership_id,
        user_id: organization_memberships.user_id,
        email: users.email,
        display_name: users.display_name,
        team_role_id: team_members.team_role_id,
        team_role_name: roles.name,
      })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .leftJoin(roles, eq(roles.id, team_members.team_role_id))
      .where(and(eq(team_members.team_id, id), eq(organization_memberships.organization_id, team.organization_id)))
      .orderBy(asc(users.display_name));
  }

  @Post('teams/:id/members')
  async addMember(
    @Param('id') id: string,
    @Body() body: { membershipId?: string; userId?: string; teamRoleId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await canManageTeamMembers(db, team.organization_id, id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    let membershipId = body.membershipId;
    if (!membershipId && body.userId) {
      const [membership] = await db
        .select({ id: organization_memberships.id })
        .from(organization_memberships)
        .where(
          and(
            eq(organization_memberships.organization_id, team.organization_id),
            eq(organization_memberships.user_id, body.userId),
          ),
        );
      if (!membership) return { ok: false, error: 'membership-not-found' };
      membershipId = membership.id;
    }

    if (!membershipId) return { ok: false, error: 'membership-id-required' };
    if (body.membershipId) {
      const [own] = await db
        .select({ id: organization_memberships.id })
        .from(organization_memberships)
        .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, team.organization_id)));
      if (!own) return { ok: false, error: 'membership-not-found' };
    }
    // A team role of this organization or a global one, never another organization's.
    if (body.teamRoleId) {
      const [role] = await db.select({ organization_id: roles.organization_id }).from(roles).where(eq(roles.id, body.teamRoleId));
      if (!role || (role.organization_id !== null && role.organization_id !== team.organization_id)) return { ok: false, error: 'unknown-role' };
    }

    await db
      .insert(team_members)
      .values({
        team_id: id,
        membership_id: membershipId,
        team_role_id: body.teamRoleId ?? null,
      })
      .onConflictDoUpdate({
        target: [team_members.team_id, team_members.membership_id],
        set: { team_role_id: body.teamRoleId ?? null },
      });
    return { ok: true };
  }

  @Delete('teams/:id/members/:membershipId')
  async removeMember(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await canManageTeamMembers(db, team.organization_id, id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await db
      .delete(team_members)
      .where(and(eq(team_members.team_id, id), eq(team_members.membership_id, membershipId)));
    return { ok: true };
  }
}
