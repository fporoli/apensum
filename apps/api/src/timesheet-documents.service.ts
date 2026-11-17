import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { holidayName } from '@worktime3/shared/worktime';
import type { Db } from './db.service';
import type { Executor } from './access';
import { DocumentsService } from './documents.service';
import { WorkTimeModelService } from './work-time-model.service';
import { VersionsService } from './versions.service';

/**
 * The PDF frozen when a month is approved (Documents page): the working-time timesheet
 * (`timesheet_periods`) or one project's month (`project_time_periods`). Stored as a `documents`
 * row and linked in `timesheet_documents`; reopening the month supersedes it, and the next approval
 * issues a new one. Approved months are locked, so a PDF issued later (for months approved before
 * this existed) shows the same figures as one issued on approval.
 */

export type PeriodKind = 'timesheet' | 'project_timesheet';
export type Lang = 'en' | 'de' | 'fr' | 'it';

const LABELS: Record<Lang, Record<string, string>> = {
  en: {
    timesheet: 'Monthly timesheet',
    projectTimesheet: 'Project report',
    person: 'Person',
    organization: 'Organization',
    month: 'Month',
    project: 'Project',
    owner: 'Project owner',
    approvedBy: 'Approved by',
    approvedOn: 'Approved on',
    submittedOn: 'Submitted on',
    issued: 'Issued',
    date: 'Date',
    target: 'Target',
    attendance: 'Attendance',
    difference: 'Difference',
    note: 'Note',
    holiday: 'Holiday',
    total: 'Total',
    scheduled: 'Scheduled',
    holidays: 'Public holidays',
    absences: 'Absences',
    vacationDays: 'Vacation days',
    time: 'Time',
    duration: 'Duration',
    subproject: 'Subproject',
    comment: 'Comment',
    summary: 'Summary',
    entries: 'Entries',
    autoApproved: 'approved on submission',
    overview: 'Overview',
    status: 'Status',
    hours: 'Hours',
    noProject: 'No project',
    'status.approved': 'approved',
    'status.submitted': 'submitted, awaiting approval',
    'status.rejected': 'rejected',
    'status.open': 'not submitted',
  },
  de: {
    timesheet: 'Monatsrapport',
    projectTimesheet: 'Projektrapport',
    person: 'Person',
    organization: 'Organisation',
    month: 'Monat',
    project: 'Projekt',
    owner: 'Projektverantwortliche/r',
    approvedBy: 'Genehmigt von',
    approvedOn: 'Genehmigt am',
    submittedOn: 'Eingereicht am',
    issued: 'Erstellt',
    date: 'Datum',
    target: 'Soll',
    attendance: 'Ist',
    difference: 'Differenz',
    note: 'Bemerkung',
    holiday: 'Feiertag',
    total: 'Total',
    scheduled: 'Geplant',
    holidays: 'Feiertage',
    absences: 'Abwesenheiten',
    vacationDays: 'Ferientage',
    time: 'Zeit',
    duration: 'Dauer',
    subproject: 'Teilprojekt',
    comment: 'Kommentar',
    summary: 'Zusammenfassung',
    entries: 'Einträge',
    autoApproved: 'bei Einreichung genehmigt',
    overview: 'Übersicht',
    status: 'Status',
    hours: 'Stunden',
    noProject: 'Ohne Projekt',
    'status.approved': 'genehmigt',
    'status.submitted': 'eingereicht, Genehmigung ausstehend',
    'status.rejected': 'abgelehnt',
    'status.open': 'nicht eingereicht',
  },
  fr: {
    timesheet: 'Relevé mensuel',
    projectTimesheet: 'Rapport de projets',
    person: 'Personne',
    organization: 'Organisation',
    month: 'Mois',
    project: 'Projet',
    owner: 'Responsable du projet',
    approvedBy: 'Approuvé par',
    approvedOn: 'Approuvé le',
    submittedOn: 'Soumis le',
    issued: 'Établi',
    date: 'Date',
    target: 'Objectif',
    attendance: 'Présence',
    difference: 'Différence',
    note: 'Remarque',
    holiday: 'Jour férié',
    total: 'Total',
    scheduled: 'Planifié',
    holidays: 'Jours fériés',
    absences: 'Absences',
    vacationDays: 'Jours de vacances',
    time: 'Heure',
    duration: 'Durée',
    subproject: 'Sous-projet',
    comment: 'Commentaire',
    summary: 'Résumé',
    entries: 'Saisies',
    autoApproved: 'approuvé à la soumission',
    overview: 'Vue d’ensemble',
    status: 'Statut',
    hours: 'Heures',
    noProject: 'Sans projet',
    'status.approved': 'approuvé',
    'status.submitted': 'soumis, en attente d’approbation',
    'status.rejected': 'refusé',
    'status.open': 'non soumis',
  },
  it: {
    timesheet: 'Rapporto mensile',
    projectTimesheet: 'Rapporto progetti',
    person: 'Persona',
    organization: 'Organizzazione',
    month: 'Mese',
    project: 'Progetto',
    owner: 'Responsabile del progetto',
    approvedBy: 'Approvato da',
    approvedOn: 'Approvato il',
    submittedOn: 'Inviato il',
    issued: 'Emesso',
    date: 'Data',
    target: 'Obiettivo',
    attendance: 'Presenza',
    difference: 'Differenza',
    note: 'Nota',
    holiday: 'Festivo',
    total: 'Totale',
    scheduled: 'Pianificato',
    holidays: 'Giorni festivi',
    absences: 'Assenze',
    vacationDays: 'Giorni di vacanza',
    time: 'Ora',
    duration: 'Durata',
    subproject: 'Sottoprogetto',
    comment: 'Commento',
    summary: 'Riepilogo',
    entries: 'Voci',
    autoApproved: 'approvato all’invio',
    overview: 'Panoramica',
    status: 'Stato',
    hours: 'Ore',
    noProject: 'Senza progetto',
    'status.approved': 'approvato',
    'status.submitted': 'inviato, in attesa di approvazione',
    'status.rejected': 'rifiutato',
    'status.open': 'non inviato',
  },
};

