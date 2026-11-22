import { sql, type SQL } from 'drizzle-orm';
import type { Db } from './db.service';
import type { AuthenticatedPrincipal } from './jwt';
import {
  OWNER_ONLY_OBJECTS,
  OWNER_PERMISSIONS,
  allPermissionIds,
  grantedScopes,
  ownerAppoints,
  scopesCover,
  sectionParent,
  type Action,
  type Scope,
} from '@worktime3/shared/permissions';
import { resolveModules, withoutDisabledModules } from '@worktime3/shared/modules';

/** The slice of Db these helpers need — easy to fake in tests, satisfied by any real Db. */
export type Executor = Pick<Db, 'execute'>;

/** Resolve the caller's app user id from a validated token principal. */
export async function callerUserId(db: Executor, principal: AuthenticatedPrincipal): Promise<string | null> {
  if (principal.kind === 'local') return principal.sub;
  const found = await db.execute(
    sql`SELECT user_id FROM user_identities WHERE provider_user_id = ${principal.sub} LIMIT 1`,
  );
  return (found.rows[0]?.user_id as string) ?? null;
}

/** Highest privilege first — used to pick a single "display" role out of a membership's role set. */
const ROLE_PRIORITY = ['owner', 'admin', 'manager', 'member', 'guest'];

/** Reduce a set of role names (one membership can hold several) to the single highest-privilege one. */
export function pickPrimaryRole(names: string[]): string | null {
  if (names.length === 0) return null;
  return [...names].sort((a, b) => {
    const ai = ROLE_PRIORITY.indexOf(a);
    const bi = ROLE_PRIORITY.indexOf(b);
    return (ai === -1 ? ROLE_PRIORITY.length : ai) - (bi === -1 ? ROLE_PRIORITY.length : bi);
  })[0];
}

/** All of a user's active role names in an organization — a membership can now hold more than one. */
async function activeRoleNames(db: Executor, organizationId: string, userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT r.name FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId} AND m.status = 'active'`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.name as string);
}

/** True when the user has any active membership in the organization — the baseline gate for reading its data at all. */
export async function isOrgMember(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.length > 0;
}

/** True when the user is an active owner/admin of the organization. */
export async function isOrgAdmin(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.includes('owner') || names.includes('admin');
}

/** True when the user is an active owner of the organization. */
export async function isOrgOwner(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  return (await activeRoleNames(db, organizationId, userId)).includes('owner');
}

/** True when only an owner hands the role out or takes it away (`ownerAppoints`); an unknown role counts as one. */
export async function roleNeedsOwner(db: Executor, roleId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT name FROM roles WHERE id = ${roleId}`);
  const name = rows.rows[0]?.name;
  return typeof name !== 'string' || ownerAppoints(name);
}

/**
 * Whether only an owner's invitation counts: its role is one only owners appoint, or the invitee holds
 * such a role here and accepting would reactivate it or set the password of their account without login.
 */
export async function invitationNeedsOwner(
  db: Executor,
  organizationId: string,
  roleId: string,
  invitee: { id: string; setsPassword: boolean } | null,
): Promise<boolean> {
  if (await roleNeedsOwner(db, roleId)) return true;
  if (!invitee) return false;
  const rows = await db.execute(
    sql`SELECT m.status, r.name FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        WHERE m.organization_id = ${organizationId} AND m.user_id = ${invitee.id}`,
  );
  return rows.rows.some((r: Record<string, unknown>) => (invitee.setsPassword || r.status !== 'active') && ownerAppoints(String(r.name)));
}

