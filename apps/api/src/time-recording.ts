import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

// Who records no working time: the work schedule in force says it (`time_recording = 'none'`, 095).

/** Whether the person records no working time on the day `instant` falls on in their time zone. */
export async function isTimeNotRecorded(db: Db, orgId: string, userId: string, instant: Date | string): Promise<boolean> {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return false;
  const result = await db.execute(sql`
    SELECT w.time_recording FROM work_schedules w JOIN users u ON u.id = w.user_id
    WHERE w.organization_id = ${orgId} AND w.user_id = ${userId}
      AND w.valid_from <= (${at.toISOString()}::timestamptz AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date
    ORDER BY w.valid_from DESC LIMIT 1`);
  return (result.rows[0] as { time_recording?: string } | undefined)?.time_recording === 'none';
}

/**
 * Those of `userIds` who record no working time on any day of [from, toExclusive) they are employed on:
 * they have no working-time timesheet for it. Someone who changes within it still has one.
 */
export async function notRecordingUserIds(db: Db, orgId: string, userIds: readonly string[], from: string, toExclusive: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const result = await db.execute(sql`
    WITH span AS (
      SELECT m.user_id,
             GREATEST(${from}::date, COALESCE(m.start_date, ${from}::date)) AS first_day,
             LEAST(${toExclusive}::date, COALESCE((m.exit_at AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date, ${toExclusive}::date)) AS end_day
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId} AND m.user_id = ANY(${`{${userIds.join(',')}}`}::uuid[])
    )
    SELECT s.user_id AS not_recording FROM span s
    WHERE (SELECT w.time_recording FROM work_schedules w
           WHERE w.organization_id = ${orgId} AND w.user_id = s.user_id AND w.valid_from <= s.first_day
           ORDER BY w.valid_from DESC LIMIT 1) = 'none'
      AND NOT EXISTS (SELECT 1 FROM work_schedules w
                      WHERE w.organization_id = ${orgId} AND w.user_id = s.user_id AND w.time_recording <> 'none'
                        AND w.valid_from > s.first_day AND w.valid_from < s.end_day)`);
  return new Set((result.rows as { not_recording?: string }[]).flatMap((r) => (r.not_recording ? [r.not_recording] : [])));
}
