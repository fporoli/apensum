import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${[...new Set(ids)].filter((id) => UUID.test(id)).join(',')}}`;

/** An entry of a person's personnel file (its document's date, else the day it was added). */
export interface PersonnelEntry { date: string; title: string; category: string; shared: boolean }

/** What a plugin files in a personnel file: a stored document (DocumentsService.store, source personnel_documents). */
export interface PersonnelFiling {
  id: string; userId: string; documentId: string; title: string; category: string;
  documentDate: string; effectiveDate: string | null; followUpDate: string | null;
  visibleToEmployee: boolean; visibleToManager: boolean; requireAck: boolean;
}

/**
 * The personnel files (Employees -> personnel file) for plugins (the plugin contract), instead of their table. Callers
 * decide whom the caller may see first (`section.people.documents`).
 */
@Injectable()
export class PersonnelFilesService {
  /** The follow-up dates HR set on documents of these people (null = everyone), per person. */
  async followUps(db: Db, orgId: string, userIds: readonly string[] | null): Promise<Map<string, { date: string; title: string }[]>> {
    if (userIds && !userIds.length) return new Map();
    const only = userIds ? sql`AND user_id = ANY(${uuidArray(userIds)}::uuid[])` : sql``;
    const rows = (await db.execute(sql`
      SELECT user_id, follow_up_date::text AS date, title
      FROM personnel_documents WHERE organization_id = ${orgId}::uuid AND follow_up_date IS NOT NULL ${only}
    `)).rows as { user_id: string; date: string; title: string }[];
    const out = new Map<string, { date: string; title: string }[]>();
    for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { date: r.date, title: r.title }]);
    return out;
  }

  /** A person's entries: all, or only those shared with them. */
  async entries(db: Db, orgId: string, userId: string, opts: { sharedOnly: boolean }): Promise<PersonnelEntry[]> {
    if (!UUID.test(userId)) return [];
    const rows = (await db.execute(sql`
      SELECT to_char(COALESCE(p.document_date, d.created_at::date), 'YYYY-MM-DD') AS date, p.title, p.category, p.visible_to_employee
      FROM personnel_documents p JOIN documents d ON d.id = p.document_id
      WHERE p.organization_id = ${orgId}::uuid AND p.user_id = ${userId}::uuid ${opts.sharedOnly ? sql`AND p.visible_to_employee` : sql``}
    `)).rows as { date: string; title: string; category: string; visible_to_employee: boolean }[];
    return rows.map((d) => ({ date: d.date, title: d.title, category: d.category, shared: d.visible_to_employee }));
  }

  /** Files a stored document in a member's personnel file (the caller authorized it). */
  async file(db: Db, orgId: string, actorId: string, f: PersonnelFiling): Promise<void> {
    await db.execute(sql`INSERT INTO personnel_documents (id, organization_id, user_id, document_id, title, category, document_date, effective_date, follow_up_date,
        visible_to_employee, visible_to_manager, require_ack, uploaded_by_user_id)
      VALUES (${f.id}::uuid, ${orgId}::uuid, ${f.userId}::uuid, ${f.documentId}::uuid, ${f.title}, ${f.category}, ${f.documentDate}::date, ${f.effectiveDate}::date,
        ${f.followUpDate}::date, ${f.visibleToEmployee}, ${f.visibleToManager}, ${f.requireAck}, ${actorId}::uuid)`);
  }
}
