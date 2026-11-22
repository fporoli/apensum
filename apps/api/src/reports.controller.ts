import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { ReportsService } from './reports.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { departments, projects, teams } from './db/schema';
import { renderReportPdf, sanitizeReportPdf } from './report-pdf';

export { absenceRows, attendanceRows } from './reports.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Reports page (nav.reports, module `reports`; packages/shared/src/reports.ts). The reports
 * themselves run in reports.service.ts with the caller's rights.
 */
@Controller('organizations/:orgId/reports')
export class ReportsController {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * The table on screen as a PDF (A4, landscape when it is wide). The browser sends the rows it
   * shows, already labelled and formatted in the person's language, so the PDF matches the screen
   * and the Excel file; the API only lays it out. Nothing is stored.
   */
  @Post('pdf')
  async pdf(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const db = this.db.getDb();
    if (!db) return res.json({ ok: true, offline: true });
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(orgId) || !(await isOrgMember(db, orgId, callerId)) || !(await can(db, orgId, callerId, 'nav.reports', 'see'))) {
      return res.json({ ok: false, error: 'forbidden' });
    }
    const table = sanitizeReportPdf(body);
    if (!table) return res.json({ ok: false, error: 'invalid-table' });
    const pdf = await renderReportPdf(table);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(pdf);
  }

  /** What the filters offer: the people the report may cover, the departments, the teams and (project hours) the projects. */
  @Get(':reportId/options')
  async options(@Param('orgId') orgId: string, @Param('reportId') reportId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [], departments: [], teams: [], projects: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    const scope = await this.reports.scope(db, orgId, callerId, reportId);
    if ('error' in scope) return { ok: false, error: scope.error, people: [], departments: [], teams: [], projects: [] };
    const depts = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.organization_id, orgId), eq(departments.is_active, true)))
      .orderBy(asc(departments.sort_order), asc(departments.name));
    const teamList = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.organization_id, orgId)).orderBy(asc(teams.name));
    const projs = scope.def.projectFilter
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.organization_id, orgId)).orderBy(asc(projects.name))
      : [];
    return { ok: true, people: scope.people, departments: depts, teams: teamList, projects: projs };
  }

  /** The report for whole months `from`..`to` (yyyy-mm), grouped as asked; raw rows never leave. */
  @Get(':reportId')
  async run(
    @Param('orgId') orgId: string,
    @Param('reportId') reportId: string,
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('userId') userId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('projectId') projectId?: string,
    @Query('teamId') teamId?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, groupBy: [], rows: [], totals: {} };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    return this.reports.run(db, orgId, callerId, reportId, { from, to, groupBy, userId, departmentId, teamId, projectId });
  }
}
