import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

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
}
