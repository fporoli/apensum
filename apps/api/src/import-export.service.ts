import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { mergedBasicdata } from './basicdata.service';
import { sendMail } from './mailer';
import { buildInviteEmail } from './orgs.controller';
import type { Db } from './db.service';
import { BalancesService, type MonthBalance } from './balances.service';
import { payrollPersonalien } from './payroll-personalien';
export { payrollPersonalien };
import { resolveAbsenceTypes, unpaidAbsenceTypes } from './absence-types';
import {
  departments,
  employee_assignments,
  membership_roles,
  organization_invitations,
  organization_memberships,
  organizations,
  roles,
  users,
  work_schedules,
} from './db/schema';
import { buildCsv, buildXlsx, type Cell, type SheetColumn } from '@worktime3/shared/xlsx';
import { AuditService } from './audit.service';
import { randomUUID } from 'node:crypto';
import { clock } from './clock';

/** Absence types the payroll export counts as sick leave (the global types' keys). */
export const SICK_LEAVE_TYPES: ReadonlySet<string> = new Set(['sickness', 'accident']);

/** A month's absence minutes of the given types. */
export function payrollMinutes(absenceByType: Record<string, number>, types: ReadonlySet<string>): number {
  let minutes = 0;
  for (const [type, m] of Object.entries(absenceByType)) if (types.has(type)) minutes += Number(m) || 0;
  return minutes;
}

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

const PAYROLL_ITEMS: ApiPayrollItem[] = [];

/** Adds a plugin's payroll item (plugins.ts). */
export function registerPayrollItem(item: ApiPayrollItem): void {
  if (PAYROLL_ITEMS.some((i) => i.key === item.key)) throw new Error(`Payroll item ${item.key} is already registered`);
  PAYROLL_ITEMS.push(item);
}

/** The registered payroll items (the preview shows their columns). */
export function payrollItems(): readonly ApiPayrollItem[] {
  return PAYROLL_ITEMS;
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
    // Unpaid: the types marked so (Admin settings -> static data); sick leave: sickness and accident.
    const unpaidTypes = unpaidAbsenceTypes(await resolveAbsenceTypes(db, orgId));

    for (const member of members) {
      const personalien = payrollPersonalien(member.basicdata, orgId);

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
            const unpaidMin = payrollMinutes(mb.absenceByType, unpaidTypes);
            const sickMin = payrollMinutes(mb.absenceByType, SICK_LEAVE_TYPES);
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
    // This organization's active members only: whether an address has an account elsewhere is none of its business.
    const existingMembers = await db
      .select({ userId: organization_memberships.user_id, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active')));
    const existingUserMap = new Map(existingMembers.map((m) => [m.email.toLowerCase(), m.userId]));
    const memberSet = new Set(existingUserMap.keys());

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
   * Commits the employee import inside a single database transaction. An account spans organizations,
   * so the import writes into this organization's section only (an empty column changes nothing), and
   * renames only someone who belongs to this organization alone (`namesKept` counts the others).
   */
  async commitEmployeeImport(
    db: Db,
    orgId: string,
    callerId: string,
    rows: RawEmployeeImportRow[],
  ): Promise<{ ok: boolean; created: number; updated: number; invited?: number; namesKept?: number; errors?: string[] }> {
    const preview = await this.previewEmployeeImport(db, orgId, rows);
    const validRows = preview.results.filter((r) => r.status !== 'error');
    if (validRows.length === 0) {
      return { ok: false, created: 0, updated: 0, errors: ['no-valid-rows'] };
    }

    const todayStr = clock.now().toISOString().slice(0, 10);
    let created = 0;
    let updated = 0;
    let invited = 0;
    let namesKept = 0;
    const invitations: { email: string; token: string }[] = [];

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

        const personalien = Object.fromEntries(
          Object.entries({
            firstName: r.firstName?.trim(),
            lastName: r.lastName?.trim(),
            personnelNumber: r.personnelNumber?.trim(),
            socialSecurityNumber: r.socialSecurityNumber?.trim(),
          }).filter(([, value]) => !!value),
        );
        const hasPersonalien = Object.keys(personalien).length > 0;

        if (!userId) {
          const [newUser] = await tx
            .insert(users)
            .values({
              email,
              display_name: displayName,
              basicdata: hasPersonalien ? { orgs: { [orgId]: { personalien } } } : {},
            })
            .returning({ id: users.id });
          userId = newUser.id;
          created++;
        } else {
          const [member] = await tx
            .select({ id: organization_memberships.id })
            .from(organization_memberships)
            .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId), eq(organization_memberships.status, 'active')));
          if (!member) {
            // Someone's account: they join by accepting, and nothing of theirs changes until then.
            const invitation = await inviteExistingAccount(tx, orgId, callerId, email);
            if (invitation) invitations.push(invitation);
            invited++;
            continue;
          }
          const existingUser = (await tx.select({ basicdata: users.basicdata, display_name: users.display_name }).from(users).where(eq(users.id, userId)))[0];
          const patch: Record<string, unknown> = {};
          if (displayName && displayName !== existingUser?.display_name) {
            const theirs = await tx
              .select({ organization_id: organization_memberships.organization_id })
              .from(organization_memberships)
              .where(and(eq(organization_memberships.user_id, userId), ne(organization_memberships.organization_id, orgId)));
            if (theirs.length) namesKept++;
            else patch.display_name = displayName;
          }
          if (hasPersonalien) {
            const before = (existingUser?.basicdata as any)?.orgs?.[orgId]?.personalien ?? {};
            patch.basicdata = mergedBasicdata({ orgs: { [orgId]: { personalien: { ...before, ...personalien } } } });
          }
          if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, userId));
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
                granted_at: clock.now().toISOString(),
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
        invited,
        namesKept,
        total: validRows.length,
      })
      .catch(() => {});
    await mailInvitations(db, orgId, invitations);

    return { ok: true, created, updated, invited, namesKept };
  }
}

/**
 * The import never attaches an account that exists already: they invite it as a member (accepting
 * takes the account's own password). Null when an invitation is still pending.
 */
async function inviteExistingAccount(db: Pick<Db, 'select' | 'insert'>, orgId: string, callerId: string, rawEmail: string): Promise<{ email: string; token: string } | null> {
  const email = rawEmail.trim().toLowerCase();
  const pending = await db
    .select({ expires_at: organization_invitations.expires_at })
    .from(organization_invitations)
    .where(and(eq(organization_invitations.organization_id, orgId), eq(organization_invitations.email, email), eq(organization_invitations.status, 'pending')));
  if (pending.some((i) => Date.parse(i.expires_at) > Date.now())) return null; // real time: invitations expire in real time
  const candidates = await db
    .select({ id: roles.id, organization_id: roles.organization_id })
    .from(roles)
    .where(and(eq(roles.name, 'member'), or(eq(roles.organization_id, orgId), isNull(roles.organization_id))));
  // The organization's own copy of the role, when it has one.
  const role = candidates.find((r) => r.organization_id === orgId) ?? candidates[0];
  if (!role) return null;
  const token = randomUUID();
  await db.insert(organization_invitations).values({
    organization_id: orgId,
    email,
    role_id: role.id,
    token,
    invited_by_user_id: callerId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // real time: invitations expire in real time
  });
  return { email, token };
}

async function mailInvitations(db: Db, orgId: string, invitations: readonly { email: string; token: string }[]): Promise<void> {
  if (invitations.length === 0) return;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  for (const i of invitations) void sendMail({ to: i.email, ...buildInviteEmail(org?.name ?? '', i.token) }).catch(() => {});
}
