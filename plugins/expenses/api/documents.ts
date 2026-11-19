import { sql } from 'drizzle-orm';
import type { PersonalDocumentSource } from '@worktime3/api/plugin';

/** A person's receipts on their Documents page (category `expense`, described by web/index.tsx). */
export const expenseReceipts: PersonalDocumentSource = async (db, orgId, userId) => {
  const result = await db.execute(sql`
    SELECT d.id, e.id::text AS source_id, d.file_name, d.mime_type, d.size_bytes, to_char(e.expense_date, 'YYYY-MM-DD') AS date,
           to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS added_at,
           jsonb_build_object('category', e.category, 'value', e.value, 'currency', e.currency, 'comment', e.comment) AS context
    FROM expenses e JOIN documents d ON d.id = e.document_id
    WHERE e.organization_id = ${orgId} AND e.user_id = ${userId}`);
  return (result.rows as Record<string, unknown>[]).map((r) => ({
    documentId: r.id as string,
    category: 'expense',
    sourceId: r.source_id as string,
    fileName: r.file_name as string,
    mimeType: r.mime_type as string,
    sizeBytes: Number(r.size_bytes),
    date: r.date as string,
    addedAt: r.added_at as string,
    superseded: false,
    context: (r.context as Record<string, string | number | null>) ?? {},
  }));
};
