/**
 * Demo data: closes last year (Time balances -> Year-end closing) for every active member of the demo
 * organization Acme except one (Uma), so the demo always has closed years to look at and one still open
 * to close. Runs after the seed (seed.sql approves every past month; closing them and the year needs the
 * balance logic, which SQL alone can't repeat): `npm run db:close-years` on dev and by
 * infra/vps/remote.sh in the API container after `seed` / `reset-seed`. Idempotent: closed years stay.
 *
 * Usage: node apps/api/dist/cli/close-demo-years.js [<year>]   (default: last year in Zurich)
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BalancesService } from '../balances.service';
import { WorkTimeModelService, localDate } from '../work-time-model.service';
import type { Db } from '../db.service';
import { clock } from '../clock';

const ACME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
/** Ulla, Acme's HR: recorded as the one who closed. */
const CLOSED_BY = '22222222-2222-2222-2222-222222222226';
/** Uma's year stays open, to close in the demo. */
const LEFT_OPEN = '22222222-2222-2222-2222-222222222228';

export async function closeDemoYears(db: Db, pool: Pool, year: number): Promise<{ closed: number; people: number }> {
  // Closing is not a user action here: no version history rows.
  const balances = new BalancesService(new WorkTimeModelService(), { record: async () => {} } as never);
  const members = await pool.query<{ user_id: string; start: string }>(
    `SELECT m.user_id, to_char(COALESCE(m.start_date, m.joined_at::date), 'YYYY-MM-DD') AS start
     FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = $1 AND m.status = 'active' AND u.status = 'active' AND m.user_id <> $2
     ORDER BY m.user_id`,
    [ACME, LEFT_OPEN],
  );
  let closed = 0;
  for (const m of members.rows) {
    // Years close in order: the open years before last year first.
    for (let y = Number(m.start.slice(0, 4)); y <= year; y++) {
      const result = await balances.closeYear(db, ACME, m.user_id, y, CLOSED_BY, false);
      if (result.ok) closed++;
      else if (result.error !== 'year-closed' && result.error !== 'not-employed') {
        console.warn(`close-demo-years: ${m.user_id} ${y}: ${result.error}${result.months ? ` (${result.months.join(', ')})` : ''}`);
        break;
      }
    }
  }
  return { closed, people: members.rows.length };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('close-demo-years: DATABASE_URL is not set');
    process.exit(1);
  }
  const year = Number(process.argv[2] ?? Number(localDate(clock.now(), 'Europe/Zurich').slice(0, 4)) - 1);
  const pool = new Pool({ connectionString: url });
  try {
    const exists = await pool.query('SELECT 1 FROM organizations WHERE id = $1', [ACME]);
    if (!exists.rowCount) {
      console.log('close-demo-years: no demo organization, nothing to do');
      return;
    }
    const { closed, people } = await closeDemoYears(drizzle(pool) as unknown as Db, pool, year);
    console.log(`close-demo-years: closed ${closed} years up to ${year} for ${people} people (Uma left open)`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
