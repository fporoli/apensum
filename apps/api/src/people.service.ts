import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { sqlNow, sqlToday } from './clock';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/**
 * People for plugins (the plugin contract): their names and whether they belong to an organization, read through the
 * core instead of its tables (docs/PLUGINS.md). One query per call, whatever the number of people.
 */
@Injectable()
export class PeopleService {
  /** Display names (else e-mail) of these people who are members of the organization. */
  async names(db: Db, orgId: string, userIds: readonly string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const rows = await db.execute(sql`SELECT u.id, COALESCE(u.display_name, u.email) AS name FROM users u
      JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ${orgId}::uuid
      WHERE u.id = ANY(${uuidArray(userIds)}::uuid[])`);
    return new Map((rows.rows as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  }

  /** Which of these people are members of the organization (any status). */
  async members(db: Db, orgId: string, userIds: readonly string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await db.execute(sql`SELECT user_id FROM organization_memberships
      WHERE organization_id = ${orgId}::uuid AND user_id = ANY(${uuidArray(userIds)}::uuid[])`);
    return new Set((rows.rows as { user_id: string }[]).map((r) => r.user_id));
  }

  /** Name, e-mail and language of these people who are members of the organization. */
  async profiles(db: Db, orgId: string, userIds: readonly string[]): Promise<Map<string, { name: string; email: string; locale: string | null }>> {
    if (!userIds.length) return new Map();
    const rows = await db.execute(sql`SELECT u.id, COALESCE(u.display_name, u.email) AS name, u.email, u.locale FROM users u
      JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ${orgId}::uuid
      WHERE u.id = ANY(${uuidArray(userIds)}::uuid[])`);
    return new Map((rows.rows as { id: string; name: string; email: string; locale: string | null }[]).map((r) => [r.id, { name: r.name, email: r.email, locale: r.locale }]));
  }

  /** The organization's active members with these e-mail addresses (case aside): id, address (lower case), language. */
  async activeByEmail(db: Db, orgId: string, emails: readonly string[]): Promise<{ id: string; email: string; locale: string | null }[]> {
    const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@,{}"]+@[^\s@,{}"]+$/.test(e)))];
    if (!list.length) return [];
    const rows = await db.execute(sql`SELECT u.id, lower(u.email) AS email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND lower(u.email) = ANY(${`{${list.join(',')}}`}::text[])`);
    return rows.rows as { id: string; email: string; locale: string | null }[];
  }

  /**
   * The active members (not exited) among these people, and of these departments: their leaders and whoever belongs to
   * them today (their current assignment).
   */
  async activePeople(db: Db, orgId: string, q: { userIds: readonly string[]; departmentIds: readonly string[] }): Promise<string[]> {
    if (!q.userIds.length && !q.departmentIds.length) return [];
    const depts = uuidArray(q.departmentIds);
    const rows = await db.execute(sql`
      SELECT m.user_id FROM organization_memberships m
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
        AND (m.user_id = ANY(${uuidArray(q.userIds)}::uuid[])
          OR m.user_id IN (SELECT d.leader_user_id FROM departments d WHERE d.organization_id = ${orgId}::uuid AND d.id = ANY(${depts}::uuid[]))
          OR EXISTS (SELECT 1 FROM employee_assignments a WHERE a.organization_id = m.organization_id AND a.user_id = m.user_id
                       AND a.department_id = ANY(${depts}::uuid[])
                       AND a.valid_from = (SELECT max(b.valid_from) FROM employee_assignments b
                                           WHERE b.organization_id = a.organization_id AND b.user_id = a.user_id AND b.valid_from <= ${sqlToday()})))`);
    return (rows.rows as { user_id: string }[]).map((r) => r.user_id);
  }

  /** The organization's active members (their language too): e.g. to tell those who hold a right. */
  async activeMembers(db: Db, orgId: string): Promise<{ id: string; locale: string | null }[]> {
    const rows = await db.execute(sql`SELECT m.user_id AS id, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active'`);
    return rows.rows as { id: string; locale: string | null }[];
  }

  /** Whether the person is an active member of the organization. */
  async isActiveMember(db: Db, orgId: string, userId: string): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    return (await db.execute(sql`SELECT 1 FROM organization_memberships WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND status = 'active'`)).rows.length > 0;
  }

  /**
   * The organization's active members (all, or these), by name: name, start date, last working day (the day before
   * their exit, in their time zone) and language.
   */
  async memberDetails(db: Db, orgId: string, userIds?: readonly string[]): Promise<{ userId: string; name: string; startDate: string | null; lastDay: string | null; locale: string | null }[]> {
    if (userIds && !userIds.length) return [];
    const only = userIds ? sql`AND m.user_id = ANY(${uuidArray(userIds)}::uuid[])` : sql``;
    const rows = await db.execute(sql`
      SELECT m.user_id, u.display_name AS name, m.start_date::text AS start_date, u.locale,
        ((m.exit_at AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'Europe/Zurich')) - interval '1 microsecond')::date::text AS last_day
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' ${only}
      ORDER BY u.display_name`);
    return (rows.rows as { user_id: string; name: string; start_date: string | null; last_day: string | null; locale: string | null }[])
      .map((r) => ({ userId: r.user_id, name: r.name, startDate: r.start_date, lastDay: r.last_day, locale: r.locale }));
  }
}