export function pdfLang(locale: string | null | undefined): Lang {
  const l = (locale ?? '').slice(0, 2).toLowerCase();
  return l === 'de' || l === 'fr' || l === 'it' ? l : 'en';
}

const intlLocale = (lang: Lang) => `${lang}-CH`;

/** Signed hours and minutes, e.g. `-1:05`. */
export function hm(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** `military_service` -> `Military service`: absence types have their labels in the web app only. */
function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(date: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { ...opts, timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

function formatInstant(iso: string, lang: Lang, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function monthTitle(periodStart: string, lang: Lang): string {
  return formatDate(periodStart, lang, { month: 'long', year: 'numeric' });
}

export interface TimesheetPdfData {
  organization: string;
  person: string;
  periodStart: string;
  approvedBy: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  autoApproved: boolean;
  timeZone: string;
  days: { date: string; target: number; actual: number; holiday?: string; absence?: string }[];
  totals: { scheduled: number; holiday: number; absenceByType: Record<string, number>; target: number; actual: number; delta: number; vacationDays: number };
}

export type ProjectStatus = 'approved' | 'submitted' | 'rejected' | 'open';

export interface ProjectReportPdfData {
  organization: string;
  person: string;
  periodStart: string;
  timeZone: string;
  /** Every project with hours in the month (`project` null: hours without a project), with its own approval. */
  projects: {
    project: string | null;
    owner: string | null;
    status: ProjectStatus;
    approvedBy: string | null;
    approvedAt: string | null;
    submittedAt: string | null;
    autoApproved: boolean;
    entries: { start: string; end: string; minutes: number; subproject: string | null; comment: string | null }[];
  }[];
}

export interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

/** A minimal PDF writer: title block, key/value lines, and a table that continues on new pages. */
export class Sheet {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;
  readonly left = 48;
  readonly width: number;

  constructor(title: string, subtitle: string, layout: 'portrait' | 'landscape' = 'portrait') {
    this.doc = new PDFDocument({ size: 'A4', layout, margin: 48, bufferPages: true });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))));
    this.width = this.doc.page.width - 96;
    this.doc.info.Title = `${title} – ${subtitle}`;
    this.doc.font('Helvetica-Bold').fontSize(18).text(title, this.left, 48);
    this.doc.font('Helvetica').fontSize(12).fillColor('#444').text(subtitle).fillColor('black');
    this.doc.moveDown(0.8);
  }

  facts(rows: [string, string][]): void {
    this.doc.fontSize(9.5);
    for (const [k, v] of rows) {
      const y = this.doc.y;
      this.doc.font('Helvetica-Bold').text(k, this.left, y, { width: 130 });
      this.doc.font('Helvetica').text(v, this.left + 135, y, { width: this.width - 135 });
    }
    this.doc.moveDown(0.8);
  }

  heading(text: string): void {
    this.ensure(40);
    this.doc.font('Helvetica-Bold').fontSize(11).text(text, this.left, this.doc.y);
    this.doc.moveDown(0.3);
  }

  table(columns: Column[], rows: { cells: string[]; bold?: boolean; shade?: boolean }[]): void {
    const header = () => {
      this.row(columns, columns.map((c) => c.label), { bold: true, rule: true });
    };
    header();
    for (const r of rows) {
      if (this.ensure(16)) header();
      this.row(columns, r.cells, { bold: r.bold, shade: r.shade, rule: r.bold });
    }
    this.doc.moveDown(0.8);
  }

  private row(columns: Column[], cells: string[], opts: { bold?: boolean; shade?: boolean; rule?: boolean }): void {
    const y = this.doc.y;
    const height = 14;
    if (opts.shade) this.doc.save().rect(this.left, y - 2, this.width, height).fill('#f2f2f2').restore();
    this.doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('black');
    let x = this.left;
    columns.forEach((c, i) => {
      // Space between a right-aligned column and a left-aligned one after it.
      const pad = i > 0 && columns[i - 1].align === 'right' && c.align !== 'right' ? 12 : 2;
      const width = c.width - pad - 2;
      this.doc.text(this.fit(cells[i] ?? '', width), x + pad, y, { width, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    });
    if (opts.rule) this.doc.moveTo(this.left, y + height - 2).lineTo(this.left + this.width, y + height - 2).lineWidth(0.5).stroke('#999');
    this.doc.y = y + height;
  }

  /** One line: pdfkit still wraps long words at `width`, so cut the text to fit and end it with "…". */
  private fit(text: string, width: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (this.doc.widthOfString(clean) <= width) return clean;
    let lo = 0;
    let hi = clean.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.doc.widthOfString(`${clean.slice(0, mid).trimEnd()}…`) <= width) lo = mid;
      else hi = mid - 1;
    }
    return `${clean.slice(0, lo).trimEnd()}…`;
  }

  /** Starts a new page when less than `space` is left; true when it did. */
  private ensure(space: number): boolean {
    if (this.doc.y + space <= this.doc.page.height - 60) return false;
    this.doc.addPage();
    this.doc.y = 48;
    return true;
  }

  async finish(footer: string): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      // Writing below the bottom margin would make pdfkit start a new page.
      this.doc.page.margins.bottom = 0;
      const y = this.doc.page.height - 36;
      this.doc.font('Helvetica').fontSize(7.5).fillColor('#777');
      this.doc.text(footer, this.left, y, { width: this.width - 60, lineBreak: false });
      this.doc.text(`${i + 1} / ${range.count}`, this.left + this.width - 60, y, { width: 60, align: 'right', lineBreak: false });
    }
    this.doc.end();
    return this.done;
  }
}

