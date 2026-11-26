import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  appBaseUrl, AuditService, callerUserId, can, DbService, NotificationsService, sendMail, VersionsService, type AuthenticatedRequest, type Db,
} from '@worktime3/api/plugin';
import { HourlyLimit, MAX_MAILS_PER_HOUR, mailLang, noteMail, parseAddresses } from './sharing';

/** Longest note, in characters. */
export const MAX_NOTE_CHARS = 2000;

/** A note's text as stored: trimmed, not empty, bounded; null when it is not one. */
export function cleanNoteText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_NOTE_CHARS ? text : null;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))] : []);
const uuidArray = (list: readonly string[]) => `{${list.join(',')}}`;
/** Per person and hour across the instance: forwarding by mail sends the text out of the app. */
const mailLimit = new HourlyLimit(MAX_MAILS_PER_HOUR);

/**
 * Notes: each person's own notes in an organization. The example of how a plugin's handler authorizes
 * itself like the core's (CLAUDE.md, "Every org-scoped handler authorizes itself"): the database or an
 * offline answer, the caller from the token (never from the body), then the permission (`nav.notes`, which
 * the module switch also takes away). Errors are returned, not thrown; every write is in `versions`. A note can be shared
 * with colleagues or a department (they read it, notified) and forwarded by e-mail.
 */
