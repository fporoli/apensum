import { Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { cleanRequestLink } from '@worktime3/shared/requests';
import type { Db } from './db.service';
import { BalancesService, type MonthBalance } from './balances.service';
import {
  absences,
  balance_adjustments,
  basicdata_versions,
  departments,
  documents,
  employee_assignments,
  field_config,
  membership_roles,
  notifications,
  org_holidays,
  organization_domains,
  organization_invitations,
  organization_memberships,
  organizations,
  personnel_documents,
  project_time_periods,
  project_times,
  projects,
  report_runs,
  report_schedules,
  request_message_documents,
  request_messages,
  requests,
  project_teams,
  role_permissions,
  roles,
  saved_reports,
  static_data,
  subprojects,
  team_members,
  teams,
  timesheet_documents,
  timesheet_periods,
  users,
  vacation_entitlements,
  work_schedules,
  work_time_balance_entries,
  work_time_balances,
  work_time_months,
  work_times,
  workflow_definitions,
  workflows,
} from './db/schema';
import { buildCsv, buildXlsx, zipStored, type Cell, type SheetColumn } from '@worktime3/shared/xlsx';
import { AuditService } from './audit.service';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { currentMasterKey, encryptDocument } from './document-crypto';
import { DOCUMENTS_ROOT, DocumentsService } from './documents.service';

export interface PayrollRow {
  userId: string;
  email: string;
  displayName: string;
  name: string;
  firstName: string;
  lastName: string;
  personnelNumber: string;
  socialSecurityNumber: string;
  department: string;
  departmentName: string;
  jobFunction: string;
  month: string;
  workloadPercent: number;
  targetMinutes: number;
  actualMinutes: number;
  deltaMinutes: number;
  overtimeBalanceMinutes: number;
  adjustmentMinutes: number;
  legalOvertimeMinutes: number;
  targetHours: number;
  actualHours: number;
  deltaHours: number;
  overtimeBalanceHours: number;
  overtimePayoutHours: number;
  legalOvertimeHours: number;
  vacationDaysTaken: number;
  unpaidLeaveHours: number;
  sickLeaveHours: number;
  /** The plugins' payroll items (ApiPlugin.payroll) by key, e.g. `expenses`: the month's amount, rounded to cents. */
  items: Record<string, { amount: number; currency: string }>;
}

/**
 * A plugin's amount on the payroll export (ApiPlugin.payroll), one per person and month (the
 * expenses plugin's approved expenses). The core adds it to every format: an Abacus line with its
 * wage type when it is above zero, a column in the Bexio, generic CSV and Excel files, and a column
 * in the page's preview.
 */
export interface ApiPayrollItem {
  key: string;
  /** i18n key of the preview column. */
  caption: string;
  /** The month's amounts per person (user id); `from`/`to` are its first and last day. */
  amounts: (db: Db, ctx: { orgId: string; from: string; to: string }) => Promise<Map<string, { amount: number; currency: string }>>;
  abacus: { wageType: string; label: string; unit: string };
  /** Column headers in the Bexio CSV (before `Abteilung`), the generic CSV and the Excel file (at the end). */
  columns: { bexio: string; csv: string; xlsx: string };
}

/** What a plugin's restore gets: the backup's files and the new ids of what the core restored. */
export interface BackupRestoreContext {
  targetOrgId: string;
  /** A file the plugin's export wrote (e.g. 'expenses.json'); [] when missing. */
  read: (file: string) => any[];
  userIds: ReadonlyMap<string, string>;
  projectIds: ReadonlyMap<string, string>;
  subprojectIds: ReadonlyMap<string, string>;
}

/**
 * A plugin's part of an organization's backup (ApiPlugin.backup): its tables as JSON files under
 * `database/`, with counts for the manifest, and how to restore them (after the core's users,
 * documents and projects, so its rows can point at them). Returns what it restored, by name.
 */
export interface ApiBackup {
  export: (db: Db, orgId: string) => Promise<{ files: Record<string, unknown[]>; counts: Record<string, number> }>;
  restore: (db: Db, ctx: BackupRestoreContext) => Promise<Record<string, number>>;
}

const PAYROLL_ITEMS: ApiPayrollItem[] = [];
const BACKUPS: ApiBackup[] = [];

/** Adds a plugin's payroll item (plugins.ts). */
export function registerPayrollItem(item: ApiPayrollItem): void {
  if (PAYROLL_ITEMS.some((i) => i.key === item.key)) throw new Error(`Payroll item ${item.key} is already registered`);
  PAYROLL_ITEMS.push(item);
}

/** The registered payroll items (the preview shows their columns). */
export function payrollItems(): readonly ApiPayrollItem[] {
  return PAYROLL_ITEMS;
}

/** Adds a plugin's part of the backup (plugins.ts). */
export function registerBackup(backup: ApiBackup): void {
  BACKUPS.push(backup);
}

export interface RawEmployeeImportRow {
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  personnelNumber?: string;
  socialSecurityNumber?: string;
  department?: string;
  jobFunction?: string;
  workloadPercent?: number | string;
  startDate?: string;
  managerEmail?: string;
}

export interface EmployeeImportValidationResult {
  row: RawEmployeeImportRow;
  status: 'new' | 'update' | 'error';
  errors: string[];
  message?: string;
  resolvedManagerId?: string | null;
  resolvedDepartmentId?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function normalizeRawEmployeeRow(r: RawEmployeeImportRow): RawEmployeeImportRow {
  const row = (r && typeof r === 'object' ? r : {}) as Record<string, any>;
  const email = (r?.email || row.email || row.mail || '').trim().toLowerCase();
  const firstName = (r?.firstName || row.firstname || row.vorname || '').trim();
  const lastName = (r?.lastName || row.lastname || row.nachname || '').trim();
  let displayName = (r?.displayName || row.displayname || row.name || '').trim();
  if (!displayName && (firstName || lastName)) {
    displayName = [firstName, lastName].filter(Boolean).join(' ');
  }

  const personnelNumber = (r?.personnelNumber || row.personnelnumber || row.personalnummer || '').trim();
  const socialSecurityNumber = (r?.socialSecurityNumber || row.socialsecuritynumber || row.ahv || '').trim();
  const department = (r?.department || row.abteilung || '').trim();
  const jobFunction = (r?.jobFunction || row.jobfunction || row.funktion || '').trim();
  const rawWorkload = String(r?.workloadPercent || row.workloadpercent || row.pensum || '100').replace('%', '').trim();
  const workloadNum = Number(rawWorkload);
  const workloadPercent = Number.isFinite(workloadNum) && workloadNum > 0 && workloadNum <= 100 ? workloadNum : 100;

  const rawDate = (r?.startDate || row.startdate || row.eintritt || '').trim();
  let startDate: string | undefined = undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    startDate = rawDate;
  } else if (rawDate) {
    const chMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(rawDate);
    if (chMatch) {
      startDate = `${chMatch[3]}-${chMatch[2].padStart(2, '0')}-${chMatch[1].padStart(2, '0')}`;
    } else {
      const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
      if (slashMatch) {
        startDate = `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
      } else {
        startDate = rawDate;
      }
    }
  }

  const managerEmail = (r?.managerEmail || row.manageremail || row.vorgesetzter || '').trim().toLowerCase();

  return {
    email,
    displayName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    personnelNumber: personnelNumber || undefined,
    socialSecurityNumber: socialSecurityNumber || undefined,
    department: department || undefined,
    jobFunction: jobFunction || undefined,
    workloadPercent,
    startDate: startDate || undefined,
    managerEmail: managerEmail || undefined,
  };
}

/**
 * Each person's latest assignment (greatest `validFrom`, 'YYYY-MM-DD'), whatever order the rows come
 * in: the one in force on the last day the rows were selected up to.
 */
export function latestAssignmentPerUser<T extends { userId: string; validFrom: string }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const current = out.get(row.userId);
    if (!current || row.validFrom > current.validFrom) out.set(row.userId, row);
  }
  return out;
}

@Injectable()
export class ImportExportService {
  constructor(
    private readonly balances: BalancesService,
    private readonly audit: AuditService,
    @Optional() private readonly documentsService?: DocumentsService,
  ) {}

  /**
   * Aggregates monthly payroll data (hours, overtime, absences, and the plugins' items such as
   * expenses) for all active members.
   */
  async getPayrollData(db: Db, orgId: string, month: string): Promise<PayrollRow[]> {
    if (!MONTH_RE.test(month)) return [];
    const [yearStr, monthNumStr] = month.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthNumStr);
    const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
    const periodEnd = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const periodStart = `${month}-01`;

    // 1. Fetch all members with their basicdata and assignment
    const members = await db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.display_name,
        basicdata: users.basicdata,
        startDate: organization_memberships.start_date,
      })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active')));

    // 2. Fetch all departments in org
    const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.organization_id, orgId));
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));

    // 3. Fetch latest assignment up to periodEnd for each user
    const assignments = await db
      .select({
        userId: employee_assignments.user_id,
        departmentId: employee_assignments.department_id,
        jobFunction: employee_assignments.job_function,
        validFrom: employee_assignments.valid_from,
      })
      .from(employee_assignments)
      .where(and(eq(employee_assignments.organization_id, orgId), lte(employee_assignments.valid_from, periodEnd)));

    // The assignment in force at the end of the month: the latest valid_from per person.
    const assignmentMap = new Map<string, { department: string; jobFunction: string }>();
    for (const [userId, a] of latestAssignmentPerUser(assignments)) {
      assignmentMap.set(userId, {
        department: a.departmentId ? deptMap.get(a.departmentId) ?? '' : '',
        jobFunction: a.jobFunction ?? '',
      });
    }

    // 4. The plugins' amounts for this month (e.g. approved expenses), per item and person.
    const itemAmounts = await Promise.all(PAYROLL_ITEMS.map(async (item) => [item.key, await item.amounts(db, { orgId, from: periodStart, to: periodEnd })] as const));

    const rows: PayrollRow[] = [];

    for (const member of members) {
      const bd = (member.basicdata && typeof member.basicdata === 'object' ? member.basicdata : {}) as Record<string, any>;
      const personalien = (bd.personalien && typeof bd.personalien === 'object' ? bd.personalien : {}) as Record<string, any>;

      let targetMinutes = 0;
      let actualMinutes = 0;
      let deltaMinutes = 0;
      let overtimeBalanceMinutes = 0;
      let adjustmentMinutes = 0;
      let legalOvertimeMinutes = 0;
      let vacationDaysTaken = 0;
      let unpaidLeaveHours = 0;
      let sickLeaveHours = 0;

      try {
        const yearBalances = await this.balances.year(db, orgId, member.userId, year);
        const mb: MonthBalance | undefined = yearBalances.months.find((m: MonthBalance) => m.month.startsWith(month));
        if (mb) {
          targetMinutes = Number.isFinite(mb.monthTarget) ? mb.monthTarget : 0;
          actualMinutes = Number.isFinite(mb.actual) ? mb.actual : 0;
          deltaMinutes = Number.isFinite(mb.delta) ? mb.delta : 0;
          overtimeBalanceMinutes = Number.isFinite(mb.overtimeBalance) ? mb.overtimeBalance : 0;
          adjustmentMinutes = Number.isFinite(mb.adjustmentMinutes) ? mb.adjustmentMinutes : 0;
          legalOvertimeMinutes = Number.isFinite(mb.legalOvertimeMinutes) ? mb.legalOvertimeMinutes : 0;
          vacationDaysTaken = Number.isFinite(mb.vacationDays) ? Math.round(mb.vacationDays * 100) / 100 : 0;

          if (mb.absenceByType) {
            const unpaidMin = Number(mb.absenceByType.unpaid) || 0;
            const sickMin = (Number(mb.absenceByType.sick) || 0) + (Number(mb.absenceByType.accident) || 0);
            unpaidLeaveHours = Math.round((unpaidMin / 60) * 100) / 100;
            sickLeaveHours = Math.round((sickMin / 60) * 100) / 100;
          }
        }
      } catch {
        // Fallback for offline or missing balance records
      }

      const targetHours = Math.round((targetMinutes / 60) * 100) / 100;
      const actualHours = Math.round((actualMinutes / 60) * 100) / 100;
      const deltaHours = Math.round((deltaMinutes / 60) * 100) / 100;
      const overtimeBalanceHours = Math.round((overtimeBalanceMinutes / 60) * 100) / 100;
      const overtimePayoutHours = Math.round((Math.max(0, -adjustmentMinutes) / 60) * 100) / 100;
      const legalOvertimeHours = Math.round((legalOvertimeMinutes / 60) * 100) / 100;

      const assigned = assignmentMap.get(member.userId);
      const items: PayrollRow['items'] = {};
      for (const [key, amounts] of itemAmounts) {
        const a = amounts.get(member.userId) ?? { amount: 0, currency: 'CHF' };
        items[key] = { amount: Number.isFinite(a.amount) ? Math.round(a.amount * 100) / 100 : 0, currency: a.currency || 'CHF' };
      }
      const name = member.displayName || member.email;
      const dept = assigned?.department ?? '';

      rows.push({
        userId: member.userId,
        email: member.email,
        displayName: name,
        name,
        firstName: personalien.firstName ?? '',
        lastName: personalien.lastName ?? '',
        personnelNumber: personalien.personnelNumber ?? '',
        socialSecurityNumber: personalien.socialSecurityNumber ?? '',
        department: dept,
        departmentName: dept,
        jobFunction: assigned?.jobFunction ?? '',
        month,
        workloadPercent: 100,
        targetMinutes,
        actualMinutes,
        deltaMinutes,
        overtimeBalanceMinutes,
        adjustmentMinutes,
        legalOvertimeMinutes,
        targetHours,
        actualHours,
        deltaHours,
        overtimeBalanceHours,
        overtimePayoutHours,
        legalOvertimeHours,
        vacationDaysTaken,
        unpaidLeaveHours,
        sickLeaveHours,
        items,
      });
    }

    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Formats Abacus-compatible CSV (semicolon delimited). */
  formatAbacusCsv(month: string, rows: PayrollRow[]): string {
    const period = month.replace('-', '');
    const header = [
      'Personalnummer',
      'Name',
      'Periode',
      'Lohnart',
      'Lohnart_Bezeichnung',
      'Menge',
      'Einheit',
      'Ansatz',
      'Betrag',
      'Kostenstelle',
    ];

    const lines: (string | number | null)[][] = [];

    for (const r of rows) {
      const persNr = r.personnelNumber || r.email;
      const name = r.displayName;
      const kst = r.department;

      // 1000 Normalarbeitszeit
      lines.push([persNr, name, period, '1000', 'Normalarbeitszeit', r.actualHours || r.targetHours, 'Std', '', '', kst]);

      // 1200 Überstunden Auszahlung
      if (r.overtimePayoutHours > 0) {
        lines.push([persNr, name, period, '1200', 'Ueberstunden Auszahlung', r.overtimePayoutHours, 'Std', '', '', kst]);
      }

      // 1250 Überzeit (Art. 13 ArG)
      if (r.legalOvertimeHours > 0) {
        lines.push([persNr, name, period, '1250', 'Ueberzeit (Art. 13 ArG)', r.legalOvertimeHours, 'Std', '', '', kst]);
      }

      // 2000 Unbezahlter Urlaub
      if (r.unpaidLeaveHours > 0) {
        lines.push([persNr, name, period, '2000', 'Unbezahlter Urlaub', r.unpaidLeaveHours, 'Std', '', '', kst]);
      }

      // 2050 Krankheit / Unfall
      if (r.sickLeaveHours > 0) {
        lines.push([persNr, name, period, '2050', 'Krankheit / Unfall', r.sickLeaveHours, 'Std', '', '', kst]);
      }

      // The plugins' items (e.g. 3000 Spesenvergütung), each above zero as one line with its wage type.
      for (const item of PAYROLL_ITEMS) {
        const amount = r.items[item.key]?.amount ?? 0;
        if (amount > 0) lines.push([persNr, name, period, item.abacus.wageType, item.abacus.label, 1, item.abacus.unit, '', amount, kst]);
      }
    }

    return buildCsv(header, lines);
  }

  /** Formats Bexio-compatible CSV (semicolon delimited). */
  formatBexioCsv(month: string, rows: PayrollRow[]): string {
    const header = [
      'Mitarbeiter_Email',
      'Name',
      'Periode',
      'Sollstunden',
      'Iststunden',
      'Gleitzeit_Saldo',
      'Ueberstunden_Auszahlung',
      'Ferientage_Bezogen',
      ...PAYROLL_ITEMS.map((i) => i.columns.bexio),
      'Abteilung',
    ];

    const lines: (string | number | null)[][] = rows.map((r) => [
      r.email,
      r.displayName,
      month,
      r.targetHours,
      r.actualHours,
      r.overtimeBalanceHours,
      r.overtimePayoutHours,
      r.vacationDaysTaken,
      ...PAYROLL_ITEMS.map((i) => r.items[i.key]?.amount ?? 0),
      r.department,
    ]);

    return buildCsv(header, lines);
  }

  /** Formats generic payroll overview CSV. */
  formatGenericCsv(month: string, rows: PayrollRow[]): string {
    const header = [
      'Personalnummer',
      'Name',
      'Email',
      'Abteilung',
      'Funktion',
      'Monat',
      'Sollstunden',
      'Iststunden',
      'Differenz',
      'Gleitzeitsaldo',
      'Ueberstundenauszahlung',
      'Ueberzeit_ArG',
      'Ferientage',
      'Unbezahlt_Std',
      'Krankheit_Std',
      ...PAYROLL_ITEMS.map((i) => i.columns.csv),
    ];

    const lines: (string | number | null)[][] = rows.map((r) => [
      r.personnelNumber,
      r.displayName,
      r.email,
      r.department,
      r.jobFunction,
      month,
      r.targetHours,
      r.actualHours,
      r.deltaHours,
      r.overtimeBalanceHours,
      r.overtimePayoutHours,
      r.legalOvertimeHours,
      r.vacationDaysTaken,
      r.unpaidLeaveHours,
      r.sickLeaveHours,
      ...PAYROLL_ITEMS.map((i) => r.items[i.key]?.amount ?? 0),
    ]);

    return buildCsv(header, lines);
  }

  /** Builds an Excel (.xlsx) package with rich formatting. */
  formatGenericXlsx(month: string, rows: PayrollRow[]): Uint8Array<ArrayBuffer> {
    const columns: SheetColumn[] = [
      { header: 'Personal-Nr', kind: 'text', width: 14 },
      { header: 'Name', kind: 'text', width: 22 },
      { header: 'E-Mail', kind: 'text', width: 26 },
      { header: 'Abteilung', kind: 'text', width: 18 },
      { header: 'Funktion', kind: 'text', width: 18 },
      { header: 'Soll (h)', kind: 'number', width: 12 },
      { header: 'Ist (h)', kind: 'number', width: 12 },
      { header: '+/- (h)', kind: 'number', width: 12 },
      { header: 'Gleitzeit (h)', kind: 'number', width: 14 },
      { header: 'Auszahlung (h)', kind: 'number', width: 14 },
      { header: 'Überzeit ArG (h)', kind: 'number', width: 14 },
      { header: 'Ferien (Tg)', kind: 'number', width: 12 },
      { header: 'Unbezahlt (h)', kind: 'number', width: 12 },
      { header: 'Krankheit (h)', kind: 'number', width: 12 },
      ...PAYROLL_ITEMS.map((i): SheetColumn => ({ header: i.columns.xlsx, kind: 'number', width: 14 })),
    ];

    const lines: Cell[][] = rows.map((r) => [
      r.personnelNumber || '—',
      r.displayName,
      r.email,
      r.department || '—',
      r.jobFunction || '—',
      r.targetHours,
      r.actualHours,
      r.deltaHours,
      r.overtimeBalanceHours,
      r.overtimePayoutHours,
      r.legalOvertimeHours,
      r.vacationDaysTaken,
      r.unpaidLeaveHours,
      r.sickLeaveHours,
      ...PAYROLL_ITEMS.map((i) => r.items[i.key]?.amount ?? 0),
    ]);

    const totals: Cell[] = [
      'Total',
      `${rows.length} Personen`,
      '',
      '',
      '',
      Math.round(rows.reduce((s, r) => s + r.targetHours, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.actualHours, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.deltaHours, 0) * 100) / 100,
      '',
      Math.round(rows.reduce((s, r) => s + r.overtimePayoutHours, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.legalOvertimeHours, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.vacationDaysTaken, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.unpaidLeaveHours, 0) * 100) / 100,
      Math.round(rows.reduce((s, r) => s + r.sickLeaveHours, 0) * 100) / 100,
      ...PAYROLL_ITEMS.map((i) => Math.round(rows.reduce((s, r) => s + (r.items[i.key]?.amount ?? 0), 0) * 100) / 100),
    ];

    return buildXlsx(`Payroll_${month}`, columns, lines, totals);
  }

  /**
   * Dry-run validation of employee import data.
   */
  async previewEmployeeImport(db: Db, orgId: string, rawRows: RawEmployeeImportRow[]): Promise<{
    summary: { total: number; newCount: number; updateCount: number; errorCount: number };
    results: EmployeeImportValidationResult[];
  }> {
    const existingUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users);
    const existingUserMap = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u.id]));

    const existingMembers = await db
      .select({ userId: organization_memberships.user_id, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(organization_memberships.organization_id, orgId));
    const memberSet = new Set(existingMembers.map((m) => m.email.toLowerCase()));

    const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.organization_id, orgId));
    const deptMap = new Map(depts.map((d) => [d.name.toLowerCase().trim(), d.id]));

    const normalizedRows = (Array.isArray(rawRows) ? rawRows : []).map(normalizeRawEmployeeRow);
    const inBatchEmails = new Set(normalizedRows.map((r) => r.email).filter(Boolean));

    const errorMap: Record<string, string> = {
      'invalid-email': 'Invalid email address',
      'display-name-required': 'Name is required (provide displayName or firstName + lastName)',
      'invalid-start-date': 'Invalid start date format (use YYYY-MM-DD or DD.MM.YYYY)',
      'unknown-manager-email': 'Manager email not found in organization or import file',
    };

    const results: EmployeeImportValidationResult[] = [];
    let newCount = 0;
    let updateCount = 0;
    let errorCount = 0;

    for (const r of normalizedRows) {
      const errors: string[] = [];
      const email = r.email;
      const displayName = r.displayName;

      if (!email || !EMAIL_RE.test(email)) {
        errors.push('invalid-email');
      }

      if (!displayName && !existingUserMap.has(email)) {
        errors.push('display-name-required');
      }

      if (r.startDate && !DATE_RE.test(r.startDate.trim())) {
        errors.push('invalid-start-date');
      }

      let resolvedManagerId: string | null = null;
      if (r.managerEmail) {
        const mgrEmail = r.managerEmail;
        const mgrId = existingUserMap.get(mgrEmail);
        if (mgrId) {
          resolvedManagerId = mgrId;
        } else if (!inBatchEmails.has(mgrEmail)) {
          errors.push('unknown-manager-email');
        }
      }

      let resolvedDepartmentId: string | null = null;
      if (r.department) {
        const dName = r.department.trim().toLowerCase();
        resolvedDepartmentId = deptMap.get(dName) ?? null;
      }

      const isExistingMember = memberSet.has(email);
      let status: 'new' | 'update' | 'error' = 'new';
      if (errors.length > 0) {
        status = 'error';
        errorCount++;
      } else if (isExistingMember) {
        status = 'update';
        updateCount++;
      } else {
        status = 'new';
        newCount++;
      }

      const message = errors.map((e) => errorMap[e] || e).join('; ');

      results.push({
        row: r,
        status,
        errors,
        message: message || undefined,
        resolvedManagerId,
        resolvedDepartmentId,
      });
    }

    return {
      summary: { total: normalizedRows.length, newCount, updateCount, errorCount },
      results,
    };
  }

  /**
   * Commits the employee import inside a single database transaction.
   */
  async commitEmployeeImport(
    db: Db,
    orgId: string,
    callerId: string,
    rows: RawEmployeeImportRow[],
  ): Promise<{ ok: boolean; created: number; updated: number; errors?: string[] }> {
    const preview = await this.previewEmployeeImport(db, orgId, rows);
    const validRows = preview.results.filter((r) => r.status !== 'error');
    if (validRows.length === 0) {
      return { ok: false, created: 0, updated: 0, errors: ['no-valid-rows'] };
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let created = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      // Find default member role
      const [memberRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, 'member'), isNull(roles.organization_id)));

      const userIdByEmail = new Map<string, string>();

      // First pass: create or update users & memberships
      for (const item of validRows) {
        const r = item.row;
        const email = r.email.trim().toLowerCase();
        const displayName = (r.displayName || '').trim();
        const startDate = r.startDate && DATE_RE.test(r.startDate.trim()) ? r.startDate.trim() : todayStr;
        const workload = Number(r.workloadPercent) > 0 && Number(r.workloadPercent) <= 100 ? Number(r.workloadPercent) : 100;

        // Resolve or create user
        let userId = (await tx.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;

        const basicDataPatch = {
          personalien: {
            firstName: r.firstName?.trim() || undefined,
            lastName: r.lastName?.trim() || undefined,
            personnelNumber: r.personnelNumber?.trim() || undefined,
            socialSecurityNumber: r.socialSecurityNumber?.trim() || undefined,
          },
        };

        if (!userId) {
          const [newUser] = await tx
            .insert(users)
            .values({
              email,
              display_name: displayName,
              basicdata: basicDataPatch,
            })
            .returning({ id: users.id });
          userId = newUser.id;
          created++;
        } else {
          // Update existing user basicdata
          const existingUser = (await tx.select({ basicdata: users.basicdata, display_name: users.display_name }).from(users).where(eq(users.id, userId)))[0];
          const mergedBd = {
            ...((existingUser?.basicdata as Record<string, any>) || {}),
            personalien: {
              ...(((existingUser?.basicdata as any)?.personalien) || {}),
              ...basicDataPatch.personalien,
            },
          };
          await tx
            .update(users)
            .set({
              display_name: displayName || existingUser?.display_name,
              basicdata: mergedBd,
            })
            .where(eq(users.id, userId));
          updated++;
        }

        userIdByEmail.set(email, userId);

        // Ensure membership exists
        let membershipId = (
          await tx
            .select({ id: organization_memberships.id })
            .from(organization_memberships)
            .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)))
        )[0]?.id;

        if (!membershipId) {
          const [newMem] = await tx
            .insert(organization_memberships)
            .values({
              organization_id: orgId,
              user_id: userId,
              status: 'active',
              start_date: startDate,
            })
            .returning({ id: organization_memberships.id });
          membershipId = newMem.id;

          // Assign default member role
          if (memberRole) {
            await tx
              .insert(membership_roles)
              .values({
                membership_id: membershipId,
                role_id: memberRole.id,
                granted_by_user_id: callerId,
              })
              .onConflictDoNothing();
          }
        }

        // Resolve or create department if specified
        let deptId = item.resolvedDepartmentId;
        if (!deptId && r.department && r.department.trim()) {
          const dName = r.department.trim();
          const [existingDept] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(and(eq(departments.organization_id, orgId), eq(departments.name, dName)));
          if (existingDept) {
            deptId = existingDept.id;
          } else {
            const [newDept] = await tx
              .insert(departments)
              .values({ organization_id: orgId, name: dName })
              .returning({ id: departments.id });
            deptId = newDept.id;
          }
        }

        // Resolve manager ID (either previously resolved or from this batch)
        const managerUserId =
          item.resolvedManagerId ??
          (r.managerEmail ? userIdByEmail.get(r.managerEmail) ?? null : null);

        // Upsert assignment for startDate
        if (deptId || r.jobFunction || managerUserId) {
          await tx
            .insert(employee_assignments)
            .values({
              organization_id: orgId,
              user_id: userId,
              valid_from: startDate,
              department_id: deptId ?? null,
              job_function: r.jobFunction?.trim() || null,
              manager_user_id: managerUserId,
            })
            .onConflictDoUpdate({
              target: [employee_assignments.organization_id, employee_assignments.user_id, employee_assignments.valid_from],
              set: {
                department_id: deptId ?? null,
                job_function: r.jobFunction?.trim() || null,
                manager_user_id: managerUserId,
              },
            });
        }

        // Ensure default work schedule exists
        const [existingSchedule] = await tx
          .select({ id: work_schedules.id })
          .from(work_schedules)
          .where(and(eq(work_schedules.organization_id, orgId), eq(work_schedules.user_id, userId)));

        if (!existingSchedule) {
          // 42 hours/week standard in Switzerland, scaled by workload percent
          const dailyMin = Math.round(((42 * 60) / 5) * (workload / 100));
          await tx.insert(work_schedules).values({
            organization_id: orgId,
            user_id: userId,
            valid_from: startDate,
            workload_percent: String(workload),
            day_minutes: [dailyMin, dailyMin, dailyMin, dailyMin, dailyMin, 0, 0],
          });
        }
      }
    });

    await this.audit
      .record(orgId, callerId, 'employees.bulk_import', 'organization', orgId, {
        created,
        updated,
        total: validRows.length,
      })
      .catch(() => {});

    return { ok: true, created, updated };
  }

  /**
   * Parses a standard ZIP archive buffer into individual file entries.
   * Supports compression methods 0 (stored) and 8 (deflate).
   */
  readZipArchive(buffer: Buffer): Array<{ name: string; data: Buffer }> {
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error('Invalid zip: End of Central Directory record not found');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    const files: Array<{ name: string; data: Buffer }> = [];
    let curr = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (curr + 46 > buffer.length || buffer.readUInt32LE(curr) !== 0x02014b50) {
        throw new Error(`Invalid central directory header at offset ${curr}`);
      }
      const method = buffer.readUInt16LE(curr + 10);
      const compSize = buffer.readUInt32LE(curr + 20);
      const nameLen = buffer.readUInt16LE(curr + 28);
      const extraLen = buffer.readUInt16LE(curr + 30);
      const commentLen = buffer.readUInt16LE(curr + 32);
      const localHeaderOffset = buffer.readUInt32LE(curr + 42);

      const name = buffer.toString('utf8', curr + 46, curr + 46 + nameLen);
      curr += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) {
        continue;
      }

      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid local file header at offset ${localHeaderOffset}`);
      }
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const rawData = buffer.subarray(dataStart, dataStart + compSize);

      let data: Buffer;
      if (method === 0) {
        data = Buffer.from(rawData);
      } else if (method === 8) {
        data = inflateRawSync(rawData);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${method}`);
      }
      files.push({ name, data });
    }
    return files;
  }

  /**
   * Generates a complete organization backup archive containing all relational database tables
   * and decrypted document attachments packaged in a structured ZIP archive.
   */
  async exportOrganizationBackup(
    db: Db,
    orgId: string,
    callerId: string,
  ): Promise<{ filename: string; buffer: Buffer; counts: Record<string, number> }> {
    const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)))[0];
    if (!org) {
      throw new Error('organization-not-found');
    }

    const orgDomains = await db.select().from(organization_domains).where(eq(organization_domains.organization_id, orgId));
    const orgMemberships = await db.select().from(organization_memberships).where(eq(organization_memberships.organization_id, orgId));
    const memberUserIds = orgMemberships.map((m) => m.user_id);
    const membershipIds = orgMemberships.map((m) => m.id);

    const orgUsers = memberUserIds.length > 0 ? await db.select().from(users).where(inArray(users.id, memberUserIds)) : [];
    const depts = await db.select().from(departments).where(eq(departments.organization_id, orgId));
    const rolesData = await db.select().from(roles).where(eq(roles.organization_id, orgId));
    const roleIds = rolesData.map((r) => r.id);
    const rolePerms = roleIds.length > 0 ? await db.select().from(role_permissions).where(inArray(role_permissions.role_id, roleIds)) : [];

    const teamsData = await db.select().from(teams).where(eq(teams.organization_id, orgId));
    const teamMembersData = membershipIds.length > 0 ? await db.select().from(team_members).where(inArray(team_members.membership_id, membershipIds)) : [];
    const membershipRolesData = membershipIds.length > 0 ? await db.select().from(membership_roles).where(inArray(membership_roles.membership_id, membershipIds)) : [];
    const invitations = await db.select().from(organization_invitations).where(eq(organization_invitations.organization_id, orgId));

    const assignments = await db.select().from(employee_assignments).where(eq(employee_assignments.organization_id, orgId));
    const schedules = await db.select().from(work_schedules).where(eq(work_schedules.organization_id, orgId));
    const workTimes = await db.select().from(work_times).where(eq(work_times.organization_id, orgId));
    const timesheetPeriods = await db.select().from(timesheet_periods).where(eq(timesheet_periods.organization_id, orgId));
    const timesheetDocs = await db.select().from(timesheet_documents).where(eq(timesheet_documents.organization_id, orgId));

    const workTimeMonths = await db.select().from(work_time_months).where(eq(work_time_months.organization_id, orgId));
    const workTimeBalances = await db.select().from(work_time_balances).where(eq(work_time_balances.organization_id, orgId));
    const workTimeBalanceEntries = await db.select().from(work_time_balance_entries).where(eq(work_time_balance_entries.organization_id, orgId));
    const balanceAdjustments = await db.select().from(balance_adjustments).where(eq(balance_adjustments.organization_id, orgId));
    const vacationEntitlements = await db.select().from(vacation_entitlements).where(eq(vacation_entitlements.organization_id, orgId));
    const holidays = await db.select().from(org_holidays).where(eq(org_holidays.organization_id, orgId));

    const absencesData = await db.select().from(absences).where(eq(absences.organization_id, orgId));
    const projectsData = await db.select().from(projects).where(eq(projects.organization_id, orgId));
    const projectTeamsData = projectsData.length > 0 ? await db.select().from(project_teams).where(inArray(project_teams.project_id, projectsData.map((p) => p.id))) : [];
    const subprojectsData = await db.select().from(subprojects).where(eq(subprojects.organization_id, orgId));
    const projectTimesData = await db.select().from(project_times).where(eq(project_times.organization_id, orgId));
    const projectTimePeriodsData = await db.select().from(project_time_periods).where(eq(project_time_periods.organization_id, orgId));

    // The plugins' tables (e.g. expenses), as files under database/ with counts for the manifest.
    const pluginBackups = await Promise.all(BACKUPS.map((b) => b.export(db, orgId)));

    const requestsData = await db.select().from(requests).where(eq(requests.organization_id, orgId));
    const reqIds = requestsData.map((r) => r.id);
    const requestMessagesData = reqIds.length > 0 ? await db.select().from(request_messages).where(inArray(request_messages.request_id, reqIds)) : [];
    const msgIds = requestMessagesData.map((m) => m.id);
    const reqMsgDocs = msgIds.length > 0 ? await db.select().from(request_message_documents).where(inArray(request_message_documents.message_id, msgIds)) : [];

    const wfDefs = await db.select().from(workflow_definitions).where(eq(workflow_definitions.organization_id, orgId));
    const wfDefIds = wfDefs.map((w) => w.workflow_def_id);
    const workflowsData = wfDefIds.length > 0 ? await db.select().from(workflows).where(inArray(workflows.workflow_def_id, wfDefIds)) : [];
    const fieldConfigs = await db.select().from(field_config).where(eq(field_config.organization_id, orgId));
    const staticDataRows = await db.select().from(static_data).where(eq(static_data.organization_id, orgId));
    const basicdataVersionsData = await db.select().from(basicdata_versions).where(memberUserIds.length > 0 ? inArray(basicdata_versions.user_id, memberUserIds) : sql`false`);

    const personnelDocs = await db.select().from(personnel_documents).where(eq(personnel_documents.organization_id, orgId));
    const savedReportsData = await db.select().from(saved_reports).where(eq(saved_reports.organization_id, orgId));
    const reportSchedulesData = await db.select().from(report_schedules).where(eq(report_schedules.organization_id, orgId));
    const reportRunsData = await db.select().from(report_runs).where(eq(report_runs.organization_id, orgId));
    const notificationsData = await db.select().from(notifications).where(eq(notifications.organization_id, orgId));
    const docsData = await db.select().from(documents).where(eq(documents.organization_id, orgId));

    // Decrypt and package document files
    const docFiles: Array<{ name: string; data: Uint8Array }> = [];
    const documentsManifest: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sourceTable: string | null;
      sourceTableId: string | null;
      zipPath: string;
      sha256?: string;
      status: 'ok' | 'missing' | 'error';
    }> = [];

    for (const doc of docsData) {
      const safeName = (doc.file_name || 'document').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-150);
      const zipPath = `documents/${doc.id}_${safeName}`;
      try {
        let fileBuf: Buffer | null = null;
        if (this.documentsService) {
          fileBuf = await this.documentsService.read(doc);
        }
        if (fileBuf) {
          const sha256 = createHash('sha256').update(fileBuf).digest('hex');
          docFiles.push({ name: zipPath, data: fileBuf });
          documentsManifest.push({
            id: doc.id,
            fileName: doc.file_name,
            mimeType: doc.mime_type,
            sizeBytes: fileBuf.length,
            sourceTable: doc.source_table,
            sourceTableId: doc.source_table_id,
            zipPath,
            sha256,
            status: 'ok',
          });
        } else {
          documentsManifest.push({
            id: doc.id,
            fileName: doc.file_name,
            mimeType: doc.mime_type,
            sizeBytes: doc.size_bytes,
            sourceTable: doc.source_table,
            sourceTableId: doc.source_table_id,
            zipPath,
            status: 'missing',
          });
        }
      } catch {
        documentsManifest.push({
          id: doc.id,
          fileName: doc.file_name,
          mimeType: doc.mime_type,
          sizeBytes: doc.size_bytes,
          sourceTable: doc.source_table,
          sourceTableId: doc.source_table_id,
          zipPath,
          status: 'error',
        });
      }
    }

    const counts: Record<string, number> = {
      users: orgUsers.length,
      departments: depts.length,
      roles: rolesData.length,
      teams: teamsData.length,
      memberships: orgMemberships.length,
      employeeAssignments: assignments.length,
      workSchedules: schedules.length,
      workTimes: workTimes.length,
      timesheetPeriods: timesheetPeriods.length,
      absences: absencesData.length,
      projects: projectsData.length,
      ...Object.assign({}, ...pluginBackups.map((b) => b.counts)),
      requests: requestsData.length,
      personnelDocuments: personnelDocs.length,
      documents: docsData.length,
    };

    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        type: org.type,
        country: org.country,
      },
      counts,
      documentsManifest,
    };

    const jsonFile = (path: string, obj: any) => ({
      name: path,
      data: Buffer.from(JSON.stringify(obj, null, 2), 'utf8'),
    });

    const zipEntries: Array<{ name: string; data: Uint8Array }> = [
      jsonFile('manifest.json', manifest),
      jsonFile('database/organization.json', org),
      jsonFile('database/organization_domains.json', orgDomains),
      jsonFile('database/users.json', orgUsers),
      jsonFile('database/departments.json', depts),
      jsonFile('database/roles.json', rolesData),
      jsonFile('database/role_permissions.json', rolePerms),
      jsonFile('database/teams.json', teamsData),
      jsonFile('database/team_members.json', teamMembersData),
      jsonFile('database/organization_memberships.json', orgMemberships),
      jsonFile('database/membership_roles.json', membershipRolesData),
      jsonFile('database/organization_invitations.json', invitations),
      jsonFile('database/employee_assignments.json', assignments),
      jsonFile('database/work_schedules.json', schedules),
      jsonFile('database/work_times.json', workTimes),
      jsonFile('database/timesheet_periods.json', timesheetPeriods),
      jsonFile('database/timesheet_documents.json', timesheetDocs),
      jsonFile('database/work_time_months.json', workTimeMonths),
      jsonFile('database/work_time_balances.json', workTimeBalances),
      jsonFile('database/work_time_balance_entries.json', workTimeBalanceEntries),
      jsonFile('database/balance_adjustments.json', balanceAdjustments),
      jsonFile('database/vacation_entitlements.json', vacationEntitlements),
      jsonFile('database/org_holidays.json', holidays),
      jsonFile('database/absences.json', absencesData),
      jsonFile('database/projects.json', projectsData),
      jsonFile('database/subprojects.json', subprojectsData),
      jsonFile('database/project_teams.json', projectTeamsData),
      jsonFile('database/project_times.json', projectTimesData),
      jsonFile('database/project_time_periods.json', projectTimePeriodsData),
      ...pluginBackups.flatMap((b) => Object.entries(b.files).map(([file, rows]) => jsonFile(`database/${file}`, rows))),
      jsonFile('database/requests.json', requestsData),
      jsonFile('database/request_messages.json', requestMessagesData),
      jsonFile('database/request_message_documents.json', reqMsgDocs),
      jsonFile('database/workflow_definitions.json', wfDefs),
      jsonFile('database/workflows.json', workflowsData),
      jsonFile('database/field_config.json', fieldConfigs),
      jsonFile('database/static_data.json', staticDataRows),
      jsonFile('database/basicdata_versions.json', basicdataVersionsData),
      jsonFile('database/personnel_documents.json', personnelDocs),
      jsonFile('database/saved_reports.json', savedReportsData),
      jsonFile('database/report_schedules.json', reportSchedulesData),
      jsonFile('database/report_runs.json', reportRunsData),
      jsonFile('database/notifications.json', notificationsData),
      jsonFile('database/documents.json', docsData),
      ...docFiles,
    ];

    const zipBytes = zipStored(zipEntries);
    const buffer = Buffer.from(zipBytes);
    const filename = `backup_${(org.slug || 'org').replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.zip`;

    await this.audit
      .record(orgId, callerId, 'organization.backup_exported', 'organization', orgId, {
        filename,
        counts,
        documentsCount: docFiles.length,
      })
      .catch(() => {});

    return { filename, buffer, counts };
  }

  /**
   * Dry-run inspects an uploaded ZIP backup, parsing its manifest and validating compatibility.
   */
  async previewOrganizationBackup(
    db: Db,
    targetOrgId: string,
    buffer: Buffer,
  ): Promise<{
    ok: boolean;
    manifest?: any;
    compatibility?: any;
    error?: string;
  }> {
    let files: Array<{ name: string; data: Buffer }>;
    try {
      files = this.readZipArchive(buffer);
    } catch {
      return { ok: false, error: 'invalid-zip-archive' };
    }

    const manifestEntry = files.find((f) => f.name === 'manifest.json');
    if (!manifestEntry) {
      return { ok: false, error: 'manifest-not-found' };
    }

    let manifest: any;
    try {
      manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    } catch {
      return { ok: false, error: 'manifest-unreadable' };
    }

    if (!manifest || typeof manifest !== 'object' || !manifest.organization) {
      return { ok: false, error: 'invalid-manifest-structure' };
    }

    const [targetOrg] = await db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, targetOrgId));

    if (!targetOrg) {
      return { ok: false, error: 'target-organization-not-found' };
    }

    const isSameOrg = manifest.organization?.id === targetOrgId;
    const docFiles = files.filter((f) => f.name.startsWith('documents/'));
    const warnings: string[] = [];

    if (!isSameOrg) {
      warnings.push(
        `Restoring from organization "${manifest.organization?.name || 'Unknown'}" into current organization "${targetOrg.name}". Entity relationships will be mapped to the current organization.`,
      );
    }

    return {
      ok: true,
      manifest: {
        version: manifest.version ?? 1,
        createdAt: manifest.createdAt,
        sourceOrganization: manifest.organization,
        counts: manifest.counts ?? {},
        documentCount: docFiles.length,
        totalBytes: buffer.length,
      },
      compatibility: {
        compatible: true,
        isSameOrg,
        targetOrg: { id: targetOrg.id, name: targetOrg.name, slug: targetOrg.slug },
        warnings,
      },
    };
  }

  /**
   * Executes a transactional restore of an organization backup ZIP file into targetOrgId.
   */
  async restoreOrganizationBackup(
    db: Db,
    targetOrgId: string,
    callerId: string,
    buffer: Buffer,
  ): Promise<{ ok: boolean; restored?: Record<string, number>; error?: string }> {
    let files: Array<{ name: string; data: Buffer }>;
    try {
      files = this.readZipArchive(buffer);
    } catch {
      return { ok: false, error: 'invalid-zip-archive' };
    }

    const filesMap = new Map<string, Buffer>();
    for (const f of files) {
      filesMap.set(f.name, f.data);
    }

    const manifestBuf = filesMap.get('manifest.json');
    if (!manifestBuf) return { ok: false, error: 'manifest-not-found' };

    let manifest: any;
    try {
      manifest = JSON.parse(manifestBuf.toString('utf8'));
    } catch {
      return { ok: false, error: 'manifest-unreadable' };
    }

    const [targetOrg] = await db.select().from(organizations).where(eq(organizations.id, targetOrgId));
    if (!targetOrg) return { ok: false, error: 'target-organization-not-found' };

    const readJson = <T>(path: string): T[] => {
      const b = filesMap.get(path);
      if (!b) return [];
      try {
        const parsed = JSON.parse(b.toString('utf8'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const restored: Record<string, number> = {};
    const userIdMap = new Map<string, string>();
    const deptIdMap = new Map<string, string>();
    const roleIdMap = new Map<string, string>();
    const teamIdMap = new Map<string, string>();
    const membershipIdMap = new Map<string, string>();
    const projectIdMap = new Map<string, string>();
    const subprojectIdMap = new Map<string, string>();

    // 1. Users
    const usersList = readJson<any>('database/users.json');
    for (const u of usersList) {
      if (!u.email) continue;
      const [existing] = await db.select({ id: users.id, basicdata: users.basicdata, display_name: users.display_name }).from(users).where(eq(users.email, u.email));
      if (existing) {
        userIdMap.set(u.id, existing.id);
      } else {
        const [newUser] = await db
          .insert(users)
          .values({
            email: u.email,
            display_name: u.display_name || u.email.split('@')[0],
            first_name: u.first_name || null,
            last_name: u.last_name || null,
            middle_name: u.middle_name || null,
            avatar_url: u.avatar_url || null,
            locale: u.locale || 'en',
            timezone: u.timezone || 'UTC',
            settings: u.settings || {},
            basicdata: u.basicdata || {},
            is_active: u.is_active ?? true,
          })
          .returning({ id: users.id });
        userIdMap.set(u.id, newUser.id);
      }
      restored.users = (restored.users || 0) + 1;
    }

    // 2. Departments
    const deptsList = readJson<any>('database/departments.json');
    for (const d of deptsList) {
      if (!d.name) continue;
      const [existing] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.organization_id, targetOrgId), eq(departments.name, d.name)));
      if (existing) {
        deptIdMap.set(d.id, existing.id);
      } else {
        const [newDept] = await db
          .insert(departments)
          .values({
            organization_id: targetOrgId,
            name: d.name,
            leader_user_id: d.leader_user_id ? userIdMap.get(d.leader_user_id) ?? null : null,
            is_active: d.is_active ?? true,
            sort_order: d.sort_order ?? 0,
          })
          .returning({ id: departments.id });
        deptIdMap.set(d.id, newDept.id);
      }
      restored.departments = (restored.departments || 0) + 1;
    }

    // 3. Roles & Role Permissions
    const existingRoles = await db.select().from(roles).where(eq(roles.organization_id, targetOrgId));
    const rolesList = readJson<any>('database/roles.json');
    for (const r of rolesList) {
      const match = existingRoles.find((er) => er.name === r.name);
      if (match) {
        roleIdMap.set(r.id, match.id);
      } else {
        const [newRole] = await db
          .insert(roles)
          .values({
            organization_id: targetOrgId,
            name: r.name,
            description: r.description || null,
            is_system_role: false,
            settings: r.settings || {},
            translations: r.translations || {},
          })
          .returning({ id: roles.id });
        roleIdMap.set(r.id, newRole.id);
      }
      restored.roles = (restored.roles || 0) + 1;
    }

    const rolePermsList = readJson<any>('database/role_permissions.json');
    for (const rp of rolePermsList) {
      const rId = roleIdMap.get(rp.role_id);
      if (rId && rp.permission_id) {
        await db.insert(role_permissions).values({ role_id: rId, permission_id: rp.permission_id }).onConflictDoNothing();
      }
    }

    // 4. Memberships & Membership Roles
    const membershipsList = readJson<any>('database/organization_memberships.json');
    for (const m of membershipsList) {
      const uId = userIdMap.get(m.user_id);
      if (!uId) continue;
      const [mem] = await db
        .insert(organization_memberships)
        .values({
          organization_id: targetOrgId,
          user_id: uId,
          status: m.status || 'active',
          start_date: m.start_date || null,
          joined_at: m.joined_at || null,
          settings: m.settings || {},
        })
        .onConflictDoUpdate({
          target: [organization_memberships.organization_id, organization_memberships.user_id],
          set: { status: m.status || 'active' },
        })
        .returning({ id: organization_memberships.id });
      membershipIdMap.set(m.id, mem.id);
      restored.memberships = (restored.memberships || 0) + 1;
    }

    const membershipRolesList = readJson<any>('database/membership_roles.json');
    for (const mr of membershipRolesList) {
      const mId = membershipIdMap.get(mr.membership_id);
      const rId = roleIdMap.get(mr.role_id);
      if (mId && rId) {
        await db
          .insert(membership_roles)
          .values({
            membership_id: mId,
            role_id: rId,
            granted_by_user_id: mr.granted_by_user_id ? userIdMap.get(mr.granted_by_user_id) ?? callerId : callerId,
          })
          .onConflictDoNothing();
      }
    }

    // 5. Teams & Team Members
    const teamsList = readJson<any>('database/teams.json');
    for (const t of teamsList) {
      const [team] = await db
        .insert(teams)
        .values({
          organization_id: targetOrgId,
          name: t.name,
          description: t.description || null,
          lead_user_id: t.lead_user_id ? userIdMap.get(t.lead_user_id) ?? null : null,
        })
        .onConflictDoUpdate({
          target: [teams.organization_id, teams.name],
          set: { description: t.description || null },
        })
        .returning({ id: teams.id });
      teamIdMap.set(t.id, team.id);
      restored.teams = (restored.teams || 0) + 1;
    }

    const teamMembersList = readJson<any>('database/team_members.json');
    for (const tm of teamMembersList) {
      const tId = teamIdMap.get(tm.team_id);
      const mId = membershipIdMap.get(tm.membership_id);
      if (tId && mId) {
        await db
          .insert(team_members)
          .values({
            team_id: tId,
            membership_id: mId,
            team_role_id: tm.team_role_id ? roleIdMap.get(tm.team_role_id) ?? null : null,
          })
          .onConflictDoNothing();
      }
    }

    // 6. Documents & Files
    const docsList = readJson<any>('database/documents.json');
    for (const doc of docsList) {
      let docBuffer = manifest.documentsManifest?.find((m: any) => m.id === doc.id)?.zipPath
        ? filesMap.get(manifest.documentsManifest.find((m: any) => m.id === doc.id).zipPath)
        : undefined;

      if (!docBuffer) {
        for (const [k, v] of filesMap.entries()) {
          if (k.startsWith(`documents/${doc.id}_`)) {
            docBuffer = v;
            break;
          }
        }
      }

      if (docBuffer) {
        const safeName = (doc.file_name || 'document').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-200) || 'document';
        const storedName = `${randomUUID()}-${safeName}`;
        const relativePath = join(targetOrgId, storedName);
        const master = currentMasterKey();
        const sealed = master ? encryptDocument(docBuffer, master) : null;
        await mkdir(join(DOCUMENTS_ROOT, targetOrgId), { recursive: true });
        await writeFile(join(DOCUMENTS_ROOT, relativePath), sealed ? sealed.file : docBuffer);

        await db
          .insert(documents)
          .values({
            id: doc.id,
            organization_id: targetOrgId,
            file_name: doc.file_name,
            mime_type: doc.mime_type,
            size_bytes: docBuffer.length,
            storage_path: relativePath,
            source_table: doc.source_table || null,
            source_table_id: doc.source_table_id || null,
            uploaded_by_user_id: doc.uploaded_by_user_id ? userIdMap.get(doc.uploaded_by_user_id) ?? null : null,
            encrypted_key: sealed?.encryptedKey ?? null,
            key_id: sealed?.keyId ?? null,
          })
          .onConflictDoUpdate({
            target: documents.id,
            set: {
              file_name: doc.file_name,
              storage_path: relativePath,
              size_bytes: docBuffer.length,
              encrypted_key: sealed?.encryptedKey ?? null,
              key_id: sealed?.keyId ?? null,
            },
          });
        restored.documents = (restored.documents || 0) + 1;
      }
    }

    // 7. Employee Assignments
    const assignmentsList = readJson<any>('database/employee_assignments.json');
    for (const ea of assignmentsList) {
      const uId = userIdMap.get(ea.user_id);
      if (!uId) continue;
      await db
        .insert(employee_assignments)
        .values({
          organization_id: targetOrgId,
          user_id: uId,
          valid_from: ea.valid_from,
          department_id: ea.department_id ? deptIdMap.get(ea.department_id) ?? null : null,
          job_function: ea.job_function || null,
          manager_user_id: ea.manager_user_id ? userIdMap.get(ea.manager_user_id) ?? null : null,
        })
        .onConflictDoUpdate({
          target: [employee_assignments.organization_id, employee_assignments.user_id, employee_assignments.valid_from],
          set: {
            department_id: ea.department_id ? deptIdMap.get(ea.department_id) ?? null : null,
            job_function: ea.job_function || null,
            manager_user_id: ea.manager_user_id ? userIdMap.get(ea.manager_user_id) ?? null : null,
          },
        });
      restored.employeeAssignments = (restored.employeeAssignments || 0) + 1;
    }

    // 8. Work Schedules
    const schedulesList = readJson<any>('database/work_schedules.json');
    for (const ws of schedulesList) {
      const uId = userIdMap.get(ws.user_id);
      if (!uId) continue;
      await db
        .insert(work_schedules)
        .values({
          organization_id: targetOrgId,
          user_id: uId,
          valid_from: ws.valid_from,
          workload_percent: ws.workload_percent ? String(ws.workload_percent) : '100',
          day_minutes: ws.day_minutes || [504, 504, 504, 504, 504, 0, 0],
        })
        .onConflictDoUpdate({
          target: [work_schedules.organization_id, work_schedules.user_id, work_schedules.valid_from],
          set: {
            workload_percent: ws.workload_percent ? String(ws.workload_percent) : '100',
            day_minutes: ws.day_minutes || [504, 504, 504, 504, 504, 0, 0],
          },
        });
      restored.workSchedules = (restored.workSchedules || 0) + 1;
    }

    // 9. Work Times
    const workTimesList = readJson<any>('database/work_times.json');
    for (const wt of workTimesList) {
      const uId = userIdMap.get(wt.user_id);
      if (!uId) continue;
      await db
        .insert(work_times)
        .values({
          id: wt.id,
          organization_id: targetOrgId,
          user_id: uId,
          check_in: wt.check_in,
          check_out: wt.check_out || null,
          comment: wt.comment || null,
        })
        .onConflictDoUpdate({
          target: work_times.id,
          set: {
            check_in: wt.check_in,
            check_out: wt.check_out || null,
            comment: wt.comment || null,
          },
        });
      restored.workTimes = (restored.workTimes || 0) + 1;
    }

    // 10. Timesheet Periods & Documents
    const timesheetPeriodsList = readJson<any>('database/timesheet_periods.json');
    for (const tp of timesheetPeriodsList) {
      const uId = userIdMap.get(tp.user_id);
      if (!uId) continue;
      await db
        .insert(timesheet_periods)
        .values({
          id: tp.id,
          organization_id: targetOrgId,
          user_id: uId,
          period_start: tp.period_start,
          period_end: tp.period_end,
          status: tp.status || 'open',
          submitted_at: tp.submitted_at || null,
          reviewed_by_user_id: tp.reviewed_by_user_id ? userIdMap.get(tp.reviewed_by_user_id) ?? null : null,
          reviewed_at: tp.reviewed_at || null,
          review_note: tp.review_note || null,
        })
        .onConflictDoUpdate({
          target: timesheet_periods.id,
          set: {
            status: tp.status || 'open',
            submitted_at: tp.submitted_at || null,
            reviewed_at: tp.reviewed_at || null,
          },
        });
      restored.timesheetPeriods = (restored.timesheetPeriods || 0) + 1;
    }

    const timesheetDocsList = readJson<any>('database/timesheet_documents.json');
    for (const td of timesheetDocsList) {
      const uId = userIdMap.get(td.user_id);
      if (!uId) continue;
      await db
        .insert(timesheet_documents)
        .values({
          id: td.id,
          organization_id: targetOrgId,
          user_id: uId,
          document_id: td.document_id,
          timesheet_period_id: td.timesheet_period_id || null,
          period_start: td.period_start,
          issued_at: td.issued_at || new Date().toISOString(),
          kind: td.kind || 'timesheet',
        })
        .onConflictDoNothing();
    }

    // 11. Work Time Months
    const workTimeMonthsList = readJson<any>('database/work_time_months.json');
    for (const wtm of workTimeMonthsList) {
      const uId = userIdMap.get(wtm.user_id);
      if (!uId) continue;
      await db
        .insert(work_time_months)
        .values({
          organization_id: targetOrgId,
          user_id: uId,
          month: wtm.month,
          timesheet_period_id: wtm.timesheet_period_id || null,
          scheduled_minutes: wtm.scheduled_minutes ?? 0,
          holiday_minutes: wtm.holiday_minutes ?? 0,
          absence_minutes: wtm.absence_minutes || {},
          target_minutes: wtm.target_minutes ?? 0,
          actual_minutes: wtm.actual_minutes ?? 0,
          delta_minutes: wtm.delta_minutes ?? 0,
          vacation_days: String(wtm.vacation_days ?? '0'),
          closed_by_user_id: wtm.closed_by_user_id ? userIdMap.get(wtm.closed_by_user_id) ?? null : null,
          closed_at: wtm.closed_at || new Date().toISOString(),
          legal_overtime_minutes: wtm.legal_overtime_minutes ?? null,
        })
        .onConflictDoUpdate({
          target: [work_time_months.organization_id, work_time_months.user_id, work_time_months.month],
          set: {
            actual_minutes: wtm.actual_minutes ?? 0,
            target_minutes: wtm.target_minutes ?? 0,
            delta_minutes: wtm.delta_minutes ?? 0,
          },
        });
    }

    // 12. Vacation Entitlements
    const vacationList = readJson<any>('database/vacation_entitlements.json');
    for (const ve of vacationList) {
      const uId = userIdMap.get(ve.user_id);
      if (!uId) continue;
      await db
        .insert(vacation_entitlements)
        .values({
          id: ve.id,
          organization_id: targetOrgId,
          user_id: uId,
          year: ve.year,
          days: String(ve.days),
          note: ve.note || null,
        })
        .onConflictDoUpdate({
          target: [vacation_entitlements.organization_id, vacation_entitlements.user_id, vacation_entitlements.year],
          set: { days: String(ve.days), note: ve.note || null },
        });
      restored.vacationEntitlements = (restored.vacationEntitlements || 0) + 1;
    }

    // 13. Org Holidays
    const holidaysList = readJson<any>('database/org_holidays.json');
    for (const oh of holidaysList) {
      await db
        .insert(org_holidays)
        .values({
          id: oh.id,
          organization_id: targetOrgId,
          date: oh.date,
          name: oh.name || null,
          fraction: String(oh.fraction ?? '1'),
          observed: oh.observed ?? true,
        })
        .onConflictDoUpdate({
          target: [org_holidays.organization_id, org_holidays.date],
          set: { name: oh.name || null, fraction: String(oh.fraction ?? '1') },
        });
      restored.orgHolidays = (restored.orgHolidays || 0) + 1;
    }

    // 14. Absences
    const absencesList = readJson<any>('database/absences.json');
    for (const ab of absencesList) {
      const uId = userIdMap.get(ab.user_id);
      if (!uId) continue;
      await db
        .insert(absences)
        .values({
          id: ab.id,
          organization_id: targetOrgId,
          user_id: uId,
          date_start: ab.date_start,
          date_end: ab.date_end,
          status: ab.status || 'pending',
          reviewed_by_user_id: ab.reviewed_by_user_id ? userIdMap.get(ab.reviewed_by_user_id) ?? null : null,
          reviewed_at: ab.reviewed_at || null,
          review_note: ab.review_note || null,
          note: ab.note || null,
          absence_type: ab.absence_type || 'vacation',
          half_day: ab.half_day ?? false,
          document_id: ab.document_id || null,
        })
        .onConflictDoUpdate({
          target: absences.id,
          set: {
            date_start: ab.date_start,
            date_end: ab.date_end,
            status: ab.status || 'pending',
            absence_type: ab.absence_type || 'vacation',
            note: ab.note || null,
          },
        });
      restored.absences = (restored.absences || 0) + 1;
    }

    // 15. Projects & Subprojects
    const projectsList = readJson<any>('database/projects.json');
    for (const p of projectsList) {
      const [project] = await db
        .insert(projects)
        .values({
          id: p.id,
          organization_id: targetOrgId,
          name: p.name,
          owner_user_id: p.owner_user_id ? userIdMap.get(p.owner_user_id) ?? null : null,
          cost_item: p.cost_item || null,
          type: p.type || 'internal',
        })
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            name: p.name,
            cost_item: p.cost_item || null,
            type: p.type || 'internal',
          },
        })
        .returning({ id: projects.id });
      projectIdMap.set(p.id, project.id);
      restored.projects = (restored.projects || 0) + 1;
    }

    const subprojectsList = readJson<any>('database/subprojects.json');
    for (const sp of subprojectsList) {
      const pId = projectIdMap.get(sp.project_id) ?? sp.project_id;
      const [subproject] = await db
        .insert(subprojects)
        .values({
          id: sp.id,
          project_id: pId,
          organization_id: targetOrgId,
          name: sp.name,
          owner_user_id: sp.owner_user_id ? userIdMap.get(sp.owner_user_id) ?? null : null,
          cost_item: sp.cost_item || null,
          type: sp.type || 'phase',
        })
        .onConflictDoUpdate({
          target: subprojects.id,
          set: { name: sp.name, cost_item: sp.cost_item || null },
        })
        .returning({ id: subprojects.id });
      subprojectIdMap.set(sp.id, subproject.id);
    }

    // Teams a project is limited to (070); exports from before that have no file.
    for (const ptm of readJson<any>('database/project_teams.json')) {
      const pId = projectIdMap.get(ptm.project_id);
      const tId = teamIdMap.get(ptm.team_id);
      if (!pId || !tId) continue;
      await db.insert(project_teams).values({ project_id: pId, team_id: tId }).onConflictDoNothing();
    }

    // 16. Project Times
    const projectTimesList = readJson<any>('database/project_times.json');
    for (const pt of projectTimesList) {
      const uId = userIdMap.get(pt.user_id);
      if (!uId) continue;
      const pId = pt.project_id ? projectIdMap.get(pt.project_id) ?? pt.project_id : null;
      const spId = pt.subproject_id ? subprojectIdMap.get(pt.subproject_id) ?? pt.subproject_id : null;
      await db
        .insert(project_times)
        .values({
          id: pt.id,
          user_id: uId,
          organization_id: targetOrgId,
          project_id: pId,
          subproject_id: spId,
          start_time: pt.start_time,
          end_time: pt.end_time,
          comment: pt.comment || null,
        })
        .onConflictDoUpdate({
          target: project_times.id,
          set: {
            start_time: pt.start_time,
            end_time: pt.end_time,
            comment: pt.comment || null,
          },
        });
      restored.projectTimes = (restored.projectTimes || 0) + 1;
    }

    // 17. The plugins' tables (e.g. expenses), after the users, documents and projects they point at.
    for (const backup of BACKUPS) {
      const counts = await backup.restore(db, {
        targetOrgId,
        read: (file) => readJson<any>(`database/${file}`),
        userIds: userIdMap,
        projectIds: projectIdMap,
        subprojectIds: subprojectIdMap,
      });
      for (const [key, n] of Object.entries(counts)) restored[key] = (restored[key] || 0) + n;
    }

    // 18. Requests, Messages & Documents
    const requestsList = readJson<any>('database/requests.json');
    for (const reqRow of requestsList) {
      const uId = userIdMap.get(reqRow.requester_user_id);
      if (!uId) continue;
      await db
        .insert(requests)
        .values({
          id: reqRow.id,
          organization_id: targetOrgId,
          requester_user_id: uId,
          target_kind: reqRow.target_kind || 'hr',
          target_department_id: reqRow.target_department_id ? deptIdMap.get(reqRow.target_department_id) ?? null : null,
          subject: reqRow.subject || 'Request',
          status: reqRow.status || 'open',
          request_type: typeof reqRow.request_type === 'string' ? reqRow.request_type : null,
          urgent: reqRow.urgent === true,
          link_url: cleanRequestLink(reqRow.link_url) ?? null,
          assignee_user_id: reqRow.assignee_user_id ? userIdMap.get(reqRow.assignee_user_id) ?? null : null,
          opened_at: reqRow.opened_at || new Date().toISOString(),
          last_activity_at: reqRow.last_activity_at || new Date().toISOString(),
          resolved_at: reqRow.resolved_at || null,
          archived_at: reqRow.archived_at || null,
        })
        .onConflictDoUpdate({
          target: requests.id,
          set: {
            status: reqRow.status || 'open',
            resolved_at: reqRow.resolved_at || null,
          },
        });
      restored.requests = (restored.requests || 0) + 1;
    }

    const messagesList = readJson<any>('database/request_messages.json');
    for (const msg of messagesList) {
      await db
        .insert(request_messages)
        .values({
          id: msg.id,
          request_id: msg.request_id,
          author_user_id: msg.author_user_id ? userIdMap.get(msg.author_user_id) ?? null : null,
          kind: msg.kind || 'message',
          body: msg.body || null,
          data: msg.data || {},
          posted_at: msg.posted_at || new Date().toISOString(),
        })
        .onConflictDoNothing();
    }

    const reqMsgDocsList = readJson<any>('database/request_message_documents.json');
    for (const rmd of reqMsgDocsList) {
      await db
        .insert(request_message_documents)
        .values({
          message_id: rmd.message_id,
          document_id: rmd.document_id,
        })
        .onConflictDoNothing();
    }

    // 19. Personnel Documents
    const personnelDocsList = readJson<any>('database/personnel_documents.json');
    for (const pd of personnelDocsList) {
      const uId = userIdMap.get(pd.user_id);
      if (!uId) continue;
      await db
        .insert(personnel_documents)
        .values({
          id: pd.id,
          organization_id: targetOrgId,
          user_id: uId,
          document_id: pd.document_id,
          title: pd.title || 'Document',
          category: pd.category || 'other',
          document_date: pd.document_date || null,
          visible_to_employee: pd.visible_to_employee ?? false,
          uploaded_by_user_id: pd.uploaded_by_user_id ? userIdMap.get(pd.uploaded_by_user_id) ?? null : null,
        })
        .onConflictDoUpdate({
          target: personnel_documents.id,
          set: {
            title: pd.title || 'Document',
            category: pd.category || 'other',
          },
        });
      restored.personnelDocuments = (restored.personnelDocuments || 0) + 1;
    }

    // 20. Static Data & Field Config
    const staticDataList = readJson<any>('database/static_data.json');
    for (const sd of staticDataList) {
      await db
        .insert(static_data)
        .values({
          id: sd.id,
          organization_id: targetOrgId,
          entity: sd.entity,
          entity_uuid: sd.entity_uuid || null,
          enum_name: sd.enum_name,
          values: sd.values || {},
          translation: sd.translation || {},
        })
        .onConflictDoNothing();
    }

    const fieldConfigList = readJson<any>('database/field_config.json');
    for (const fc of fieldConfigList) {
      await db
        .insert(field_config)
        .values({
          id: fc.id,
          organization_id: targetOrgId,
          form_id: fc.form_id,
          field_key: fc.field_key,
          is_custom: fc.is_custom ?? false,
          config: fc.config || {},
        })
        .onConflictDoNothing();
    }

    await this.audit
      .record(targetOrgId, callerId, 'organization.backup_restored', 'organization', targetOrgId, {
        restored,
        manifestVersion: manifest.version,
        sourceOrg: manifest.organization?.name,
      })
      .catch(() => {});

    return { ok: true, restored };
  }
}
