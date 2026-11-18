import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { bookableProjectCondition, callerUserId, can, canManageItem, canSeeUserData, isOrgMember, reachesAll } from './access';
import { VersionsService } from './versions.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { project_teams, projects, subprojects, users } from './db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The teams a project is limited to (project_teams, 070), from a request body: `undefined` when the
 * body doesn't set them, else the distinct ids; `null` when it is not a list of ids.
 */
export function teamIdsFromBody(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && UUID.test(v))) return null;
  return [...new Set(value as string[])];
}

@Controller()
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  /**
   * Every project of the organization, with the teams it is limited to (`team_ids`, empty = open to
   * everyone) and whether `bookableFor` (default: the caller; someone else only if the caller may see
   * their project time) may book time on it (`bookable`).
   */
  @Get('organizations/:orgId/projects')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('bookableFor') bookableFor?: string) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    const forUser =
      bookableFor && bookableFor !== callerId && UUID.test(bookableFor) && (await canSeeUserData(db, orgId, callerId, 'nav.time', bookableFor))
        ? bookableFor
        : callerId;
    return db
      .select({
        ...getTableColumns(projects),
        owner_name: users.display_name,
        owner_email: users.email,
        subproject_count: sql<number>`count(${subprojects.id})::int`,
        team_ids: sql<string[]>`coalesce((SELECT array_agg(pt.team_id ORDER BY pt.team_id) FROM project_teams pt WHERE pt.project_id = ${projects.id}), '{}')`,
        bookable: sql<boolean>`EXISTS (SELECT 1 FROM projects p WHERE p.id = ${projects.id} AND ${bookableProjectCondition(forUser)})`,
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.owner_user_id))
      .leftJoin(subprojects, eq(subprojects.project_id, projects.id))
      .where(eq(projects.organization_id, orgId))
      .groupBy(projects.id, users.display_name, users.email)
      .orderBy(asc(projects.name));
  }

  @Post('organizations/:orgId/projects')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; ownerUserId?: string; costItem?: string; type?: string; teamIds?: string[] },
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
    const ownerUserId = body.ownerUserId || callerId;
    // Making someone else the owner needs Team Management on all projects (an `own` grant would lose it).
    if (ownerUserId !== callerId && !(await reachesAll(db, orgId, callerId, 'nav.management', 'edit'))) {
      return { ok: false, error: 'forbidden-owner' };
    }
    const teamIds = teamIdsFromBody(body.teamIds);
    if (teamIds === null || (teamIds && !(await this.teamsInOrg(db, orgId, teamIds)))) return { ok: false, error: 'unknown-team' };
    const [project] = await db
      .insert(projects)
      .values({
        organization_id: orgId,
        name,
        owner_user_id: ownerUserId,
        cost_item: body.costItem ?? null,
        type: (body.type as (typeof projects.$inferInsert)['type']) ?? 'internal',
      })
      .returning();
    if (teamIds?.length) await this.setTeams(db, project.id, teamIds);
    void this.versions.record('projects', project.id, 'insert', callerId, { ...project, team_ids: teamIds ?? [] }).catch(() => {});
    return { ok: true, id: project.id, project };
  }

  @Patch('projects/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string; teamIds?: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    // Projects the caller owns (`own`), or any project (`all`).
    if (!(await canManageItem(db, project.organization_id, callerId, [project.owner_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    const teamIds = teamIdsFromBody(body.teamIds);
    if (teamIds === null || (teamIds && !(await this.teamsInOrg(db, project.organization_id, teamIds)))) {
      return { ok: false, error: 'unknown-team' };
    }

    const patch: Partial<typeof projects.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.ownerUserId !== undefined) patch.owner_user_id = body.ownerUserId || null;
    if (body.costItem !== undefined) patch.cost_item = body.costItem || null;
    if (body.type !== undefined) patch.type = body.type as (typeof projects.$inferInsert)['type'];

    const [updated] = Object.keys(patch).length ? await db.update(projects).set(patch).where(eq(projects.id, id)).returning() : [project];
    if (teamIds) await this.setTeams(db, id, teamIds);
    void this.versions.record('projects', id, 'update_delta', callerId, teamIds ? { ...patch, team_ids: teamIds } : patch).catch(() => {});
    return { ok: true, project: updated };
  }

  @Delete('projects/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    // Projects the caller owns (`own`), or any project (`all`).
    if (!(await canManageItem(db, project.organization_id, callerId, [project.owner_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    await db.delete(projects).where(eq(projects.id, id));
    void this.versions.record('projects', id, 'delete', callerId, project).catch(() => {});
    return { ok: true };
  }

  /** Whether every id is a team of this organization. */
  private async teamsInOrg(db: Db, orgId: string, teamIds: string[]): Promise<boolean> {
    if (teamIds.length === 0) return true;
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM teams WHERE organization_id = ${orgId}
          AND id IN (${sql.join(teamIds.map((x) => sql`${x}::uuid`), sql`, `)})`,
    );
    return (rows.rows[0]?.n as number) === teamIds.length;
  }

  /** Replaces the teams a project is limited to (an empty list opens it to everyone). */
  private async setTeams(db: Db, projectId: string, teamIds: string[]) {
    await db.transaction(async (tx) => {
      await tx.delete(project_teams).where(eq(project_teams.project_id, projectId));
      if (teamIds.length) await tx.insert(project_teams).values(teamIds.map((team_id) => ({ project_id: projectId, team_id })));
    });
  }

  @Get('organizations/:orgId/subprojects')
  async orgSubList(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select({
        ...getTableColumns(subprojects),
        project_name: projects.name,
        owner_name: users.display_name,
        owner_email: users.email,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .leftJoin(users, eq(users.id, subprojects.owner_user_id))
      .where(eq(subprojects.organization_id, orgId))
      .orderBy(asc(projects.name), asc(subprojects.name));
  }

  @Get('projects/:id/subprojects')
  async subList(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const [project] = await db.select({ organization_id: projects.organization_id }).from(projects).where(eq(projects.id, id));
    if (!project) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, project.organization_id, callerId))) return [];
    return db
      .select({
        ...getTableColumns(subprojects),
        project_name: projects.name,
        owner_name: users.display_name,
        owner_email: users.email,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .leftJoin(users, eq(users.id, subprojects.owner_user_id))
      .where(eq(subprojects.project_id, id))
      .orderBy(asc(subprojects.name));
  }

  @Post('projects/:id/subprojects')
  async subCreate(
    @Param('id') id: string,
    @Body() body: { organizationId?: string; name: string; ownerUserId?: string; costItem?: string; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };
    // Always the project's own organization (never one from the body).
    const orgId = project.organization_id;

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    // Subprojects of projects the caller owns (`own`), or of any project (`all`).
    if (!(await canManageItem(db, orgId, callerId, [project.owner_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    const ownerUserId = body.ownerUserId || callerId;

    const [subproject] = await db
      .insert(subprojects)
      .values({
        project_id: id,
        organization_id: orgId,
        name,
        owner_user_id: ownerUserId,
        cost_item: body.costItem ?? null,
        type: (body.type as (typeof subprojects.$inferInsert)['type']) ?? 'phase',
      })
      .returning();
    void this.versions.record('subprojects', subproject.id, 'insert', callerId, subproject).catch(() => {});
    return { ok: true, id: subproject.id, subproject };
  }

  /** Shared by subUpdate/subRemove: the subproject plus its parent project's owner/org, for the authz check. */
  private async subprojectWithParent(db: NonNullable<ReturnType<DbService['getDb']>>, id: string) {
    const [row] = await db
      .select({
        ...getTableColumns(subprojects),
        project_owner_user_id: projects.owner_user_id,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .where(eq(subprojects.id, id));
    return row;
  }

  @Patch('subprojects/:id')
  async subUpdate(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const subproject = await this.subprojectWithParent(db, id);
    if (!subproject) return { ok: false, error: 'subproject-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    // Subprojects the caller owns or whose project they own (`own`), or any (`all`).
    if (!(await canManageItem(db, subproject.organization_id, callerId, [subproject.project_owner_user_id, subproject.owner_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    const patch: Partial<typeof subprojects.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.ownerUserId !== undefined) patch.owner_user_id = body.ownerUserId || null;
    if (body.costItem !== undefined) patch.cost_item = body.costItem || null;
    if (body.type !== undefined) patch.type = body.type as (typeof subprojects.$inferInsert)['type'];

    const [updated] = await db.update(subprojects).set(patch).where(eq(subprojects.id, id)).returning();
    void this.versions.record('subprojects', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true, subproject: updated };
  }

  @Delete('subprojects/:id')
  async subRemove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const subproject = await this.subprojectWithParent(db, id);
    if (!subproject) return { ok: false, error: 'subproject-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    // Subprojects the caller owns or whose project they own (`own`), or any (`all`).
    if (!(await canManageItem(db, subproject.organization_id, callerId, [subproject.project_owner_user_id, subproject.owner_user_id]))) {
      return { ok: false, error: 'forbidden' };
    }

    await db.delete(subprojects).where(eq(subprojects.id, id));
    void this.versions.record('subprojects', id, 'delete', callerId, subproject).catch(() => {});
    return { ok: true };
  }
}