@Controller('organizations/:orgId/notes')
export class NotesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** The caller when they may `action` their own notes here, else null. */
  private async caller(db: Db, orgId: string, req: AuthenticatedRequest, action: 'see' | 'edit'): Promise<string | null> {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !UUID.test(orgId)) return null;
    return (await can(db, orgId, userId, 'nav.notes', action, userId)) ? userId : null;
  }

  /** The caller's notes, newest first, each with whom it is shared; and the notes others shared with the caller. */
  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, notes: [], shared: [] };
    const userId = await this.caller(db, orgId, req, 'see');
    if (!userId) return { ok: true, notes: [], shared: [] };
    const [own, shared] = await Promise.all([
      db.execute(sql`
        SELECT n.id, n.text, n.created_at::text AS created_at,
          COALESCE((SELECT json_agg(json_build_object('userId', u.id, 'name', COALESCE(u.display_name, u.email)) ORDER BY lower(COALESCE(u.display_name, u.email)))
            FROM users u WHERE u.id = ANY(n.shared_with)), '[]'::json) AS shared_with
        FROM notes.notes n
        WHERE n.organization_id = ${orgId}::uuid AND n.user_id = ${userId}::uuid
        ORDER BY n.created_at DESC LIMIT 500`),
      db.execute(sql`
        SELECT n.id, n.text, n.created_at::text AS created_at, COALESCE(u.display_name, u.email) AS author
        FROM notes.notes n JOIN users u ON u.id = n.user_id
        WHERE n.organization_id = ${orgId}::uuid AND n.shared_with @> ARRAY[${userId}::uuid]
        ORDER BY n.created_at DESC LIMIT 500`),
    ]);
    return { ok: true, notes: own.rows, shared: shared.rows };
  }

  /** The caller's own note, or null. */
  private async ownNote(db: Db, orgId: string, userId: string, id: string): Promise<{ id: string; text: string } | null> {
    if (!UUID.test(id)) return null;
    const rows = await db.execute(sql`SELECT id, text FROM notes.notes WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
    return (rows.rows[0] as { id: string; text: string } | undefined) ?? null;
  }

  /** The active members among `userIds`, and everyone of `departmentIds` (their assignment in force, and its leader) today. */
  private async recipients(db: Db, orgId: string, userIds: string[], departmentIds: string[]): Promise<string[]> {
    if (!userIds.length && !departmentIds.length) return [];
    const rows = await db.execute(sql`
      SELECT m.user_id FROM organization_memberships m
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > now())
        AND (m.user_id = ANY(${uuidArray(userIds)}::uuid[])
          OR m.user_id IN (SELECT d.leader_user_id FROM departments d WHERE d.organization_id = ${orgId}::uuid AND d.id = ANY(${uuidArray(departmentIds)}::uuid[]))
          OR EXISTS (SELECT 1 FROM employee_assignments a WHERE a.organization_id = m.organization_id AND a.user_id = m.user_id
                       AND a.department_id = ANY(${uuidArray(departmentIds)}::uuid[])
                       AND a.valid_from = (SELECT max(b.valid_from) FROM employee_assignments b
                                           WHERE b.organization_id = a.organization_id AND b.user_id = a.user_id AND b.valid_from <= CURRENT_DATE)))`);
    return (rows.rows as { user_id: string }[]).map((r) => r.user_id);
  }

  /** Gives a note to recipients who don't have it yet and tells them (in their language); returns how many were new. */
  private async give(db: Db, orgId: string, authorId: string, note: { id: string; text: string }, people: string[]): Promise<number> {
    const others = people.filter((id) => id !== authorId);
    if (!others.length) return 0;
    // In one statement: those not on the note yet are added, and only they are told.
    const [row] = (await db.execute(sql`
      WITH cur AS (SELECT shared_with FROM notes.notes WHERE id = ${note.id}::uuid FOR UPDATE),
           add AS (SELECT COALESCE(array_agg(u), '{}') AS ids FROM unnest(${uuidArray(others)}::uuid[]) AS u, cur WHERE NOT (u = ANY(cur.shared_with)))
      UPDATE notes.notes SET shared_with = shared_with || (SELECT ids FROM add)
      WHERE id = ${note.id}::uuid RETURNING (SELECT ids FROM add) AS added`)).rows as { added: string[] | null }[];
    const added = (row?.added ?? []).map((user_id) => ({ user_id }));
    if (!added.length) return 0;
    const [author] = (await db.execute(sql`SELECT COALESCE(display_name, email) AS name FROM users WHERE id = ${authorId}::uuid`)).rows as { name: string }[];
    void this.versions.record('notes.notes', note.id, 'update_delta', authorId, { shared_with_added: added.map((a) => a.user_id) }).catch(() => {});
    await this.notifications.notifyMany({
      organizationId: orgId, recipientUserIds: added.map((a) => a.user_id), type: 'notes.shared',
      title: `${author?.name ?? 'Someone'} shared a note with you`, body: note.text.slice(0, 200),
      text: { key: 'notes.notice.shared', vars: { who: author?.name ?? '' } },
      sourceTable: 'notes.notes', sourceTableUuid: note.id, data: { noteId: note.id },
    }).catch(() => {});
    return added.length;
  }

  /** Shares one's own note with colleagues and/or departments (`{userIds, departmentIds}`); they are notified. */
  @Post(':id/share')
  async share(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { userIds?: unknown; departmentIds?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'edit');
    if (!userId) return { ok: false, error: 'forbidden' };
    const note = await this.ownNote(db, orgId, userId, id);
    if (!note) return { ok: false, error: 'not-found' };
    const people = await this.recipients(db, orgId, ids(body?.userIds), ids(body?.departmentIds));
    if (!people.some((p) => p !== userId)) return { ok: false, error: 'no-recipients' };
    const added = await this.give(db, orgId, userId, note, people);
    const recordId = note.id;
    void this.audit.record(orgId, userId, 'notes.share', 'notes', recordId, { people: added }).catch(() => {});
    return { ok: true, added };
  }

  /** Takes a share back: the author from anyone, a recipient from themselves (`me`: hides it). */
  @Delete(':id/share/:userId')
  async unshare(@Param('orgId') orgId: string, @Param('id') id: string, @Param('userId') who: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'see');
    if (!userId) return { ok: false, error: 'forbidden' };
    const target = who === 'me' ? userId : who;
    if (!UUID.test(id) || !UUID.test(target)) return { ok: false, error: 'not-found' };
    if (target !== userId && !(await this.ownNote(db, orgId, userId, id))) return { ok: false, error: 'forbidden' };
    const removed = await db.execute(sql`UPDATE notes.notes SET shared_with = array_remove(shared_with, ${target}::uuid)
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND ${target}::uuid = ANY(shared_with) RETURNING id`);
    if (!removed.rows.length) return { ok: false, error: 'not-found' };
    void this.versions.record('notes.notes', id, 'update_delta', userId, { shared_with_removed: target }).catch(() => {});
    return { ok: true };
  }

  /**
   * Forwards one's own note by e-mail (`{addresses, message?}`, at most 10, any address): colleagues among them get it
   * shared too (so the link works for them, in their language); someone outside gets the text without a link. Reply-To
   * is the author. The audit log says that it was mailed and to how many, never to whom or what.
   */
  @Post(':id/mail')
  async mail(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { addresses?: unknown; message?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'edit');
    if (!userId) return { ok: false, error: 'forbidden' };
    const note = await this.ownNote(db, orgId, userId, id);
    if (!note) return { ok: false, error: 'not-found' };
    const parsed = parseAddresses(body?.addresses);
    if (!parsed.ok) return parsed;
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : '';
    if (!mailLimit.take(userId, parsed.addresses.length)) return { ok: false, error: 'mail-limit' };
    const [me] = (await db.execute(sql`SELECT COALESCE(display_name, email) AS name, email, locale FROM users WHERE id = ${userId}::uuid`)).rows as { name: string; email: string; locale: string | null }[];
    // Colleagues by their address: shared (notified), mailed in their language with the link.
    const members = (await db.execute(sql`
      SELECT u.id, lower(u.email) AS email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND lower(u.email) = ANY(${`{${parsed.addresses.join(',')}}`}::text[])`)).rows as { id: string; email: string; locale: string | null }[];
    await this.give(db, orgId, userId, note, members.map((m) => m.id));
    const link = `${appBaseUrl()}/#/notes?id=${note.id}`;
    let failed = 0;
    for (const address of parsed.addresses) {
      const member = members.find((m) => m.email === address);
      const mail = noteMail(mailLang(member?.locale ?? me.locale), { sender: me.name, senderEmail: me.email, text: note.text, message, link: member ? link : null });
      await sendMail({ to: address, subject: mail.subject, text: mail.text, replyTo: me.email }).catch(() => { failed++; });
    }
    const recordId = note.id;
    void this.audit.record(orgId, userId, 'notes.mail', 'notes', recordId, { addresses: parsed.addresses.length }).catch(() => {});
    if (failed === parsed.addresses.length) return { ok: false, error: 'mail-failed' };
    return { ok: true, sent: parsed.addresses.length - failed, failed };
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

  /** Changes the text of one of the caller's own notes (someone else's is "not found"); whom it is shared with see the new text. */
  @Put(':id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { text?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const userId = await this.caller(db, orgId, req, 'edit');
    if (!userId) return { ok: false, error: 'forbidden' };
    if (!UUID.test(id)) return { ok: false, error: 'not-found' };
    const text = cleanNoteText(body?.text);
    if (!text) return { ok: false, error: 'invalid-note' };
    const [note] = (await db.execute(sql`
      UPDATE notes.notes SET text = ${text} WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid
      RETURNING id, text, created_at::text AS created_at`)).rows as { id: string; text: string; created_at: string }[];
    if (!note) return { ok: false, error: 'not-found' };
    void this.versions.record('notes.notes', id, 'update_delta', userId, { text }).catch(() => {});
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