/** True when the user is a superdeveloper: AI limits and product news. Nothing inside an organization. */
export async function isSuperDeveloper(db: Executor, userId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT is_superdeveloper FROM users WHERE id = ${userId} LIMIT 1`);
  return rows.rows[0]?.is_superdeveloper === true;
}

/** True when the user may edit this organization's form template: its developer. */
export async function isOrgDeveloper(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.includes('developer');
}

/**
 * The caller's single highest-privilege role name in the organization — a
 * membership can hold several roles at once, so this collapses them to the
 * one existing single-role permission checks (e.g. `role === 'manager'`)
 * still expect. Custom roles outside the known ladder sort after it.
 */
export async function userOrgRole(db: Executor, organizationId: string, userId: string): Promise<string | null> {
  const names = await activeRoleNames(db, organizationId, userId);
  return pickPrimaryRole(names);
}

/**
 * True when the caller may give or take `roleId` (grant, invite, revoke): only an owner for the roles
 * owners appoint (owner, admin, hr, ...); for the others an owner, or whoever administers members
 * (Users edit on everyone, admin by default). `roles.admin_user_ids` is no longer read.
 */
export async function canManageRole(db: Executor, organizationId: string, callerId: string, roleId: string): Promise<boolean> {
  if (await roleNeedsOwner(db, roleId)) return isOrgOwner(db, organizationId, callerId);
  if (await reachesAll(db, organizationId, callerId, 'nav.users', 'edit')) return true;
  return isOrgOwner(db, organizationId, callerId);
}

/**
 * `userId`'s manager in this org on `onDate` ('YYYY-MM-DD', default today): the manager of their
 * employee assignment in force then (latest `valid_from` on or before it), or null if none (top of
 * their chain). Managers change over time, so always ask this rather than storing the answer.
 */
export async function membershipManagerId(db: Executor, organizationId: string, userId: string, onDate?: string): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT manager_user_id FROM employee_assignments
        WHERE organization_id = ${organizationId} AND user_id = ${userId}
          AND valid_from <= COALESCE(${onDate ?? null}::date, CURRENT_DATE)
        ORDER BY valid_from DESC LIMIT 1`,
  );
  return (rows.rows[0]?.manager_user_id as string | null) ?? null;
}

/** True when `managerId` is the org's designated manager for `targetUserId` — i.e. approvals for them route to `managerId`. */
export async function isManagerOf(db: Executor, organizationId: string, managerId: string, targetUserId: string): Promise<boolean> {
  return (await membershipManagerId(db, organizationId, targetUserId)) === managerId;
}

/** Assignments in force today, one row per person of the organization (user, manager). */
function currentManagers(organizationId: string): SQL {
  return sql`SELECT DISTINCT ON (user_id) user_id, manager_user_id FROM employee_assignments
             WHERE organization_id = ${organizationId} AND valid_from <= CURRENT_DATE
             ORDER BY user_id, valid_from DESC`;
}

/**
 * Everyone below `managerId` in today's reporting line: their direct reports, those people's reports,
 * and so on down. Read access only (canSeeUserData, listableUserIds); editing, approving and reopening
 * stay with the direct manager (isManagerOf). A loop in the assignments ends instead of repeating.
 */
export async function reportingLineUserIds(db: Executor, organizationId: string, managerId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`WITH RECURSIVE cur AS (${currentManagers(organizationId)}),
        below(user_id) AS (
          SELECT user_id FROM cur WHERE manager_user_id = ${managerId}
          UNION
          SELECT cur.user_id FROM cur JOIN below ON cur.manager_user_id = below.user_id
        )
        SELECT user_id FROM below WHERE user_id <> ${managerId}`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.user_id as string);
}

/** True when `managerId` is above `targetUserId` in today's reporting line (their manager, that manager's manager, ...). */
export async function isAboveInReportingLine(db: Executor, organizationId: string, managerId: string, targetUserId: string): Promise<boolean> {
  if (managerId === targetUserId) return false;
  const rows = await db.execute(
    sql`WITH RECURSIVE cur AS (${currentManagers(organizationId)}),
        above(user_id) AS (
          SELECT manager_user_id FROM cur WHERE user_id = ${targetUserId} AND manager_user_id IS NOT NULL
          UNION
          SELECT cur.manager_user_id FROM cur JOIN above ON cur.user_id = above.user_id WHERE cur.manager_user_id IS NOT NULL
        )
        SELECT 1 FROM above WHERE user_id = ${managerId} LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** user_ids whose assignment in force today names `managerId` as their manager — i.e. `managerId`'s direct reports. */
export async function directReportUserIds(db: Executor, organizationId: string, managerId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT user_id FROM (
          SELECT DISTINCT ON (user_id) user_id, manager_user_id FROM employee_assignments
          WHERE organization_id = ${organizationId} AND valid_from <= CURRENT_DATE
          ORDER BY user_id, valid_from DESC
        ) current_assignment WHERE manager_user_id = ${managerId}`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.user_id as string);
}

/**
 * Team Management on one team/project/subproject: an `edit` grant reaching `all` manages any,
 * an `own` grant only those the caller leads or owns (`ownerIds`: lead, owner, parent owner).
 */
