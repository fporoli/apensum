import { Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DbService, callerUserId, isOrgMember, Public, type AuthenticatedRequest, MAX_DOCUMENT_BYTES } from '@worktime3/api/plugin';
import { ReceiptHandoffService } from './receipt-handoff.service';

/**
 * Receipt photo from the phone (ReceiptHandoffService): the signed-in PC creates a hand-off, shows
 * it as a QR code and polls; the phone (public, the token is its credential) sends one file; the PC
 * takes it into the expense form, which uploads it through `expenses/:id/document` as usual.
 */
@Controller()
export class ReceiptHandoffController {
  constructor(private readonly db: DbService, private readonly handoffs: ReceiptHandoffService) {}

  @Post('organizations/:orgId/receipt-handoffs')
  async create(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    return { ok: true, ...this.handoffs.create(userId, orgId) };
  }

  @Get('receipt-handoffs/:token')
  async status(@Param('token') token: string, @Req() req: AuthenticatedRequest) {
    const userId = await this.caller(req);
    if (!userId) return { ok: false, error: 'unknown-user' };
    return { ok: true, ...this.handoffs.ownerStatus(token, userId) };
  }

  @Get('receipt-handoffs/:token/file')
  async take(@Param('token') token: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const userId = await this.caller(req);
    const file = userId ? this.handoffs.take(token, userId) : null;
    if (!file) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.buffer.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store',
    });
    res.end(file.buffer);
  }

  @Delete('receipt-handoffs/:token')
  async cancel(@Param('token') token: string, @Req() req: AuthenticatedRequest) {
    const userId = await this.caller(req);
    if (userId) this.handoffs.cancel(token, userId);
    return { ok: true };
  }

  /** The phone's page asks whether the code still works. */
  @Public()
  @Get('receipt-handoffs/:token/phone')
  phoneStatus(@Param('token') token: string) {
    return { ok: true, status: this.handoffs.phoneStatus(token) };
  }

  @Public()
  @Post('receipt-handoffs/:token/phone')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  deposit(@Param('token') token: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) return { ok: false, error: 'file-required' };
    return this.handoffs.deposit(token, { name: file.originalname, mimeType: file.mimetype, buffer: file.buffer });
  }

  private async caller(req: AuthenticatedRequest): Promise<string | null> {
    const db = this.db.getDb();
    return db && req.user ? await callerUserId(db, req.user) : null;
  }
}
