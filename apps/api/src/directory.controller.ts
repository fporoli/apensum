import { Controller, Get, Param, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, can, isOrgMember } from './access';
import { avatarUrlFor } from './avatars';
import { publicApiRoot } from './news-newsletter';
import type { AuthenticatedRequest } from './jwt.guard';

export interface DirectoryEntry {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  /** Basic data `phone1`. It is the person's own number and becomes visible to the whole organization. */
  phone: string | null;
  position: string | null;
  department: string | null;
  departmentId: string | null;
  /** The location (work place) of the assignment in force, e.g. "Büro Zürich". */
  location: string | null;
  /** The open check-in, if the person is checked in right now. */
  checkedInSince: string | null;
  /** Presence like a chat app: checked in, absent today (an approved absence, never its type), or neither. */
  status: 'checkedIn' | 'absent' | 'notCheckedIn' | 'notRecorded';
  /** Last day of today's approved absence (status absent). */
  absentUntil: string | null;
  /** Whom the person reports to: the manager of their assignment in force. */
  managerId: string | null;
  managerName: string | null;
}

/**
 * Employee directory (nav.directory, everyone by default): the organization's active members with
 * picture, contact details, position, department and manager of the assignment in force, whether they
 * are checked in right now, and whether they are absent today (an approved absence, without its type:
 * whether it is sickness is nobody's business here). Nothing else from basic data or time records
 * leaves this endpoint.
 */
@Controller('organizations/:orgId/directory')
export class DirectoryController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId)) || !(await can(db, orgId, callerId, 'nav.directory', 'see'))) {
      return { ok: false, error: 'forbidden', people: [] };
    }
    const result = await db.execute(sql`
      SELECT u.id, coalesce(nullif(u.display_name, ''), u.email) AS name, u.first_name, u.last_name, u.email, u.avatar_url,
             nullif(coalesce(u.basicdata -> 'orgs' -> ${orgId} ->> 'phone1', u.basicdata ->> 'phone1'), '') AS phone,
             a.job_function, d.id AS department_id, d.name AS department, loc.name AS location,
             a.manager_user_id, coalesce(nullif(mu.display_name, ''), mu.email) AS manager_name,
             to_char(w.check_in AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS checked_in_since,
             ab.date_end::text AS absent_until,
             rec.time_recording
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN (
        SELECT DISTINCT ON (user_id) user_id, department_id, job_function, manager_user_id, location_id FROM employee_assignments
        WHERE organization_id = ${orgId} AND valid_from <= CURRENT_DATE
        ORDER BY user_id, valid_from DESC
      ) a ON a.user_id = m.user_id
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN locations loc ON loc.id = a.location_id
      LEFT JOIN users mu ON mu.id = a.manager_user_id
      LEFT JOIN LATERAL (
        SELECT check_in FROM work_times
        WHERE organization_id = ${orgId} AND user_id = m.user_id AND check_out IS NULL
        ORDER BY check_in DESC LIMIT 1
      ) w ON TRUE
      LEFT JOIN LATERAL (
        SELECT max(date_end) AS date_end FROM absences
        WHERE organization_id = ${orgId} AND user_id = m.user_id AND status = 'approved'
          AND date_start <= (now() AT TIME ZONE 'Europe/Zurich')::date AND date_end >= (now() AT TIME ZONE 'Europe/Zurich')::date
      ) ab ON TRUE
      LEFT JOIN LATERAL (
        SELECT time_recording FROM work_schedules
        WHERE organization_id = ${orgId} AND user_id = m.user_id AND valid_from <= (now() AT TIME ZONE 'Europe/Zurich')::date
        ORDER BY valid_from DESC LIMIT 1
      ) rec ON TRUE
      WHERE m.organization_id = ${orgId} AND m.status = 'active' AND u.is_active
        AND (m.exit_at IS NULL OR m.exit_at > now())
      ORDER BY lower(coalesce(u.last_name, u.display_name, u.email)), lower(coalesce(u.first_name, ''))`);
    const apiRoot = publicApiRoot(req);
    const people: DirectoryEntry[] = (result.rows as Record<string, unknown>[]).map((r) => ({
      userId: r.id as string,
      name: r.name as string,
      firstName: (r.first_name as string | null) ?? null,
      lastName: (r.last_name as string | null) ?? null,
      email: r.email as string,
      avatarUrl: avatarUrlFor(r.avatar_url as string | null, apiRoot),
      phone: (r.phone as string | null) ?? null,
      position: (r.job_function as string | null) ?? null,
      department: (r.department as string | null) ?? null,
      departmentId: (r.department_id as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      checkedInSince: (r.checked_in_since as string | null) ?? null,
      status: r.checked_in_since ? 'checkedIn' : r.absent_until ? 'absent' : r.time_recording === 'none' ? 'notRecorded' : 'notCheckedIn',
      absentUntil: (r.absent_until as string | null) ?? null,
      managerId: (r.manager_user_id as string | null) ?? null,
      managerName: (r.manager_name as string | null) ?? null,
    }));
    return { ok: true, people };
  }
}
