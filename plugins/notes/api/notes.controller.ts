import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { callerUserId, can, DbService, VersionsService, type AuthenticatedRequest, type Db } from '@worktime3/api/plugin';

/** Longest note, in characters. */
export const MAX_NOTE_CHARS = 2000;

/** A note's text as stored: trimmed, not empty, bounded; null when it is not one. */
export function cleanNoteText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_NOTE_CHARS ? text : null;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Notes: each person's own notes in an organization. The example of how a plugin's handler authorizes
 * itself like the core's (CLAUDE.md, "Every org-scoped handler authorizes itself"): the database or an
 * offline answer, the caller from the token (never from the body), then the permission (`nav.notes`, which
 * the module switch also takes away). Errors are returned, not thrown; every write is in `versions`.
 */
@Controller('organizations/:orgId/notes')
export class NotesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  /** The caller when they may `action` their own notes here, else null. */
  private async caller(db: Db, orgId: string, req: AuthenticatedRequest, action: 'see' | 'edit'): Promise<string | null> {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !UUID.test(orgId)) return null;
    return (await can(db, orgId, userId, 'nav.notes', action, userId)) ? userId : null;
  }

  /** The caller's notes, newest first. */
  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, notes: [] };
    const userId = await this.caller(db, orgId, req, 'see');
    if (!userId) return { ok: true, notes: [] };
    const rows = await db.execute(sql`
      SELECT id, text, created_at::text AS created_at FROM notes.notes
      WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid
      ORDER BY created_at DESC LIMIT 500`);
    return { ok: true, notes: rows.rows };
  }

  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: { text?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'edit');
    if (!userId) return { ok: false, error: 'forbidden' };
    const text = cleanNoteText(body?.text);
    if (!text) return { ok: false, error: 'invalid-note' };
    const [note] = (await db.execute(sql`
      INSERT INTO notes.notes (organization_id, user_id, text) VALUES (${orgId}::uuid, ${userId}::uuid, ${text})
      RETURNING id, text, created_at::text AS created_at`)).rows as { id: string; text: string; created_at: string }[];
    void this.versions.record('notes.notes', note.id, 'insert', userId, { text }).catch(() => {});
    return { ok: true, note };
  }

  /** Deletes one of the caller's own notes (someone else's is "not found"). */
  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'edit');
    if (!userId) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const deleted = await db.execute(sql`
      DELETE FROM notes.notes WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid
      RETURNING id`);
    if (!deleted.rows.length) return { ok: false, error: 'not-found' };
    void this.versions.record('notes.notes', id, 'delete', userId, {}).catch(() => {});
    return { ok: true };
  }
}