export async function canManageItem(db: Executor, organizationId: string, callerId: string, ownerIds: (string | null | undefined)[]): Promise<boolean> {
  const scopes = grantedScopes(await permissionIdsOf(db, organizationId, callerId), 'nav.management', 'edit');
  return scopes.has('all') || (scopes.has('own') && ownerIds.includes(callerId));
}

/** True when the caller may onboard/offboard members on this team: Team Management on it (its lead, or `all`). */
export async function canManageTeamMembers(db: Executor, organizationId: string, teamId: string, callerId: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT lead_user_id FROM teams WHERE id = ${teamId} AND organization_id = ${organizationId} LIMIT 1`,
  );
  if (rows.rows.length === 0) return false;
  return canManageItem(db, organizationId, callerId, [rows.rows[0].lead_user_id as string | null]);
}

/**
 * SQL condition (over `p` = projects) for "`userId` may book time on project p": the project has
 * no teams (project_teams, 070), or the person owns it, or is an active member or the lead of one
 * of its teams.
 */
export function bookableProjectCondition(userId: string): SQL {
  return sql`(NOT EXISTS (SELECT 1 FROM project_teams pt WHERE pt.project_id = p.id)
    OR p.owner_user_id = ${userId}
    OR EXISTS (
      SELECT 1 FROM project_teams pt JOIN teams t ON t.id = pt.team_id
      WHERE pt.project_id = p.id AND (t.lead_user_id = ${userId} OR EXISTS (
        SELECT 1 FROM team_members tm JOIN organization_memberships m ON m.id = tm.membership_id
        WHERE tm.team_id = t.id AND m.user_id = ${userId} AND m.status = 'active'))))`;
}

/**
 * Whether `userId` may book project time on this project (and subproject): both belong to the
 * organization, the subproject to the project, and the project is open to the person
 * (`bookableProjectCondition`). Returns the refusal as an error code, or null when allowed.
 * No project at all is always allowed (hours without a project).
 */
export async function projectBookingError(
  db: Executor,
  organizationId: string,
  userId: string,
  projectId: string | null | undefined,
  subprojectId?: string | null,
): Promise<string | null> {
  if (!projectId) return subprojectId ? 'unknown-project' : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(projectId) || (subprojectId && !uuid.test(subprojectId))) return 'unknown-project';
  const rows = await db.execute(
    sql`SELECT ${bookableProjectCondition(userId)} AS bookable,
          ${subprojectId ? sql`EXISTS (SELECT 1 FROM subprojects s WHERE s.id = ${subprojectId}::uuid AND s.project_id = p.id)` : sql`TRUE`} AS sub_ok
        FROM projects p WHERE p.id = ${projectId}::uuid AND p.organization_id = ${organizationId}`,
  );
  const row = rows.rows[0] as { bookable: boolean; sub_ok: boolean } | undefined;
  if (!row || !row.sub_ok) return 'unknown-project';
  return row.bookable ? null : 'project-not-allowed';
}

/**
 * A local calendar day for the lock checks: a 'YYYY-MM-DD' date as it is, a timestamp as its date
 * in the person's time zone (`users.timezone`, else UTC), so 00:30 on the 1st is in the new month.
 */
function lockDay(userId: string, value: string): SQL {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return sql`${value}::date`;
  return sql`(${value}::timestamptz AT TIME ZONE coalesce((SELECT timezone FROM users WHERE id = ${userId}), 'UTC'))::date`;
}

/**
 * The first and last local day of `from` .. `until` (exclusive end: a session ending at 00:00 does
 * not reach into that day). Without `until`, or with an end not after the start, only `from`'s day.
 */
function lockDays(userId: string, from: string, until?: string | null): { first: SQL; last: SQL } {
  const first = lockDay(userId, from);
  const end = until ? Date.parse(until) : NaN;
  if (Number.isNaN(end) || end <= Date.parse(from)) return { first, last: first };
  return { first, last: lockDay(userId, new Date(end - 1).toISOString()) };
}

/**
 * True when `dateOrTimestamp` (through `until`, for a session running past midnight) touches a
 * submitted/approved working-time timesheet month of this user: the single gate the work-time and
 * absence handlers call before touching an entry. `rejected`/`open` periods are NOT locked (an
 * employee fixing a rejected month must be able to edit again).
 */
export async function isPeriodLocked(
  db: Executor,
  organizationId: string,
  userId: string,
  dateOrTimestamp: string,
  until?: string | null,
): Promise<boolean> {
  const { first, last } = lockDays(userId, dateOrTimestamp, until);
  // A closed year (year-end closing, balance_years) locks every month of it too.
  const rows = await db.execute(
    sql`SELECT 1 FROM timesheet_periods
        WHERE organization_id = ${organizationId} AND user_id = ${userId}
          AND status IN ('submitted', 'approved')
          AND period_start <= ${last} AND period_end > ${first}
        UNION ALL
        SELECT 1 FROM balance_years
        WHERE organization_id = ${organizationId} AND user_id = ${userId}
          AND year BETWEEN extract(year FROM ${first})::int AND extract(year FROM ${last})::int
        LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** True when the person's year is closed (year-end closing, `balance_years`): nothing in it changes until it is reopened. */
export async function isYearClosed(db: Executor, organizationId: string, userId: string, year: number): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM balance_years WHERE organization_id = ${organizationId} AND user_id = ${userId} AND year = ${year} LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/**
 * True when project time from `dateOrTimestamp` (through `until`) on this project touches a
 * submitted/approved project month (project timesheet) of this user. No project never locks.
 */
export async function isProjectPeriodLocked(
  db: Executor,
  organizationId: string,
  userId: string,
  projectId: string | null | undefined,
  dateOrTimestamp: string,
  until?: string | null,
): Promise<boolean> {
  if (!projectId) return false;
  const { first, last } = lockDays(userId, dateOrTimestamp, until);
  const rows = await db.execute(
    sql`SELECT 1 FROM project_time_periods
        WHERE organization_id = ${organizationId} AND user_id = ${userId} AND project_id = ${projectId}
          AND status IN ('submitted', 'approved')
          AND period_start <= ${last} AND period_end > ${first}
        LIMIT 1`,
  );
  return rows.rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Permissions (packages/shared/src/permissions.ts): `<object>:<action>:<scope>` ids held via
// membership_roles -> role_permissions. An organization's own copy of a role carries its own
// rows, so this is a plain join; `owner` holds OWNER_PERMISSIONS and nothing else, without rows.

/** The caller's permission ids in this organization, merged across all their active roles. */
export async function permissionIdsOf(db: Executor, organizationId: string, userId: string): Promise<Set<string>> {
  const rows = await db.execute(
    sql`SELECT r.name, rp.permission_id, o.settings -> 'modules' AS modules,
          (SELECT jsonb_agg(l.module_id) FROM organization_licenses l
            WHERE l.organization_id = o.id AND (l.valid_until IS NULL OR l.valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date)) AS licenses
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId} AND m.status = 'active'`,
  );
  const list = rows.rows as { name: string; permission_id: string | null; modules?: unknown; licenses?: unknown }[];
  // A module the organization switched off takes its navbar entries' permissions with it (modules.ts).
  return withoutDisabledModules(mergePermissionRows(list), resolveModules(list[0]?.modules, list[0]?.licenses));
}

/**
 * Folds `(role name, permission id)` rows into one set; an `owner` row means OWNER_PERMISSIONS only.
 * Only catalogue ids count: grants on objects nobody registered (a plugin that is not installed,
 * legacy ids like `data:read`) stay in the database but grant nothing.
 */
export function mergePermissionRows(rows: { name: string; permission_id: string | null }[]): Set<string> {
  const catalogue = new Set(allPermissionIds());
  const ids = new Set<string>(rows.some((r) => r.name === 'owner') ? OWNER_PERMISSIONS : []);
  for (const r of rows) {
    if (r.name === 'owner' || !r.permission_id || !catalogue.has(r.permission_id)) continue;
    if (!OWNER_ONLY_OBJECTS.includes(r.permission_id.split(':')[0])) ids.add(r.permission_id);
  }
  return ids;
}

/** True when `a` and `b` share a team in this organization, as members or as its lead. */
async function sharesTeam(db: Executor, organizationId: string, a: string, b: string): Promise<boolean> {
  const rows = await db.execute(
    sql`WITH people AS (
          SELECT t.id AS team_id, m.user_id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            JOIN organization_memberships m ON m.id = tm.membership_id
            WHERE t.organization_id = ${organizationId} AND m.organization_id = t.organization_id AND m.status = 'active'
          UNION
          SELECT t.id, t.lead_user_id FROM teams t
            JOIN organization_memberships lm ON lm.organization_id = t.organization_id AND lm.user_id = t.lead_user_id AND lm.status = 'active'
            WHERE t.organization_id = ${organizationId}
        )
        SELECT 1 FROM people x JOIN people y ON y.team_id = x.team_id
        WHERE x.user_id = ${a} AND y.user_id = ${b} LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** user_ids sharing a team with `userId` in this organization (including `userId` if they are in one). */
async function teammateUserIds(db: Executor, organizationId: string, userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`WITH people AS (
          SELECT t.id AS team_id, m.user_id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            JOIN organization_memberships m ON m.id = tm.membership_id
            WHERE t.organization_id = ${organizationId} AND m.organization_id = t.organization_id AND m.status = 'active'
          UNION
          SELECT t.id, t.lead_user_id FROM teams t
            JOIN organization_memberships lm ON lm.organization_id = t.organization_id AND lm.user_id = t.lead_user_id AND lm.status = 'active'
            WHERE t.organization_id = ${organizationId}
        )
        SELECT DISTINCT y.user_id FROM people x JOIN people y ON y.team_id = x.team_id
        WHERE x.user_id = ${userId}`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.user_id as string);
}

async function isActiveMember(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId} AND status = 'active' LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** Whether `scopes` cover `targetUserId`; only runs the queries the scopes need. */
async function coversTarget(db: Executor, organizationId: string, callerId: string, targetUserId: string, scopes: Set<Scope>): Promise<boolean> {
  const isSelf = targetUserId === callerId;
  if (isSelf && scopes.has('own')) return true;
  const rel = { isSelf, isTeammate: false, isReport: false, isMember: false };
  if (scopes.has('all')) rel.isMember = await isActiveMember(db, organizationId, targetUserId);
  if (!rel.isMember && scopes.has('reports')) rel.isReport = await isManagerOf(db, organizationId, callerId, targetUserId);
  if (!rel.isMember && !rel.isReport && scopes.has('team')) rel.isTeammate = await sharesTeam(db, organizationId, callerId, targetUserId);
  return scopesCover(scopes, rel);
}

/**
 * True when the caller may `action` (`see` / `edit`) `object` (a navbar entry or UI section) —
 * for `targetUserId`'s data when given, otherwise at all (e.g. to show a navbar entry).
 * A section also needs its parent navbar entry: My data for the caller's own data, the
 * Users page for anyone else's.
 */
export async function can(
  db: Executor,
  organizationId: string,
  callerId: string,
  object: string,
  action: Action,
  targetUserId?: string,
  held?: Set<string>,
): Promise<boolean> {
  const ids = held ?? (await permissionIdsOf(db, organizationId, callerId));
  const parent = sectionParent(object, targetUserId === undefined || targetUserId === callerId);
  if (parent && !(await can(db, organizationId, callerId, parent, 'see', targetUserId, ids))) return false;
  const scopes = grantedScopes(ids, object, action);
  if (scopes.size === 0) return false;
  if (targetUserId === undefined) return true;
  return coversTarget(db, organizationId, callerId, targetUserId, scopes);
}

/**
 * Whose data the caller may `action` on `object`: `'all'`, or the set of user ids their
 * grants cover (for list endpoints, instead of calling `can()` per person). For a section,
 * the parent navbar entries narrow the result the same way `can()` does.
 */
export async function visibleUserIds(
  db: Executor,
  organizationId: string,
  callerId: string,
  object: string,
  action: Action,
  held?: Set<string>,
): Promise<'all' | Set<string>> {
  const ids = held ?? (await permissionIdsOf(db, organizationId, callerId));
  const own = await scopedUserIds(db, organizationId, callerId, grantedScopes(ids, object, action));
  const ownParent = sectionParent(object, true);
  const othersParent = sectionParent(object, false);
  if (!ownParent || !othersParent) return own;
  // Own data needs the "own" parent, everyone else's the "others" parent.
  const selfAllowed = (await can(db, organizationId, callerId, ownParent, 'see', callerId, ids)) && hasUser(own, callerId);
  const others = intersect(own, await scopedUserIds(db, organizationId, callerId, grantedScopes(ids, othersParent, 'see')));
  if (others !== 'all') {
    others.delete(callerId);
    if (selfAllowed) others.add(callerId);
    return others;
  }
  if (selfAllowed) return 'all';
  // Everyone but the caller: spell out the members.
  const rows = await db.execute(
    sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND status = 'active' AND user_id <> ${callerId}`,
  );
  return new Set(rows.rows.map((r: Record<string, unknown>) => r.user_id as string));
}

async function scopedUserIds(db: Executor, organizationId: string, callerId: string, scopes: Set<Scope>): Promise<'all' | Set<string>> {
  if (scopes.has('all')) return 'all';
  const out = new Set<string>();
  if (scopes.has('own')) out.add(callerId);
  if (scopes.has('reports')) for (const id of await directReportUserIds(db, organizationId, callerId)) out.add(id);
  if (scopes.has('team')) for (const id of await teammateUserIds(db, organizationId, callerId)) out.add(id);
  return out;
}

function hasUser(set: 'all' | Set<string>, userId: string): boolean {
  return set === 'all' || set.has(userId);
}

function intersect(a: 'all' | Set<string>, b: 'all' | Set<string>): 'all' | Set<string> {
  if (a === 'all') return b === 'all' ? 'all' : new Set(b);
  if (b === 'all') return new Set(a);
  return new Set([...a].filter((id) => b.has(id)));
}

// ---------------------------------------------------------------------------------------------
// People's data on a page (project time, absences, expenses, ...). Two rules combine:
// - the reporting line: everyone above a person (their manager, that manager's manager, ... up the
//   chain) always sees their data, whatever role they hold; only the direct manager also edits,
//   approves and reopens (approvals route there);
// - permissions: a `see` grant on the page's object reaching that person (e.g. admin `all`).

/** Self, anyone above the target in the reporting line, or a `see` grant on `object` covering the target. */
export async function canSeeUserData(db: Executor, organizationId: string, callerId: string, object: string, targetUserId: string): Promise<boolean> {
  if (targetUserId === callerId) return true;
  if (await isAboveInReportingLine(db, organizationId, callerId, targetUserId)) return true;
  return can(db, organizationId, callerId, object, 'see', targetUserId);
}

/**
 * Who may change a person's time records (work time, project time) and reopen their months:
 * the person themselves, their designated manager, or an `edit` grant on `object` beyond `own`
 * covering them (HR: `all`). Period locks are checked separately.
 */
export async function canEditUserData(db: Executor, organizationId: string, callerId: string, object: string, targetUserId: string): Promise<boolean> {
  if (targetUserId === callerId) return true;
  if (await isManagerOf(db, organizationId, callerId, targetUserId)) return true;
  return canEditBeyondOwn(db, organizationId, callerId, object, targetUserId);
}

/** Whose time records the caller may change (`canEditUserData` for a list): `'all'`, or self + direct reports + grants beyond own. */
export async function editableUserIds(db: Executor, organizationId: string, callerId: string, object: string): Promise<'all' | Set<string>> {
  const ids = await permissionIdsOf(db, organizationId, callerId);
  const beyond = new Set([...ids].filter((id) => id !== `${object}:edit:own`));
  const granted = await visibleUserIds(db, organizationId, callerId, object, 'edit', beyond);
  if (granted === 'all') return 'all';
  const out = new Set(granted);
  out.add(callerId);
  for (const id of await directReportUserIds(db, organizationId, callerId)) out.add(id);
  return out;
}

/** True when the caller's `action` grants on `object` reach everyone in the organization. */
export async function reachesAll(db: Executor, organizationId: string, callerId: string, object: string, action: Action = 'see'): Promise<boolean> {
  const ids = await permissionIdsOf(db, organizationId, callerId);
  return grantedScopes(ids, object, action).has('all');
}

/** Whose data a list shows when no person is asked for: everyone, or self + the whole reporting line below + whoever the grants cover. */
export async function listableUserIds(db: Executor, organizationId: string, callerId: string, object: string): Promise<'all' | string[]> {
  const granted = await visibleUserIds(db, organizationId, callerId, object, 'see');
  if (granted === 'all') return 'all';
  const ids = new Set(granted);
  ids.add(callerId);
  for (const id of await reportingLineUserIds(db, organizationId, callerId)) ids.add(id);
  return [...ids];
}

/**
 * An override on someone's data: an `edit` grant on `object` covering the target that goes
 * beyond `own` (e.g. admin `all`). Everyone's `own` grant is ignored, so a member does not
 * gain admin-only actions on their own records.
 */
export async function canEditBeyondOwn(db: Executor, organizationId: string, callerId: string, object: string, targetUserId: string): Promise<boolean> {
  const ids = await permissionIdsOf(db, organizationId, callerId);
  const beyond = new Set([...ids].filter((id) => id !== `${object}:edit:own`));
  return can(db, organizationId, callerId, object, 'edit', targetUserId, beyond);
}
