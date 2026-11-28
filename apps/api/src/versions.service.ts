import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { clock } from './clock';

export type VersionAction = 'insert' | 'update' | 'update_delta' | 'delete';

/** How long entries wait to be written together, and how many at most go in one statement. */
const FLUSH_MS = 200;
const BATCH_MAX = 500;

interface Pending {
  sourceTable: string;
  sourceTableUuid: string;
  actorUserId: string | null;
  entry: { action: VersionAction; actioned_by_user_uuid: string | null; actioned_date: string; record: unknown };
  done: () => void;
  failed: (err: unknown) => void;
}

/**
 * The records of a batch, one row per record with its entries in order (renumbered from 1). Pure, for the tests.
 */
export function groupVersionEntries(batch: readonly Pick<Pending, 'sourceTable' | 'sourceTableUuid' | 'actorUserId' | 'entry'>[]) {
  const rows = new Map<string, { source_table: string; source_table_uuid: string; actor: string | null; entries: Record<string, unknown>[] }>();
  for (const p of batch) {
    const key = `${p.sourceTable}\u0000${p.sourceTableUuid}`;
    const row = rows.get(key) ?? { source_table: p.sourceTable, source_table_uuid: p.sourceTableUuid, actor: p.actorUserId, entries: [] };
    row.actor = p.actorUserId;
    row.entries.push({ version: row.entries.length + 1, ...p.entry });
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * Generic per-record history, replacing the created_at/updated_at columns dropped from every regular table. One row
 * per (sourceTable, sourceTableUuid); each write appends one entry to its history[] and bumps version_nr.
 * Entries are written together (every FLUSH_MS or BATCH_MAX entries) in one upsert: a record's entries of a batch
 * are appended in order, numbered on from its version_nr, so concurrent writers never take the same number. The
 * promise of `record` settles once its entry is written; whatever waits is written when the API stops.
 */
@Injectable()
export class VersionsService implements OnModuleDestroy {
  private readonly log = new Logger('VersionsService');
  private queue: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Batches are written one after the other, so a record's entries keep their order. */
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly db: DbService) {}

  /** The rows of a table whose history has an entry recording these values (e.g. `{ user_id, org_id }`), deleted ones too. */
  async idsRecording(db: Db, table: string, values: Record<string, string>): Promise<string[]> {
    const rows = await db.execute(sql`SELECT v.source_table_uuid AS id FROM versions v
      WHERE v.source_table = ${table} AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.history) e WHERE e->'record' @> ${JSON.stringify(values)}::jsonb)`);
    return (rows.rows as { id: string }[]).map((r) => r.id);
  }

  /** The recorded history of these rows of a table (by id), for a plugin showing its own records' history. */
  async histories(db: Db, table: string, ids: readonly string[]): Promise<Map<string, unknown[]>> {
    const ok = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ok.length) return new Map();
    const rows = await db.execute(sql`SELECT source_table_uuid AS id, history FROM versions
      WHERE source_table = ${table} AND source_table_uuid = ANY(${`{${ok.join(',')}}`}::uuid[])`);
    return new Map((rows.rows as { id: string; history: unknown }[]).map((r) => [r.id, Array.isArray(r.history) ? r.history : []]));
  }

  record(sourceTable: string, sourceTableUuid: string, action: VersionAction, actorUserId: string | null, record: unknown): Promise<void> {
    if (!this.db.getDb()) return Promise.resolve();
    return new Promise<void>((done, failed) => {
      this.queue.push({
        sourceTable, sourceTableUuid, actorUserId,
        entry: { action, actioned_by_user_uuid: actorUserId, actioned_date: clock.now().toISOString(), record: record ?? null },
        done, failed,
      });
      if (this.queue.length >= BATCH_MAX) this.flush();
      else this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    });
  }

  /** Writes what waits (in batches of BATCH_MAX); resolves once it is written. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue.splice(0);
    if (!batch.length) return this.writing;
    this.writing = this.writing.then(async () => {
      for (let i = 0; i < batch.length; i += BATCH_MAX) {
        const part = batch.slice(i, i + BATCH_MAX);
        try {
          await this.write(part);
          for (const p of part) p.done();
        } catch (err) {
          this.log.warn(`history not written (${part.length} entries): ${err instanceof Error ? err.message : err}`);
          for (const p of part) p.failed(err);
        }
      }
    });
    return this.writing;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private async write(part: Pending[]): Promise<void> {
    const db = this.db.getDb();
    if (!db) return;
    const rows = groupVersionEntries(part);
    const values = sql.join(
      rows.map((r) => sql`(${r.source_table}, ${r.source_table_uuid}::uuid, ${r.entries.length}, ${r.actor}::uuid, ${r.actor}::uuid, ${JSON.stringify(r.entries)}::jsonb)`),
      sql`, `,
    );
    // A new record gets its entries as they are; an existing one appends them, numbered on from its version_nr.
    await db.execute(sql`
      INSERT INTO versions (source_table, source_table_uuid, version_nr, created_by_user_id, lastmodified_by_user_id, history)
      VALUES ${values}
      ON CONFLICT (source_table, source_table_uuid) DO UPDATE SET
        version_nr = versions.version_nr + jsonb_array_length(EXCLUDED.history),
        lastmodified = now(), -- real time: the row's own bookkeeping (its entries carry the business time)
        lastmodified_by_user_id = EXCLUDED.lastmodified_by_user_id,
        history = versions.history || (
          SELECT jsonb_agg(e || jsonb_build_object('version', versions.version_nr + n) ORDER BY n)
          FROM jsonb_array_elements(EXCLUDED.history) WITH ORDINALITY AS t(e, n)
        )`);
  }
}
