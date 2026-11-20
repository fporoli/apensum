import { Body, Controller, Delete, Get, Param, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService } from './db.service';
import { DocumentsService } from './documents.service';
import { VersionsService } from './versions.service';
import { callerUserId, isOrgMember } from './access';
import { Public, type AuthenticatedRequest } from './jwt.guard';
import { publicApiRoot } from './news-newsletter';
import { users } from './db/schema';
import { AVATAR_DOC_PREFIX, AVATAR_SOURCE, MAX_AVATAR_BYTES, avatarDocumentId, avatarImageType, avatarUrlFor } from './avatars';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Profile pictures (avatars.ts). Everyone changes only their own. The picture is served without login
 * (an <img> cannot send the token) under its random document id, and only while it is someone's
 * current picture; the Directory shows it to the whole organization anyway.
 */
@Controller()
export class AvatarsController {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly versions: VersionsService,
  ) {}

  /** The caller's picture as the browser loads it (null = initials). */
  @Get('users/me/avatar')
  async mine(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, avatarUrl: null };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated', avatarUrl: null };
    const [row] = await db.select({ avatar_url: users.avatar_url }).from(users).where(eq(users.id, callerId));
    return { ok: true, avatarUrl: avatarUrlFor(row?.avatar_url, publicApiRoot(req)) };
  }

  /**
   * Replaces the caller's picture with an uploaded PNG, JPEG or WebP (the browser crops and shrinks it first).
   * It is stored in the organization the caller uploads from (`orgId`, a membership is required).
   */
  @Put('users/me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  async upload(@Req() req: AuthenticatedRequest, @Body('orgId') orgId: string | undefined, @UploadedFile() file?: Express.Multer.File) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!orgId || !ID.test(orgId) || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (!file || file.size === 0) return { ok: false, error: 'avatar-missing' };
    const type = avatarImageType(file.buffer);
    if (!type) return { ok: false, error: 'avatar-format' };

    const documentId = await this.documents.store(db, orgId, callerId, { name: `avatar.${type.extension}`, mimeType: type.mime, buffer: file.buffer }, { table: AVATAR_SOURCE, id: callerId });
    const previous = await this.replace(db, callerId, `${AVATAR_DOC_PREFIX}${documentId}`);
    void this.versions.record('users', callerId, 'update_delta', callerId, { avatar_url: `${AVATAR_DOC_PREFIX}${documentId}` }).catch(() => {});
    if (previous) await this.documents.remove(db, previous).catch(() => {});
    return { ok: true, avatarUrl: avatarUrlFor(`${AVATAR_DOC_PREFIX}${documentId}`, publicApiRoot(req)) };
  }

  /** Removes the caller's picture (back to initials). */
  @Delete('users/me/avatar')
  async remove(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const previous = await this.replace(db, callerId, null);
    void this.versions.record('users', callerId, 'update_delta', callerId, { avatar_url: null }).catch(() => {});
    if (previous) await this.documents.remove(db, previous).catch(() => {});
    return { ok: true, avatarUrl: null };
  }

  /** Someone's current uploaded picture; 404 once it was replaced or removed. */
  @Public()
  @Get('public/avatars/:documentId')
  async picture(@Param('documentId') documentId: string, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const current =
      db && ID.test(documentId)
        ? await db.execute(sql`SELECT 1 FROM users WHERE avatar_url = ${AVATAR_DOC_PREFIX + documentId.toLowerCase()} LIMIT 1`)
        : null;
    const doc = db && current && current.rows.length > 0 ? await this.documents.get(db, documentId) : undefined;
    if (!doc || doc.source_table !== AVATAR_SOURCE) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    // A new picture gets a new id, so this one never changes; the web app may be on another host.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    await this.documents.send(res, doc, { publicCache: 'public, max-age=31536000, immutable' });
  }

  /** Sets the caller's avatar_url and returns the document id of the uploaded picture it replaced. */
  private async replace(db: NonNullable<ReturnType<DbService['getDb']>>, userId: string, value: string | null): Promise<string | null> {
    const [before] = await db.select({ avatar_url: users.avatar_url }).from(users).where(eq(users.id, userId));
    await db.update(users).set({ avatar_url: value }).where(eq(users.id, userId));
    return avatarDocumentId(before?.avatar_url);
  }
}
