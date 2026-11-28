import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** A member in a period, with the department of their assignment then and their teams (Projects & Teams). */
export interface StaffMember { userId: string; name: string; departmentId: string | null; teamIds: string[] }

/**
 * The organization's structure for plugins (the plugin contract), instead of its tables: departments, teams, and who
 * works there in a period (with department and teams). Callers decide whom the caller may see first.
 */
@Injectable()
export class StructureService {
  /** The departments by name, or in the organization's own order (`sortOrder`). */
  async departments(db: Db, orgId: string, opts: { activeOnly?: boolean; sortOrder?: boolean } = {}): Promise<{ id: string; name: string; leaderUserId: string | null }[]> {
    const active = opts.activeOnly ? sql`AND is_active` : sql``;
    const order = opts.sortOrder ? sql`sort_order, name` : sql`lower(name)`;
    const rows = await db.execute(sql`SELECT id, name, leader_user_id FROM departments WHERE organization_id = ${orgId}::uuid ${active} ORDER BY ${order}`);
    return (rows.rows as { id: string; name: string; leader_user_id: string | null }[]).map((d) => ({ id: d.id, name: d.name, leaderUserId: d.leader_user_id }));
  }

  async isDepartment(db: Db, orgId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    return (await db.execute(sql`SELECT 1 FROM departments WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid`)).rows.length > 0;
  }

  /** These teams of the organization (id, name). */
  async teams(db: Db, orgId: string, ids: readonly string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const rows = await db.execute(sql`SELECT id, name FROM teams WHERE organization_id = ${orgId}::uuid AND id = ANY(${uuidArray(ids)}::uuid[]) ORDER BY lower(name)`);
    return rows.rows as { id: string; name: string }[];
  }

  /**
   * The active members working in [first, last] (started by `last`, not exited before `first`), all or these only,
   * by name: each with the department of their assignment as of `last` and the teams they are in or lead.
   */
  async staff(db: Db, orgId: string, q: { first: string; last: string; userIds: readonly string[] | 'all' }): Promise<StaffMember[]> {
    if (q.userIds !== 'all' && !q.userIds.length) return [];
    const only = q.userIds === 'all' ? sql`` : sql`AND m.user_id = ANY(${uuidArray(q.userIds)}::uuid[])`;
    const rows = await db.execute(sql`
      SELECT m.user_id, COALESCE(u.display_name, u.email) AS name,
        (SELECT a.department_id FROM employee_assignments a
          WHERE a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.valid_from <= ${q.last}::date
          ORDER BY a.valid_from DESC LIMIT 1) AS department_id,
        (SELECT array_agg(DISTINCT t.id) FROM teams t
          WHERE t.organization_id = m.organization_id
            AND (t.lead_user_id = m.user_id OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.membership_id = m.id))) AS team_ids
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active'
        AND (m.start_date IS NULL OR m.start_date <= ${q.last}::date)
        AND (m.exit_at IS NULL OR m.exit_at > ${q.first}::date)
        ${only}
      ORDER BY lower(COALESCE(u.display_name, u.email))`);
    return (rows.rows as { user_id: string; name: string; department_id: string | null; team_ids: string[] | null }[])
      .map((r) => ({ userId: r.user_id, name: r.name, departmentId: r.department_id, teamIds: r.team_ids ?? [] }));
  }

  /** Which of these ids are the organization's departments. */
  async existingDepartments(db: Db, orgId: string, ids: readonly string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await db.execute(sql`SELECT id FROM departments WHERE organization_id = ${orgId}::uuid AND id = ANY(${uuidArray(ids)}::uuid[])`);
    return new Set((rows.rows as { id: string }[]).map((r) => r.id));
  }

  /** A department's leader and their language (null: none or not the organization's). */
  async leaderOf(db: Db, orgId: string, departmentId: string): Promise<{ userId: string | null; locale: string | null } | null> {
    if (!UUID.test(departmentId)) return null;
    const [row] = (await db.execute(sql`SELECT d.leader_user_id, u.locale FROM departments d LEFT JOIN users u ON u.id = d.leader_user_id
      WHERE d.id = ${departmentId}::uuid AND d.organization_id = ${orgId}::uuid`)).rows as { leader_user_id: string | null; locale: string | null }[];
    return row ? { userId: row.leader_user_id, locale: row.locale } : null;
  }

  /** The department (name) of each person's assignment as of a date (per person: `dates`), from the core's assignments. */
  async departmentNamesAt(db: Db, orgId: string, at: readonly { userId: string; date: string }[]): Promise<Map<string, string | null>> {
    if (!at.length) return new Map();
    const rows = await db.execute(sql`
      SELECT q.user_id, q.date, (SELECT d.name FROM employee_assignments a JOIN departments d ON d.id = a.department_id
        WHERE a.organization_id = ${orgId}::uuid AND a.user_id = q.user_id AND a.valid_from <= q.date
        ORDER BY a.valid_from DESC LIMIT 1) AS department
      FROM jsonb_to_recordset(${JSON.stringify(at.map((x) => ({ user_id: x.userId, date: x.date })))}::jsonb) AS q(user_id uuid, date date)`);
    return new Map((rows.rows as { user_id: string; date: string; department: string | null }[]).map((r) => [`${r.user_id}|${String(r.date).slice(0, 10)}`, r.department]));
  }

  /** Whether the person's assignment as of a date is a management one. */
  async isManagement(db: Db, orgId: string, userId: string, date: string): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    const [row] = (await db.execute(sql`SELECT a.is_management FROM employee_assignments a
      WHERE a.organization_id = ${orgId}::uuid AND a.user_id = ${userId}::uuid AND a.valid_from <= ${date}::date
      ORDER BY a.valid_from DESC LIMIT 1`)).rows as { is_management: boolean }[];
    return row?.is_management ?? false;
  }
}
