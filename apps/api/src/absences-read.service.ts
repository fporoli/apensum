import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** An approved absence as plugins read it. */
export interface ApprovedAbsence { userId: string; dateStart: string; dateEnd: string; halfDay: boolean | null }

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
}
