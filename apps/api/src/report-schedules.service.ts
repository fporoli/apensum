import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { DocumentsService } from './documents.service';
import { NotificationsService } from './notifications.service';
import { ReportsService } from './reports.service';
import { renderReportPdf } from './report-pdf';
import { nextRunAt, zonedDate, type ScheduleRule } from './report-schedule';
import { pdfLang } from './timesheet-documents.service';
import { appBaseUrl } from './orgs.controller';
import { sendMail } from './mailer';
import { departments, projects, report_runs, report_schedules, saved_reports, static_data, teams, users } from './db/schema';
import { reportById, type ReportDefinition, type SavedReportSettings } from '@worktime3/shared/reports';
import { REPORT_TEXTS } from '@worktime3/shared/reportTexts';
import { buildReportTable, labelFor, periodText, presetRange, sortRows, staticDataLabelsOf, swissLocale, textsOf, type LabelSources, type Preset, type StaticLabels } from '@worktime3/shared/reportTable';
import { buildXlsx } from '@worktime3/shared/xlsx';

type Schedule = typeof report_schedules.$inferSelect;

/** How often the runner looks for due schedules. */
const TICK_MS = 60_000;
/** At most this many schedules per tick; the rest follow on the next. */
const BATCH = 10;

export function ruleOf(s: Pick<Schedule, 'frequency' | 'weekday' | 'month_day' | 'hour' | 'time_zone'>): ScheduleRule {
  return { frequency: s.frequency as ScheduleRule['frequency'], weekday: s.weekday, monthDay: s.month_day, hour: s.hour, timeZone: s.time_zone };
}

/** The period a run covers: a preset relative to the run's day in the schedule's zone, or fixed months. */
export function runPeriod(settings: SavedReportSettings, runDay: string): [string, string] {
  if (settings.preset === 'custom' && settings.from && settings.to) return [settings.from, settings.to];
  return presetRange((settings.preset === 'custom' ? 'lastMonth' : settings.preset) as Exclude<Preset, 'custom'>, runDay);
}

export interface RunOutcome {
  delivered: number;
  failed: number;
}

/**
 * Scheduled reports (065): a job runner in the API process plus the delivery of one run.
 *
 * Every minute the runner takes the due schedules and claims each by moving `next_run_at` on with
 * a conditional UPDATE, so with several API instances only one runs it. A run makes one file per
 * recipient, with that recipient's own rights (ReportsService.run) and in their language, stores
 * it in Documents (encrypted) as a `report_runs` row, and tells them by notification and e-mail
 * with a link, never the file. A recipient who may no longer see the report gets a run with the
 * error and no file. `REPORT_SCHEDULER=off` turns the runner off (e.g. on a second instance).
 */