function approvalFacts(L: Record<string, string>, d: { approvedBy: string | null; approvedAt: string | null; submittedAt: string | null; autoApproved: boolean; timeZone: string }, lang: Lang): [string, string][] {
  const out: [string, string][] = [];
  if (d.submittedAt) out.push([L.submittedOn, formatInstant(d.submittedAt, lang, d.timeZone)]);
  if (d.approvedAt) out.push([L.approvedOn, formatInstant(d.approvedAt, lang, d.timeZone) + (d.autoApproved ? ` (${L.autoApproved})` : '')]);
  if (d.approvedBy && !d.autoApproved) out.push([L.approvedBy, d.approvedBy]);
  return out;
}

export async function renderTimesheetPdf(d: TimesheetPdfData, lang: Lang, issuedAt = new Date().toISOString()): Promise<Buffer> {
  const L = LABELS[lang];
  const sheet = new Sheet(L.timesheet, monthTitle(d.periodStart, lang));
  sheet.facts([[L.person, d.person], [L.organization, d.organization], ...approvalFacts(L, d, lang)]);
  const w = sheet.width;
  const columns: Column[] = [
    { label: L.date, width: w * 0.22 },
    { label: L.target, width: w * 0.12, align: 'right' },
    { label: L.attendance, width: w * 0.12, align: 'right' },
    { label: L.difference, width: w * 0.13, align: 'right' },
    { label: L.note, width: w * 0.41 },
  ];
  const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  sheet.table(columns, [
    ...d.days.map((day) => ({
      cells: [
        formatDate(day.date, lang, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
        day.target ? hm(day.target) : '',
        day.actual ? hm(day.actual) : '',
        day.target || day.actual ? hm(day.actual - day.target) : '',
        [day.holiday, day.absence].filter(Boolean).join(' · '),
      ],
      shade: weekend(day.date),
    })),
    { cells: [L.total, hm(d.totals.target), hm(d.totals.actual), hm(d.totals.delta), ''], bold: true },
  ]);
  sheet.heading(L.summary);
  const t = d.totals;
  sheet.facts([
    [L.scheduled, hm(t.scheduled)],
    [L.holidays, hm(t.holiday)],
    ...Object.entries(t.absenceByType).map(([type, m]): [string, string] => [`${L.absences}: ${humanize(type)}`, hm(m)]),
    [L.target, hm(t.target)],
    [L.attendance, hm(t.actual)],
    [L.difference, hm(t.delta)],
    ...(t.vacationDays ? [[L.vacationDays, new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 2 }).format(t.vacationDays)] as [string, string]] : []),
  ]);
  return sheet.finish(`${d.organization} · ${d.person} · ${L.issued} ${formatInstant(issuedAt, lang, d.timeZone)}`);
}

