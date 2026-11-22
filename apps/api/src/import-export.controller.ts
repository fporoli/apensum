import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from './db.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { ImportExportService, payrollItems, type RawEmployeeImportRow } from './import-export.service';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@Controller('organizations/:orgId')
export class ImportExportController {
  constructor(
    private readonly db: DbService,
    private readonly importExport: ImportExportService,
  ) {}

  private async canAccess(db: any, orgId: string, req: AuthenticatedRequest, action: 'see' | 'edit' = 'see'): Promise<{ ok: boolean; callerId?: string; error?: string }> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    // Its own permission alone: seeing everyone (nav.users) is not exporting everyone.
    const allowed = await can(db, orgId, callerId, 'nav.importExport', action);

    if (!allowed) return { ok: false, error: 'forbidden' };
    return { ok: true, callerId };
  }

  /**
   * JSON endpoint providing aggregated monthly payroll rows.
   */
  @Get('export/payroll')
  async getPayroll(@Param('orgId') orgId: string, @Query('month') month: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, rows: [] };
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return { ok: false, error: auth.error };

    const selectedMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const rows = await this.importExport.getPayrollData(db, orgId, selectedMonth);
    // The plugins' columns (e.g. expenses): each row has their amounts under `items`.
    const items = payrollItems().map((i) => ({ key: i.key, caption: i.caption }));
    return { ok: true, month: selectedMonth, rows, items };
  }

  /**
   * Generates and downloads an Abacus-compatible CSV file.
   */
  @Get('export/payroll/abacus')
  async downloadAbacus(
    @Param('orgId') orgId: string,
    @Query('month') month: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const db = this.db.getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'offline' });
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const selectedMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const rows = await this.importExport.getPayrollData(db, orgId, selectedMonth);
    const csv = this.importExport.formatAbacusCsv(selectedMonth, rows);

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll_abacus_${selectedMonth}.csv"`,
    });
    return res.send(csv);
  }

  /**
   * Generates and downloads a Bexio-compatible CSV file.
   */
  @Get('export/payroll/bexio')
  async downloadBexio(
    @Param('orgId') orgId: string,
    @Query('month') month: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const db = this.db.getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'offline' });
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const selectedMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const rows = await this.importExport.getPayrollData(db, orgId, selectedMonth);
    const csv = this.importExport.formatBexioCsv(selectedMonth, rows);

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll_bexio_${selectedMonth}.csv"`,
    });
    return res.send(csv);
  }

  /**
   * Generates and downloads a generic CSV summary.
   */
  @Get('export/payroll/csv')
  async downloadCsv(
    @Param('orgId') orgId: string,
    @Query('month') month: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const db = this.db.getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'offline' });
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const selectedMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const rows = await this.importExport.getPayrollData(db, orgId, selectedMonth);
    const csv = this.importExport.formatGenericCsv(selectedMonth, rows);

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll_summary_${selectedMonth}.csv"`,
    });
    return res.send(csv);
  }

  /**
   * Generates and downloads an Excel (.xlsx) workbook.
   */
  @Get('export/payroll/xlsx')
  async downloadXlsx(
    @Param('orgId') orgId: string,
    @Query('month') month: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const db = this.db.getDb();
    if (!db) return res.status(503).json({ ok: false, error: 'offline' });
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const selectedMonth = month && MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
    const rows = await this.importExport.getPayrollData(db, orgId, selectedMonth);
    const xlsxBuffer = this.importExport.formatGenericXlsx(selectedMonth, rows);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="payroll_${selectedMonth}.xlsx"`,
    });
    return res.send(Buffer.from(xlsxBuffer));
  }

  /**
   * Dry-run validation of employee bulk import data.
   */
  @Post('import/employees/preview')
  async previewEmployees(
    @Param('orgId') orgId: string,
    @Body() body: { rows: RawEmployeeImportRow[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, summary: { total: 0, newCount: 0, updateCount: 0, errorCount: 0 }, results: [] };
    const auth = await this.canAccess(db, orgId, req, 'see');
    if (!auth.ok) return { ok: false, error: auth.error };

    const rawRows = Array.isArray(body?.rows) ? body.rows : [];
    const preview = await this.importExport.previewEmployeeImport(db, orgId, rawRows);
    return { ok: true, ...preview };
  }

  /**
   * Executes the employee bulk import inside a database transaction.
   */
  @Post('import/employees/commit')
  async commitEmployees(
    @Param('orgId') orgId: string,
    @Body() body: { rows: RawEmployeeImportRow[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, created: 0, updated: 0 };
    const auth = await this.canAccess(db, orgId, req, 'edit');
    if (!auth.ok || !auth.callerId) return { ok: false, error: auth.error };

    const rawRows = Array.isArray(body?.rows) ? body.rows : [];
    return this.importExport.commitEmployeeImport(db, orgId, auth.callerId, rawRows);
  }
}
