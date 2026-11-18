import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DbService } from './db.service';
import { callerUserId, isOrgMember } from './access';
import { Public, type AuthenticatedRequest } from './jwt.guard';
import { CalendarFeedService, type CalendarFeedScope } from './calendar-feed.service';

function resolveApiBaseUrl(req: Request): string {
  if (process.env.PUBLIC_API_URL) {
    return process.env.PUBLIC_API_URL.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:8001';
  return `${proto}://${host}/api/v1`;
}

@Controller()
export class CalendarFeedController {
  constructor(
    private readonly db: DbService,
    private readonly calendarFeedService: CalendarFeedService,
  ) {}

  /** Retrieves the caller's absence calendar feed configuration and permitted scopes. */
  @Get('organizations/:orgId/calendar-feed')
  async getFeed(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest & { raw?: Request }) {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const baseUrl = resolveApiBaseUrl(req as unknown as Request);
    const result = await this.calendarFeedService.getFeedConfig(db, orgId, callerId, baseUrl);
    return { ok: true, ...result };
  }

  /** Creates, updates, or regenerates the caller's calendar feed. */
  @Post('organizations/:orgId/calendar-feed')
  async updateFeed(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      enabled?: boolean;
      scope?: CalendarFeedScope;
      includeHolidays?: boolean;
      regenerate?: boolean;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const baseUrl = resolveApiBaseUrl(req as unknown as Request);
    return this.calendarFeedService.updateFeedConfig(db, orgId, callerId, body, baseUrl);
  }

  /** Deactivates or removes the caller's calendar feed. */
  @Delete('organizations/:orgId/calendar-feed')
  async deleteFeed(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: false, error: 'offline' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    await this.calendarFeedService.deleteFeedConfig(db, orgId, callerId);
    return { ok: true };
  }

  /**
   * Public calendar feed endpoint for external clients (Outlook, Google Calendar, Apple Calendar).
   * Unauthenticated; uses the secret capability token in the URL.
   */
  @Public()
  @Get('calendar/absences/:token')
  async serveFeed(@Param('token') rawToken: string, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    if (!db) {
      res.status(503).set('Content-Type', 'text/plain; charset=utf-8').send('Service temporarily offline.');
      return;
    }

    const token = rawToken.replace(/\.ics$/i, '').trim();
    const result = await this.calendarFeedService.generateIcsForToken(db, token);

    if (!result) {
      res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Calendar feed not found or disabled.');
      return;
    }

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${result.filename}"`,
      'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    res.send(result.ics);
  }
}
