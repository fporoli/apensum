import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** A project month someone booked time in, with its status ('open' = not submitted) and to whom it was sent. */
export interface ProjectMonth { userId: string; projectId: string; month: string; status: string; approverUserId: string | null }

/**
 * The two timesheets' months for plugins (the plugin contract), instead of their tables: the working-time timesheet's
 * status per month, and the project months with time. Callers decide whom the caller may see first.
 */
@Injectable()
export class TimesheetsReadService {
  /** The working-time months of these people from `from` (the first of a month) on, up to `to` (exclusive) if given. */
  async workMonths(db: Db, orgId: string, q: { userIds: readonly string[]; from: string; to?: string }): Promise<{ userId: string; month: string; status: string }[]> {
    if (!q.userIds.length) return [];
    const rows = (await db.execute(sql`
      SELECT user_id, period_start::text AS month, status FROM timesheet_periods
      WHERE organization_id = ${orgId}::uuid AND user_id = ANY(${uuidArray(q.userIds)}::uuid[]) AND period_start >= ${q.from}::date
        ${q.to ? sql`AND period_start < ${q.to}::date` : sql``}
    `)).rows as { user_id: string; month: string; status: string }[];
    return rows.map((r) => ({ userId: r.user_id, month: r.month, status: r.status }));
  }

  /**
   * Every project month these people booked time in from `from` on (up to `to`, exclusive), with its status; a
   * submitted month names whom it was sent to (it stays with them when the project's owner changes).
   */
  async projectMonths(db: Db, orgId: string, q: { userIds: readonly string[]; from: string; to?: string }): Promise<ProjectMonth[]> {
    if (!q.userIds.length) return [];
    const rows = (await db.execute(sql`
      SELECT t.user_id, t.project_id, t.month::text AS month, COALESCE(p.status, 'open') AS status, approver.user_id AS approver_user_id
      FROM (SELECT DISTINCT user_id, project_id, date_trunc('month', start_time AT TIME ZONE 'Europe/Zurich')::date AS month
            FROM project_times
            WHERE organization_id = ${orgId}::uuid AND project_id IS NOT NULL AND user_id = ANY(${uuidArray(q.userIds)}::uuid[])
              AND start_time >= (${q.from}::date::timestamp AT TIME ZONE 'Europe/Zurich')
              ${q.to ? sql`AND start_time < (${q.to}::date::timestamp AT TIME ZONE 'Europe/Zurich')` : sql``}) t
      LEFT JOIN project_time_periods p ON p.organization_id = ${orgId}::uuid AND p.user_id = t.user_id AND p.project_id = t.project_id AND p.period_start = t.month
      LEFT JOIN LATERAL (
        SELECT w.assigned_to_user_id[1] AS user_id FROM workflows w
        WHERE w.source_table = 'project_time_periods' AND w.source_table_uuid = p.id AND w.step_status = 'pending'
        LIMIT 1) approver ON true
    `)).rows as { user_id: string; project_id: string; month: string; status: string; approver_user_id: string | null }[];
    return rows.map((r) => ({ userId: r.user_id, projectId: r.project_id, month: r.month, status: r.status, approverUserId: r.approver_user_id }));
  }
}
