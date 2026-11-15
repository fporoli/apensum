/**
 * Issues the current year's missing timesheet PDFs and monthly project reports for every active
 * member (TimesheetDocumentsService.issueMissing), e.g. after loading the demo seed, whose approved
 * months have none. Reads DATABASE_URL (and DOCUMENTS_DIR) from the environment like the other db:*
 * scripts; the files go where the API reads them, so run it on the machine the API runs on (dev).
 * Elsewhere the Documents page issues them when a person first opens it.
 *
 * Usage (from the repo root): npm run db:documents [-- <year>]
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DocumentsService } from '../src/documents.service';
import { TimesheetDocumentsService } from '../src/timesheet-documents.service';
import { WorkTimeModelService } from '../src/work-time-model.service';
import type { Db } from '../src/db.service';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('db:documents: DATABASE_URL is not set');
    process.exit(1);
  }
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool) as unknown as Db;
  // Issuing is not a user action: no version history rows.
  const service = new TimesheetDocumentsService(new DocumentsService(), new WorkTimeModelService(), { record: async () => {} } as never);
  try {
    const members = await pool.query<{ organization_id: string; user_id: string }>(
      `SELECT organization_id, user_id FROM organization_memberships WHERE status = 'active' ORDER BY organization_id, user_id`,
    );
    const before = Number((await pool.query('SELECT count(*) AS n FROM timesheet_documents WHERE superseded_at IS NULL')).rows[0].n);
    for (const m of members.rows) await service.issueMissing(db, m.organization_id, m.user_id, year);
    const after = Number((await pool.query('SELECT count(*) AS n FROM timesheet_documents WHERE superseded_at IS NULL')).rows[0].n);
    console.log(`db:documents: issued ${after - before} PDFs for ${year} (${members.rows.length} memberships)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
