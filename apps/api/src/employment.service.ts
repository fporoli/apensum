import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { sqlToday } from './clock';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** A member's employment: start (else the day they joined), the end of probation HR set, the last working day. */
export interface Employment {
  userId: string;
  name: string;
  start: string;
  startMissing: boolean;
  probationUntil: string | null;
  exit: string | null;
}

/** An assignment (Employees -> assignment) from its day on, with the names of department, manager and location. */
export interface AssignmentRecord { date: string; department: string | null; jobFunction: string | null; manager: string | null; location: string | null }

/** A work permit of My Data (users.basicdata). */
export interface PermitRecord { userId: string; nationality: string | null; permitType: string | null; validUntil: string | null }

/**
 * People's employment for plugins (the plugin contract), instead of the core's tables: start, probation and exit,
 * assignments and managers, workloads, work permits. Callers decide whom the caller may see first.
 */
@Injectable()
export class EmploymentService {
  /** The organization's active members (all, or these) with a start, by name. */
  async employments(db: Db, orgId: string, userIds: readonly string[] | null): Promise<Employment[]> {
    if (userIds && !userIds.length) return [];
    const only = userIds ? sql`AND m.user_id = ANY(${uuidArray(userIds)}::uuid[])` : sql``;
    const rows = (await db.execute(sql`
      SELECT m.user_id, u.display_name,
             COALESCE(m.start_date, (m.joined_at AT TIME ZONE 'Europe/Zurich')::date)::text AS start_date,
             (m.start_date IS NULL) AS start_missing,
             m.probation_until::text AS probation_until,
             ((m.exit_at AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC')) - interval '1 microsecond')::date::text AS exit_date
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.is_active AND m.status = 'active' ${only}
      ORDER BY u.display_name
    `)).rows as { user_id: string; display_name: string; start_date: string | null; start_missing: boolean; probation_until: string | null; exit_date: string | null }[];
    return rows
      .filter((r) => r.start_date)
      .map((r) => ({ userId: r.user_id, name: r.display_name, start: r.start_date as string, startMissing: r.start_missing === true, probationUntil: r.probation_until ?? null, exit: r.exit_date }));
  }

  /** A person's assignments (in no particular order). */
  async assignments(db: Db, orgId: string, userId: string): Promise<AssignmentRecord[]> {
    if (!UUID.test(userId)) return [];
    const rows = (await db.execute(sql`
      SELECT a.valid_from::text AS date, d.name AS department, a.job_function, m.display_name AS manager, l.name AS location
      FROM employee_assignments a
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users m ON m.id = a.manager_user_id
      LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.organization_id = ${orgId}::uuid AND a.user_id = ${userId}::uuid
    `)).rows as { date: string; department: string | null; job_function: string | null; manager: string | null; location: string | null }[];
    return rows.map((a) => ({ date: a.date, department: a.department, jobFunction: a.job_function, manager: a.manager, location: a.location }));
  }

  /** A person's assignment in force today (none: all null). */
  async currentAssignment(db: Db, orgId: string, userId: string): Promise<Omit<AssignmentRecord, 'date'>> {
    const rows = UUID.test(userId) ? (await db.execute(sql`
      SELECT d.name AS department, a.job_function, m.display_name AS manager, l.name AS location
      FROM employee_assignments a
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users m ON m.id = a.manager_user_id
      LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.organization_id = ${orgId}::uuid AND a.user_id = ${userId}::uuid AND a.valid_from <= ${sqlToday()}
      ORDER BY a.valid_from DESC LIMIT 1
    `)).rows as { department: string | null; job_function: string | null; manager: string | null; location: string | null }[] : [];
    const r = rows[0];
    return { department: r?.department ?? null, jobFunction: r?.job_function ?? null, manager: r?.manager ?? null, location: r?.location ?? null };
  }

  /** The managers in force today of these people (by user id; someone without one is missing). */
  async managers(db: Db, orgId: string, userIds: readonly string[]): Promise<Map<string, { userId: string; name: string }>> {
    if (!userIds.length) return new Map();
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (a.user_id) a.user_id, a.manager_user_id, u.display_name AS manager_name
      FROM employee_assignments a LEFT JOIN users u ON u.id = a.manager_user_id
      WHERE a.organization_id = ${orgId}::uuid AND a.user_id = ANY(${uuidArray(userIds)}::uuid[]) AND a.valid_from <= ${sqlToday()}
      ORDER BY a.user_id, a.valid_from DESC`)).rows as { user_id: string; manager_user_id: string | null; manager_name: string | null }[];
    return new Map(rows.filter((r) => r.manager_user_id).map((r) => [r.user_id, { userId: r.manager_user_id as string, name: r.manager_name ?? '' }]));
  }

  /** A person's workloads (work schedules) from their day on. */
  async workloads(db: Db, orgId: string, userId: string): Promise<{ date: string; workload: number }[]> {
    if (!UUID.test(userId)) return [];
    const rows = (await db.execute(sql`
      SELECT valid_from::text AS date, workload_percent FROM work_schedules
      WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid
    `)).rows as { date: string; workload_percent: string | number }[];
    return rows.map((s) => ({ date: s.date, workload: Number(s.workload_percent) }));
  }

  /** The work permits of the organization's members (all, or these) who have one in My Data, and of `also` in any case. */
  async permits(db: Db, orgId: string, userIds: readonly string[] | null, also: readonly string[] = []): Promise<PermitRecord[]> {
    if (userIds && !userIds.length) return [];
    const only = userIds ? sql`AND m.user_id = ANY(${uuidArray(userIds)}::uuid[])` : sql``;
    const rows = (await db.execute(sql`
      SELECT m.user_id, u.basicdata->>'nationality' AS nationality, u.basicdata->>'residencePermitCode' AS permit_type,
        CASE WHEN u.basicdata->>'residencePermitValidUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN u.basicdata->>'residencePermitValidUntil' END AS valid_until
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid ${only}
        AND (COALESCE(u.basicdata->>'residencePermitCode', '') <> '' OR m.user_id = ANY(${uuidArray(also)}::uuid[]))
    `)).rows as { user_id: string; nationality: string | null; permit_type: string | null; valid_until: string | null }[];
    return rows.map((r) => ({ userId: r.user_id, nationality: r.nationality, permitType: r.permit_type, validUntil: r.valid_until }));
  }
}