export async function renderProjectReportPdf(d: ProjectReportPdfData, lang: Lang, issuedAt = new Date().toISOString()): Promise<Buffer> {
  const L = LABELS[lang];
  const sheet = new Sheet(L.projectTimesheet, monthTitle(d.periodStart, lang));
  sheet.facts([[L.person, d.person], [L.organization, d.organization]]);
  const w = sheet.width;
  const name = (p: ProjectReportPdfData['projects'][number]) => p.project ?? L.noProject;
  const minutesOf = (p: ProjectReportPdfData['projects'][number]) => p.entries.reduce((s, e) => s + e.minutes, 0);
  const statusText = (p: ProjectReportPdfData['projects'][number]) => (p.project ? L[`status.${p.status}`] : '');

  sheet.heading(L.overview);
  sheet.table(
    [
      { label: L.project, width: w * 0.38 },
      { label: L.owner, width: w * 0.22 },
      { label: L.status, width: w * 0.28 },
      { label: L.hours, width: w * 0.12, align: 'right' },
    ],
    [
      ...d.projects.map((p) => ({ cells: [name(p), p.owner ?? '', statusText(p), hm(minutesOf(p))] })),
      { cells: [L.total, '', '', hm(d.projects.reduce((s, p) => s + minutesOf(p), 0))], bold: true },
    ],
  );

  const time = (iso: string) => new Intl.DateTimeFormat(intlLocale(lang), { hour: '2-digit', minute: '2-digit', timeZone: d.timeZone }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat(intlLocale(lang), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: d.timeZone }).format(new Date(iso));
  const columns: Column[] = [
    { label: L.date, width: w * 0.2 },
    { label: L.time, width: w * 0.16 },
    { label: L.duration, width: w * 0.1, align: 'right' },
    { label: L.subproject, width: w * 0.18 },
    { label: L.comment, width: w * 0.36 },
  ];
  for (const p of d.projects) {
    sheet.heading(name(p));
    const facts: [string, string][] = [];
    if (p.owner) facts.push([L.owner, p.owner]);
    if (p.project) facts.push([L.status, statusText(p)]);
    if (p.status === 'approved') facts.push(...approvalFacts(L, { ...p, timeZone: d.timeZone }, lang));
    else if (p.submittedAt) facts.push([L.submittedOn, formatInstant(p.submittedAt, lang, d.timeZone)]);
    if (facts.length) sheet.facts(facts);
    sheet.table(columns, [
      ...p.entries.map((e) => ({ cells: [day(e.start), `${time(e.start)}–${time(e.end)}`, hm(e.minutes), e.subproject ?? '', e.comment ?? ''] })),
      { cells: [`${L.total} (${p.entries.length} ${L.entries})`, '', hm(minutesOf(p)), '', ''], bold: true },
    ]);
  }
  return sheet.finish(`${d.organization} · ${d.person} · ${L.issued} ${formatInstant(issuedAt, lang, d.timeZone)}`);
}