@Injectable()
export class ReportSchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ReportSchedules');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.REPORT_SCHEDULER === 'off' || !this.db.getDb()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs what is due. Public for tests and for a manual nudge. */
  async tick(now = new Date()): Promise<void> { // real time: scheduled deliveries run in real time
    const db = this.db.getDb();
    if (!db || this.running) return;
    this.running = true;
    try {
      const due = await db
        .select()
        .from(report_schedules)
        .where(and(eq(report_schedules.is_active, true), lte(report_schedules.next_run_at, now.toISOString())))
        .orderBy(report_schedules.next_run_at)
        .limit(BATCH);
      for (const s of due) {
        const next = nextRunAt(ruleOf(s), now);
        const claimed = await db
          .update(report_schedules)
          .set({ next_run_at: next.toISOString(), last_run_at: now.toISOString() })
          .where(and(eq(report_schedules.id, s.id), eq(report_schedules.next_run_at, s.next_run_at)))
          .returning({ id: report_schedules.id });
        if (!claimed.length) continue; // another instance took it
        try {
          const out = await this.deliver(db, s, now);
          this.log.log(`schedule ${s.id}: ${out.delivered} delivered, ${out.failed} failed`);
        } catch (e) {
          this.log.warn(`schedule ${s.id} failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.log.warn(`tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One run of a schedule for all its recipients ("Run now" too). */
  async deliver(db: Db, schedule: Schedule, now = new Date()): Promise<RunOutcome> { // real time: scheduled deliveries run in real time
    const [saved] = await db.select().from(saved_reports).where(eq(saved_reports.id, schedule.saved_report_id));
    const def = saved ? reportById(saved.report_id) : undefined;
    if (!saved || !def) return { delivered: 0, failed: 0 };
    const settings = saved.settings as SavedReportSettings;
    const runDay = zonedDate(now, schedule.time_zone);
    const [from, to] = runPeriod(settings, runDay);
    const orgId = schedule.organization_id;
    const recipients = schedule.recipient_user_ids.length
      ? await db.execute(sql`
          SELECT u.id, u.email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = ${orgId} AND m.status = 'active' AND u.is_active
            AND u.id IN (${sql.join(schedule.recipient_user_ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
      : { rows: [] };
    const labels = await this.staticLabels(db, orgId, def);
    const filterNames = await this.filterNames(db, settings);
    const outcome: RunOutcome = { delivered: 0, failed: 0 };

    for (const r of recipients.rows as { id: string; email: string; locale: string | null }[]) {
      const lang = pdfLang(r.locale);
      const t = textsOf(REPORT_TEXTS[lang]);
      const runId = randomUUID();
      const result = await this.reports.run(db, orgId, r.id, def.id, {
        from,
        to,
        groupBy: settings.groupBy,
        userId: settings.userId,
        departmentId: settings.departmentId,
        teamId: settings.teamId,
        projectId: settings.projectId,
      });
      if (!result.ok) {
        outcome.failed++;
        await db.insert(report_runs).values({ id: runId, organization_id: orgId, schedule_id: schedule.id, user_id: r.id, title: saved.name, period_from: from, period_to: to, ran_at: now.toISOString(), error: result.error ?? 'failed' });
        continue;
      }
      const label = labelFor(def, lang, t, labels);
      const rows = sortRows(result.rows, result.groupBy, label, lang);
      const table = buildReportTable(def, { groupBy: result.groupBy, rows, totals: result.totals }, lang, t, label);
      const period = periodText(def, from, to, lang, t, runDay);
      const subtitle = [period, ...filterNames].join(' · ');
      const stamp = new Intl.DateTimeFormat(swissLocale(lang), { dateStyle: 'short', timeStyle: 'short', timeZone: schedule.time_zone }).format(now);
      const base = `${saved.name}-${from}${from === to ? '' : `-${to}`}`.replace(/[^\p{L}\p{N}-]+/gu, '-');
      const file =
        schedule.format === 'xlsx'
          ? { name: `${base}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(buildXlsx(saved.name, table.columns, table.cells, table.totalCells)) }
          : {
              name: `${base}.pdf`,
              mimeType: 'application/pdf',
              buffer: await renderReportPdf({
                title: saved.name,
                subtitle,
                footer: t('reports.pdf.footer', { date: stamp }),
                columns: table.columns.map((c) => ({ header: c.header, align: c.align })),
                rows: table.text,
                totals: table.totalText,
              }),
            };
      const documentId = await this.documents.store(db, orgId, saved.owner_user_id, file, { table: 'report_runs', id: runId });
      await db.insert(report_runs).values({ id: runId, organization_id: orgId, schedule_id: schedule.id, user_id: r.id, document_id: documentId, title: saved.name, period_from: from, period_to: to, ran_at: now.toISOString() });
      outcome.delivered++;

      const subject = t('reports.mail.subject', { name: saved.name });
      void this.notifications
        .notifyMany({ organizationId: orgId, recipientUserIds: [r.id], type: 'report.delivered', title: subject, body: period, sourceTable: 'report_runs', sourceTableUuid: runId, data: { documentId } })
        .catch(() => {});
      void sendMail({ to: r.email, subject, text: `${t('reports.mail.body', { name: saved.name, period })}\n\n${t('reports.mail.open')}: ${appBaseUrl()}/#/documents\n` }).catch(() => {});
    }
    return outcome;
  }

  /** The static data labels the report's dimensions need (absence types, ...): the organization's row, else the global one. */
  private async staticLabels(db: Db, orgId: string, def: ReportDefinition): Promise<LabelSources> {
    const wanted = staticDataLabelsOf(def);
    if (!wanted.length) return { static: {} };
    const rows = await db
      .select({ entity: static_data.entity, enum: static_data.enum_name, org: static_data.organization_id, values: static_data.values, translation: static_data.translation })
      .from(static_data)
      .where(and(inArray(static_data.enum_name, wanted.map((w) => w.enum)), or(isNull(static_data.organization_id), eq(static_data.organization_id, orgId))));
    const out: LabelSources = { static: {} };
    for (const w of wanted) {
      const mine = rows.filter((r) => r.entity === w.entity && r.enum === w.enum);
      const row = mine.find((r) => r.org === orgId) ?? mine[0];
      out.static[w.dim] = { translation: (row?.translation ?? {}) as StaticLabels['translation'], values: (row?.values ?? {}) as Record<string, string> };
    }
    return out;
  }

  /** The names of the saved filters, for the line under the title. */
  private async filterNames(db: Db, s: SavedReportSettings): Promise<string[]> {
    const out: string[] = [];
    if (s.userId) {
      const [u] = await db.select({ name: sql<string>`coalesce(nullif(${users.display_name}, ''), ${users.email})` }).from(users).where(eq(users.id, s.userId));
      if (u) out.push(u.name);
    }
    if (s.departmentId) {
      const [d] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, s.departmentId));
      if (d) out.push(d.name);
    }
    if (s.teamId) {
      const [tm] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, s.teamId));
      if (tm) out.push(tm.name);
    }
    if (s.projectId) {
      const [p] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, s.projectId));
      if (p) out.push(p.name);
    }
    return out;
  }
}
