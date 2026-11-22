import { Body, Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, isOrgMember, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { NotificationsService } from './notifications.service';
import { MAX_FRAME_BYTES, ScreenShareService, isJpeg } from './screen-share.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notifications, in the recipient's language. */
const NOTICE: Record<string, { shows: string; asks: string }> = {
  en: { shows: '{name} is showing you their screen: open to watch', asks: '{name} asks you to show them your screen' },
  de: { shows: '{name} zeigt Ihnen den Bildschirm: zum Ansehen öffnen', asks: '{name} bittet Sie, den Bildschirm zu zeigen' },
  fr: { shows: '{name} vous montre son écran : ouvrez pour le voir', asks: '{name} vous demande de montrer votre écran' },
  it: { shows: '{name} le mostra il suo schermo: apra per vederlo', asks: '{name} le chiede di mostrare il suo schermo' },
};

/**
 * Show my screen (screen-share.service.ts): nobody needs a right to show their own screen to a
 * colleague, and nobody can start it for someone else. Admin and HR may ask; the answer is the share.
 */
@Controller('organizations/:orgId')
export class ScreenShareController {
  constructor(
    private readonly db: DbService,
    private readonly shares: ScreenShareService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async member(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const id = req.user ? await callerUserId(db, req.user) : null;
    return id && ID.test(orgId) && (await isOrgMember(db, orgId, id)) ? id : null;
  }

  private async notify(db: Db, orgId: string, kind: 'shows' | 'asks', fromId: string, toId: string, sourceId: string): Promise<void> {
    const rows = await db.execute(
      sql`SELECT f.display_name AS name, t.locale FROM users f, users t WHERE f.id = ${fromId} AND t.id = ${toId}`,
    );
    const row = rows.rows[0] as { name?: string; locale?: string } | undefined;
    const texts = NOTICE[String(row?.locale ?? '').slice(0, 2)] ?? NOTICE.en;
    await this.notifications.notifyMany({
      organizationId: orgId,
      recipientUserIds: [toId],
      type: kind === 'shows' ? 'screen-share.started' : 'screen-share.asked',
      title: texts[kind].replace('{name}', () => row?.name ?? ''),
      sourceTable: kind === 'shows' ? 'screen_shares' : 'screen_share_asks',
      sourceTableUuid: sourceId,
    });
  }

  @Post('screen-shares')
  async start(@Param('orgId') orgId: string, @Body() body: { viewerId?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.member(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const viewerId = typeof body?.viewerId === 'string' && ID.test(body.viewerId) ? body.viewerId : null;
    if (!viewerId || viewerId === callerId || !(await isOrgMember(db, orgId, viewerId))) return { ok: false, error: 'unknown-user' };
    const share = this.shares.start(orgId, callerId, viewerId);
    void this.audit.record(orgId, callerId, 'screen-share.start', 'user', viewerId, {}).catch(() => {});
    await this.notify(db, orgId, 'shows', callerId, viewerId, share.id).catch(() => {});
    return { ok: true, id: share.id, until: new Date(share.until).toISOString() };
  }

  @Post('screen-shares/:id/frame')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FRAME_BYTES, files: 1 } }))
  async frame(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.member(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    if (!file?.buffer || !isJpeg(file.buffer)) return { ok: false, error: 'invalid-frame' };
    const put = this.shares.put(orgId, id, callerId, file.buffer);
    return put ? { ok: true, watching: put.watching } : { ok: false, error: 'share-ended' };
  }

  /** The latest picture: 204 before the first one, 404 once it is over (or for anybody else). */
  @Get('screen-shares/:id/frame')
  async look(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db ? await this.member(db, orgId, req) : null;
    const look = callerId ? this.shares.look(orgId, id, callerId) : null;
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (!look) {
      res.status(404).json({ ok: false, error: 'share-ended' });
    } else if (!look.frame) {
      res.status(204).end();
    } else {
      res.set('Content-Type', 'image/jpeg');
      res.send(look.frame);
    }
  }

  @Delete('screen-shares/:id')
  async stop(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    const share = callerId ? this.shares.stop(orgId, id, callerId) : null;
    if (share) void this.audit.record(orgId, callerId, 'screen-share.stop', 'user', share.viewerId, {}).catch(() => {});
    return { ok: true };
  }

  @Post('screen-share-asks')
  async ask(@Param('orgId') orgId: string, @Body() body: { userId?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.member(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    // Admin (the members) and HR (the employment).
    const allowed =
      (await reachesAll(db, orgId, callerId, 'nav.users', 'edit')) ||
      (await reachesAll(db, orgId, callerId, 'section.people.employment', 'edit'));
    if (!allowed) return { ok: false, error: 'forbidden' };
    const userId = typeof body?.userId === 'string' && ID.test(body.userId) ? body.userId : null;
    if (!userId || userId === callerId || !(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'unknown-user' };
    if (!this.shares.mayAsk(orgId, callerId, userId)) return { ok: false, error: 'asked-already' };
    void this.audit.record(orgId, callerId, 'screen-share.ask', 'user', userId, {}).catch(() => {});
    await this.notify(db, orgId, 'asks', callerId, userId, callerId).catch(() => {});
    return { ok: true };
  }
}
