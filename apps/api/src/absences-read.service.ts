import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** An approved absence as plugins read it. */
export interface ApprovedAbsence { userId: string; dateStart: string; dateEnd: string; halfDay: boolean | null }

/** An absence with its type and status, and its length in calendar days. */
export interface AbsenceRecord { id: string; userId: string; type: string; from: string; to: string; halfDay: boolean; status: string; days: number }

/**
 * Absences for plugins (the plugin contract), instead of their table: the approved absences of these people that
 * touch a period. Callers decide whose absences the caller may see first.
 */
@Injectable()
export class AbsencesReadService {
  async approved(db: Db, orgId: string, q: { userIds: readonly string[]; from: string; to: string }): Promise<ApprovedAbsence[]> {
    if (!q.userIds.length) return [];
    const rows = await db.execute(sql`SELECT user_id, date_start::text AS date_start, date_end::text AS date_end, half_day FROM absences
      WHERE organization_id = ${orgId}::uuid AND status = 'approved' AND user_id = ANY(${uuidArray(q.userIds)}::uuid[])
        AND date_end >= ${q.from}::date AND date_start <= ${q.to}::date`);
    return (rows.rows as { user_id: string; date_start: string; date_end: string; half_day: boolean | null }[])
      .map((r) => ({ userId: r.user_id, dateStart: r.date_start, dateEnd: r.date_end, halfDay: r.half_day }));
  }

  /**
   * These people's absences with these statuses (and types, if given), those ending on `endFrom` or later and touching
   * `overlap` if given; ordered by their start, at most `limit`.
   */
  async list(db: Db, orgId: string, q: {
    userIds: readonly string[]; statuses: readonly string[]; types?: readonly string[]; endFrom?: string; overlap?: { from: string; to: string }; limit?: number;
  }): Promise<AbsenceRecord[]> {
    if (!q.userIds.length || !q.statuses.length) return [];
    const word = (v: string) => /^[a-z_]+$/.test(v);
    const rows = await db.execute(sql`
      SELECT id, user_id, absence_type, date_start::text AS date_start, date_end::text AS date_end, half_day, status, (date_end - date_start + 1) AS days
      FROM absences
      WHERE organization_id = ${orgId}::uuid AND user_id = ANY(${uuidArray(q.userIds)}::uuid[])
        AND status::text = ANY(${`{${q.statuses.filter(word).join(',')}}`}::text[])
        ${q.types ? sql`AND absence_type::text = ANY(${`{${q.types.filter(word).join(',')}}`}::text[])` : sql``}
        ${q.endFrom ? sql`AND date_end >= ${q.endFrom}::date` : sql``}
        ${q.overlap ? sql`AND date_start <= ${q.overlap.to}::date AND date_end >= ${q.overlap.from}::date` : sql``}
      ORDER BY date_start ${q.limit ? sql`LIMIT ${q.limit}` : sql``}`);
    return (rows.rows as { id: string; user_id: string; absence_type: string; date_start: string; date_end: string; half_day: boolean | null; status: string; days: number }[])
      .map((r) => ({ id: r.id, userId: r.user_id, type: r.absence_type, from: r.date_start, to: r.date_end, halfDay: r.half_day === true, status: r.status, days: Number(r.days) }));
  }
}