/** `timesheet-2026-10.pdf`, `project-report-2026-10.pdf`. */
export function pdfFileName(kind: PeriodKind, periodStart: string): string {
  const month = periodStart.slice(0, 7);
  return kind === 'timesheet' ? `timesheet-${month}.pdf` : `project-report-${month}.pdf`;
}

interface Owner {
  organization_id: string;
  user_id: string;
  org_name: string;
  person: string;
  locale: string | null;
}

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

@Injectable()
export class TimesheetDocumentsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly workTime: WorkTimeModelService,
    private readonly versions: VersionsService,
  ) {}

  /**
   * Issues the PDF after an approval: the working-time timesheet of `periodId`, or the project report
   * of the month of the project month `periodId` (all projects, superseding the previous version).
   * Best effort: an approval never fails because of it (Documents issues missing PDFs of the year).
   */
  async issue(db: Db, kind: PeriodKind, periodId: string, actorUserId: string | null): Promise<string | null> {
    try {
      if (kind === 'timesheet') return await this.issueTimesheet(db, periodId, actorUserId);
      const month = await this.projectMonthOf(db, periodId);
      return month ? await this.issueProjectReport(db, month.organization_id, month.user_id, month.period_start, actorUserId) : null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`timesheet document for ${kind} ${periodId} not issued: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * After a month is reopened: its PDF stays listed as superseded. A project report is issued again
   * right away when other projects of that month are still approved (showing this one as open).
   */
  async supersede(db: Db, kind: PeriodKind, periodId: string): Promise<void> {
    if (kind === 'timesheet') {
      await db.execute(sql`UPDATE timesheet_documents SET superseded_at = now() WHERE timesheet_period_id = ${periodId} AND superseded_at IS NULL`);
      return;
    }
    const month = await this.projectMonthOf(db, periodId);
    if (!month) return;
    await this.supersedeProjectReport(db, month.organization_id, month.user_id, month.period_start);
    await this.issue(db, 'project_timesheet', periodId, null);
  }

  /**
   * Issues the missing PDFs of `year` for one person: approved working-time months without a current
   * PDF and months with an approved project but no current project report.
   */
  async issueMissing(db: Db, orgId: string, userId: string, year: number): Promise<void> {
    const from = `${year}-01-01`;
    const to = `${year + 1}-01-01`;
    const timesheets = await db.execute(sql`
      SELECT p.id FROM timesheet_periods p
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
        AND p.period_start >= ${from}::date AND p.period_start < ${to}::date
        AND NOT EXISTS (SELECT 1 FROM timesheet_documents td WHERE td.timesheet_period_id = p.id AND td.superseded_at IS NULL)`);
    for (const r of timesheets.rows as { id: string }[]) await this.issue(db, 'timesheet', r.id, null);
    const months = await db.execute(sql`
      SELECT DISTINCT to_char(p.period_start, 'YYYY-MM-DD') AS period_start FROM project_time_periods p
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
        AND p.period_start >= ${from}::date AND p.period_start < ${to}::date
        AND NOT EXISTS (SELECT 1 FROM timesheet_documents td
                        WHERE td.kind = 'project_timesheet' AND td.organization_id = p.organization_id AND td.user_id = p.user_id
                          AND td.period_start = p.period_start AND td.superseded_at IS NULL)`);
    for (const r of months.rows as { period_start: string }[]) {
      try {
        await this.issueProjectReport(db, orgId, userId, r.period_start, null);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`project report ${userId} ${r.period_start} not issued: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async projectMonthOf(db: Db, projectPeriodId: string) {
    const rows = await db.execute(sql`
      SELECT organization_id, user_id, to_char(period_start, 'YYYY-MM-DD') AS period_start FROM project_time_periods WHERE id = ${projectPeriodId}`);
    return rows.rows[0] as { organization_id: string; user_id: string; period_start: string } | undefined;
  }

  private async supersedeProjectReport(db: Executor, orgId: string, userId: string, periodStart: string): Promise<void> {
    await db.execute(sql`
      UPDATE timesheet_documents SET superseded_at = now()
      WHERE kind = 'project_timesheet' AND organization_id = ${orgId} AND user_id = ${userId}
        AND period_start = ${periodStart}::date AND superseded_at IS NULL`);
  }

  private async owner(db: Db, orgId: string, userId: string): Promise<Owner | undefined> {
    const rows = await db.execute(sql`
      SELECT o.id AS organization_id, u.id AS user_id, o.name AS org_name, coalesce(u.display_name, u.email) AS person, u.locale
      FROM organizations o, users u WHERE o.id = ${orgId} AND u.id = ${userId}`);
    return rows.rows[0] as unknown as Owner | undefined;
  }

  /** Stores the PDF and links it as the current one (a concurrent issue of the same month wins). */
  private async link(db: Db, owner: Owner, kind: PeriodKind, periodStart: string, timesheetPeriodId: string | null, buffer: Buffer, actorUserId: string | null, source: { table: string; id: string }): Promise<string | null> {
    const documentId = await this.documents.store(db, owner.organization_id, actorUserId, { name: pdfFileName(kind, periodStart), mimeType: 'application/pdf', buffer }, source);
    if (kind === 'timesheet') {
      await db.execute(sql`UPDATE timesheet_documents SET superseded_at = now() WHERE timesheet_period_id = ${timesheetPeriodId} AND superseded_at IS NULL`);
    } else {
      await this.supersedeProjectReport(db, owner.organization_id, owner.user_id, periodStart);
    }
    const inserted = await db.execute(sql`
      INSERT INTO timesheet_documents (organization_id, user_id, document_id, kind, timesheet_period_id, period_start)
      VALUES (${owner.organization_id}, ${owner.user_id}, ${documentId}, ${kind}, ${timesheetPeriodId}, ${periodStart}::date)
      ON CONFLICT DO NOTHING
      RETURNING id`);
    const row = inserted.rows[0] as { id: string } | undefined;
    if (!row) {
      await this.documents.remove(db, documentId);
      return null;
    }
    void this.versions.record('timesheet_documents', row.id, 'insert', actorUserId, { kind, periodStart, timesheetPeriodId, documentId }).catch(() => {});
    return documentId;
  }

  private async issueTimesheet(db: Db, periodId: string, actorUserId: string | null): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT p.organization_id, p.user_id, to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
             to_char(p.period_end, 'YYYY-MM-DD') AS period_end, p.status,
             p.submitted_at, p.reviewed_at, p.reviewed_by_user_id, coalesce(rv.display_name, rv.email) AS reviewer
      FROM timesheet_periods p LEFT JOIN users rv ON rv.id = p.reviewed_by_user_id
      WHERE p.id = ${periodId}`);
    const p = result.rows[0] as
      | { organization_id: string; user_id: string; period_start: string; period_end: string; status: string; submitted_at: string | Date | null; reviewed_at: string | Date | null; reviewed_by_user_id: string | null; reviewer: string | null }
      | undefined;
    if (!p || p.status !== 'approved') return null;
    const owner = await this.owner(db, p.organization_id, p.user_id);
    if (!owner) return null;
    const lang = pdfLang(owner.locale);
    const timeZone = await this.workTime.timeZone(db, p.user_id);
    const [targets, attended, holidays] = await Promise.all([
      this.workTime.targets(db, p.organization_id, p.user_id, p.period_start, p.period_end),
      this.workTime.attendanceByDay(db, p.organization_id, p.user_id, p.period_start, p.period_end, timeZone, false),
      this.workTime.holidays(db, p.organization_id, p.period_start, p.period_end),
    ]);
    // The closed month (balances.service closeMonth) holds the approved totals.
    const closed = await db.execute(sql`
      SELECT scheduled_minutes, holiday_minutes, absence_minutes, target_minutes, actual_minutes, delta_minutes, vacation_days
      FROM work_time_months WHERE timesheet_period_id = ${periodId}`);
    const m = closed.rows[0] as Record<string, unknown> | undefined;
    const sum = (f: (d: (typeof targets)[number]) => number) => targets.reduce((s, d) => s + f(d), 0);
    const actual = targets.reduce((s, d) => s + (attended.get(d.date) ?? 0), 0);
    const absenceByType: Record<string, number> = {};
    for (const d of targets) if (d.absence && d.absenceType) absenceByType[d.absenceType] = (absenceByType[d.absenceType] ?? 0) + d.absence;
    const totals = m
      ? {
          scheduled: Number(m.scheduled_minutes),
          holiday: Number(m.holiday_minutes),
          absenceByType: (m.absence_minutes as Record<string, number>) ?? {},
          target: Number(m.target_minutes),
          actual: Number(m.actual_minutes),
          delta: Number(m.delta_minutes),
          vacationDays: Number(m.vacation_days),
        }
      : { scheduled: sum((d) => d.scheduled), holiday: sum((d) => d.holiday), absenceByType, target: sum((d) => d.target), actual, delta: actual - sum((d) => d.target), vacationDays: 0 };
    const buffer = await renderTimesheetPdf(
      {
        organization: owner.org_name,
        person: owner.person,
        periodStart: p.period_start,
        approvedBy: p.reviewer,
        approvedAt: iso(p.reviewed_at),
        submittedAt: iso(p.submitted_at),
        autoApproved: p.reviewed_by_user_id === p.user_id,
        timeZone,
        days: targets.map((d) => {
          const h = holidays.get(d.date);
          return {
            date: d.date,
            target: d.target,
            actual: Math.round(attended.get(d.date) ?? 0),
            holiday: h && d.holiday ? holidayName(h, lang) : undefined,
            absence: d.absence && d.absenceType ? humanize(d.absenceType) : undefined,
          };
        }),
        totals,
      },
      lang,
    );
    return this.link(db, owner, 'timesheet', p.period_start, periodId, buffer, actorUserId, { table: 'timesheet_periods', id: periodId });
  }

  /** The month's project report: every project with hours, each with its approval. Needs one approved project. */
  private async issueProjectReport(db: Db, orgId: string, userId: string, periodStart: string, actorUserId: string | null): Promise<string | null> {
    const owner = await this.owner(db, orgId, userId);
    if (!owner) return null;
    const periods = await db.execute(sql`
      SELECT p.project_id, p.status, p.submitted_at, p.reviewed_at, p.reviewed_by_user_id, coalesce(rv.display_name, rv.email) AS reviewer
      FROM project_time_periods p LEFT JOIN users rv ON rv.id = p.reviewed_by_user_id
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.period_start = ${periodStart}::date`);
    const byProject = new Map((periods.rows as Record<string, unknown>[]).map((r) => [r.project_id as string, r]));
    if (![...byProject.values()].some((r) => r.status === 'approved')) return null;
    const entries = await db.execute(sql`
      SELECT pt.project_id, pr.name AS project, coalesce(ow.display_name, ow.email) AS owner,
             pt.start_time, pt.end_time, pt.comment, sp.name AS subproject,
             EXTRACT(EPOCH FROM (pt.end_time - pt.start_time)) / 60 AS minutes
      FROM project_times pt
      LEFT JOIN projects pr ON pr.id = pt.project_id
      LEFT JOIN users ow ON ow.id = pr.owner_user_id
      LEFT JOIN subprojects sp ON sp.id = pt.subproject_id
      WHERE pt.organization_id = ${orgId} AND pt.user_id = ${userId}
        AND pt.start_time::date >= ${periodStart}::date AND pt.start_time::date < (${periodStart}::date + interval '1 month')
      ORDER BY pr.name NULLS LAST, pt.start_time`);
    const projects: ProjectReportPdfData['projects'] = [];
    for (const e of entries.rows as Record<string, unknown>[]) {
      const id = (e.project_id as string | null) ?? null;
      let p = projects.find((x) => (x as { id?: string | null }).id === id);
      if (!p) {
        const period = id ? byProject.get(id) : undefined;
        const status = ((period?.status as string | undefined) ?? 'open') as ProjectStatus;
        p = Object.assign(
          {
            project: (e.project as string | null) ?? null,
            owner: (e.owner as string | null) ?? null,
            status,
            approvedBy: status === 'approved' ? ((period?.reviewer as string | null) ?? null) : null,
            approvedAt: status === 'approved' ? iso(period?.reviewed_at as string | null) : null,
            submittedAt: iso((period?.submitted_at as string | null) ?? null),
            autoApproved: status === 'approved' && period?.reviewed_by_user_id === userId,
            entries: [],
          },
          { id },
        );
        projects.push(p);
      }
      p.entries.push({
        start: new Date(e.start_time as string).toISOString(),
        end: new Date(e.end_time as string).toISOString(),
        minutes: Math.round(Number(e.minutes)),
        subproject: (e.subproject as string | null) ?? null,
        comment: (e.comment as string | null) ?? null,
      });
    }
    const timeZone = await this.workTime.timeZone(db, userId);
    const buffer = await renderProjectReportPdf({ organization: owner.org_name, person: owner.person, periodStart, timeZone, projects }, pdfLang(owner.locale));
    return this.link(db, owner, 'project_timesheet', periodStart, null, buffer, actorUserId, { table: 'project_time_periods', id: [...byProject.keys()][0] });
  }
}
