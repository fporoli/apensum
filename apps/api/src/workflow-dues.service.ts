import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { workingDaysSince } from '@worktime3/shared/workflowConfig';
import { DbService, type Db } from './db.service';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { sendMail } from './mailer';
import { appBaseUrl } from './app-url';
import { localDate } from './work-time-model.service';
import { API_PLUGINS } from './plugin-registrar';
import { PERMIT_EVENT } from './triggers';
import type { ApiPlugin } from './plugin';
import { WorkflowsService, stepNameValue, workflowHistory, type WorkflowEvent, type WorkflowStepDefinition } from './workflows.service';
import { clock, sqlNow } from './clock';

/** How often pending steps are looked at (deputies, reminders, escalations). */
const TICK_MS = 10 * 60_000;
/** How many days before a residence permit ends HR and the person are reminded. */
export const PERMIT_REMIND_DAYS = 60;
/** The organizations' day (absences, working days since a step started). */
const TIME_ZONE = 'Europe/Zurich';

type Lang = 'de' | 'fr' | 'it' | 'en';
const langOf = (locale: string | null | undefined): Lang => {
  const l = (locale ?? '').slice(0, 2);
  return l === 'en' || l === 'fr' || l === 'it' ? l : 'de';
};
const fill = (text: string, v: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => v[k] ?? '');

/**
 * The reminder's and the escalation's mail: the step's name only (`{{step}}`, with its quotes, or nothing when the
 * step has no name in the reader's language), nothing of the record (it may name a person).
 */
const MAIL: Record<Lang, { remind: string; remindBody: string; escalate: string; escalateBody: string; open: string; quote: (name: string) => string }> = {
  de: {
    remind: 'Erinnerung: Ein Flow wartet auf Ihren Schritt',
    remindBody: 'Ein Flow wartet seit {{days}} Arbeitstagen auf Ihren Schritt{{step}}.',
    escalate: 'Ein Flow wartet zu lange',
    escalateBody: 'Ein Flow wartet seit {{days}} Arbeitstagen auf den Schritt{{step}}. Er liegt jetzt auch bei Ihnen.',
    open: 'Öffnen',
    quote: (n) => ` «${n}»`,
  },
  fr: {
    remind: 'Rappel : un flow attend votre étape',
    remindBody: 'Un flow attend votre étape{{step}} depuis {{days}} jours ouvrables.',
    escalate: 'Un flow attend trop longtemps',
    escalateBody: 'Un flow attend l’étape{{step}} depuis {{days}} jours ouvrables. Il vous est maintenant aussi attribué.',
    open: 'Ouvrir',
    quote: (n) => ` « ${n} »`,
  },
  it: {
    remind: 'Promemoria: un flow attende il suo passo',
    remindBody: 'Un flow attende il suo passo{{step}} da {{days}} giorni lavorativi.',
    escalate: 'Un flow attende troppo a lungo',
    escalateBody: 'Un flow attende il passo{{step}} da {{days}} giorni lavorativi. Ora è assegnato anche a lei.',
    open: 'Apri',
    quote: (n) => ` «${n}»`,
  },
  en: {
    remind: 'Reminder: a flow is waiting for your step',
    remindBody: 'A flow has been waiting for your step{{step}} for {{days}} working days.',
    escalate: 'A flow is waiting too long',
    escalateBody: 'A flow has been waiting for the step{{step}} for {{days}} working days. It is now with you as well.',
    open: 'Open',
    quote: (n) => ` "${n}"`,
  },
};

/**
 * Who a pending step goes to while assignees are away: on a step one does for all, only when nobody of it is there,
 * the deputies of the absent ones join; on a step each does on their own, an absent one's deputy takes their place.
 * A deputy who is away too, already has the step, or (a decision) submitted it, does not. Null: nothing changes.
 */
export function withDeputies(p: {
  assignees: readonly string[];
  each: boolean;
  absent: ReadonlySet<string>;
  deputyOf: ReadonlyMap<string, string>;
  submittedBy?: string;
  decides: boolean;
}): { assignees: string[]; covered: { absent: string; deputy: string }[] } | null {
  const eligible = (absent: string, taken: readonly string[]) => {
    const d = p.deputyOf.get(absent);
    return d && !p.absent.has(d) && !taken.includes(d) && !(p.decides && d === p.submittedBy) ? d : null;
  };
  const covered: { absent: string; deputy: string }[] = [];
  let assignees = [...p.assignees];
  if (p.each) {
    for (const a of p.assignees) {
      if (!p.absent.has(a)) continue;
      const d = eligible(a, assignees);
      if (!d) continue;
      assignees = assignees.map((x) => (x === a ? d : x));
      covered.push({ absent: a, deputy: d });
    }
  } else if (p.assignees.length > 0 && p.assignees.every((a) => p.absent.has(a))) {
    for (const a of p.assignees) {
      const d = eligible(a, assignees);
      if (!d) continue;
      assignees.push(d);
      covered.push({ absent: a, deputy: d });
    }
  }
  return covered.length ? { assignees, covered } : null;
}

/** What is due for a step that started on `started` (its day), with the reminder and escalation done so far. */
export function dueNow(
  step: { remindDays?: number; escalateDays?: number },
  started: string,
  today: string,
  done: { reminded?: boolean; escalated?: boolean },
): { days: number; remind: boolean; escalate: boolean } {
  const days = workingDaysSince(started, today);
  const escalate = !!step.escalateDays && days >= step.escalateDays && !done.escalated;
  // An escalation includes the reminder: no reminder after it.
  const remind = !escalate && !!step.remindDays && days >= step.remindDays && !done.reminded && !done.escalated;
  return { days, remind, escalate };
}

interface PendingRow {
  id: string;
  organization_id: string;
  source_table: string;
  source_table_uuid: string;
  step: string;
  started: string;
  workflow_started: string | null;
  assignees: string[];
  data: Record<string, unknown> | null;
  steps: unknown;
}

/** `workflow_data.due`: the reminder and escalation done for the step that waits now (by its key and start). */
interface DueState { step: string; started: string; reminded?: boolean; escalated?: boolean }

/**
 * Flows don't stay put (a runner in the API, every 10 minutes; `REQUEST_ALERTS=off` turns it off with the Free Flows'
 * overdue alerts): open flows follow dated manager changes (the one look over all of them), a step whose assignees are away goes to their deputies (organization_memberships.deputy_user_id),
 * a step waiting its `remindDays` working days reminds them (bell and mail), and one waiting its `escalateDays` goes to
 * their managers as well (else to HR). Each is written into the flow's history.
 */
/** Whether the organization has an enabled trigger for a residence permit ending (Auslöser): its flows replace the reminder. */
export async function permitTriggered(db: Db, orgId: string): Promise<boolean> {
  const rows = (await db.execute(sql`SELECT 1 FROM flow_triggers WHERE organization_id = ${orgId}::uuid AND event = ${PERMIT_EVENT} AND enabled LIMIT 1`)).rows;
  return rows.length > 0;
}

@Injectable()
export class WorkflowDuesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WorkflowDuesService');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
    @Optional() @Inject(API_PLUGINS) private readonly plugins: readonly ApiPlugin[] = [],
  ) {}

  onModuleInit(): void {
    if (process.env.REQUEST_ALERTS === 'off' || !this.db.getDb()) return;
    this.timer = setInterval(() => void this.run(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the pending steps, and the permits that end soon; returns what it did. */
  async run(now: Date = clock.now()): Promise<{ deputies: number; reminded: number; escalated: number; permits: number }> {
    const done = { deputies: 0, reminded: 0, escalated: 0, permits: 0 };
    const db = this.db.getDb();
    if (!db || this.running) return done;
    this.running = true;
    try {
      const today = localDate(now, TIME_ZONE);
      // Dated manager changes that came into force: the lists and decisions only look at what concerns them.
      await this.workflowsSvc.rerouteToCurrentManagers(db).catch(() => 0);
      done.permits = await this.remindPermits(db, today).catch((err) => {
        this.log.warn(`permit reminders failed: ${err instanceof Error ? err.message : err}`);
        return 0;
      });
      const rows = (await db.execute(sql`
        SELECT w.workflow_id AS id, w.organization_id, w.source_table, w.source_table_uuid, w.step,
               w.workflow_step_started AS started, w.workflow_started, w.assigned_to_user_id AS assignees, w.workflow_data AS data,
               COALESCE(w.steps, d.steps) AS steps
        FROM workflows w JOIN workflow_definitions d ON d.workflow_def_id = w.workflow_def_id
        WHERE w.step_status = 'pending' AND w.organization_id IS NOT NULL AND w.workflow_step_started IS NOT NULL
          AND cardinality(w.assigned_to_user_id) > 0`)).rows as unknown as PendingRow[];
      if (rows.length === 0) return done;
      const people = [...new Set(rows.flatMap((r) => r.assignees ?? []))];
      const absent = await this.absentToday(db, people, today);
      const deputies = await this.deputies(db, [...new Set([...absent.values()].flatMap((s) => [...s]))]);
      for (const row of rows) {
        const steps = Array.isArray(row.steps) ? (row.steps as WorkflowStepDefinition[]) : [];
        const step = steps.find((s) => s.key === row.step);
        if (!step || step.automatic) continue;
        try {
          const r = await this.handle(db, row, step, { absent: absent.get(row.organization_id) ?? new Set(), deputyOf: deputies.get(row.organization_id) ?? new Map(), today });
          done.deputies += r.deputies;
          done.reminded += r.reminded ? 1 : 0;
          done.escalated += r.escalated ? 1 : 0;
        } catch (err) {
          this.log.warn(`flow ${row.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      this.log.error(`pending steps failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
    return done;
  }

  private async handle(
    db: Db,
    row: PendingRow,
    step: WorkflowStepDefinition,
    ctx: { absent: ReadonlySet<string>; deputyOf: ReadonlyMap<string, string>; today: string },
  ): Promise<{ deputies: number; reminded: boolean; escalated: boolean }> {
    const data = row.data ?? {};
    const submittedBy = typeof data.submittedByUserId === 'string' ? data.submittedByUserId : undefined;
    const startedAt = new Date(row.started).toISOString();
    const startedDay = localDate(row.started, TIME_ZONE);
    const prior = data.due as DueState | undefined;
    const due: DueState = prior && prior.step === row.step && prior.started === startedAt ? { ...prior } : { step: row.step, started: startedAt };
    const history: WorkflowEvent[] = workflowHistory(data, { started: row.workflow_started, finished: null, status: 'pending' });
    const at = clock.now().toISOString();
    let assignees = [...(row.assignees ?? [])];
    const notices: { to: string[]; key: string; vars: Record<string, unknown>; mail?: 'remind' | 'escalate' }[] = [];

    // 1. Away: the deputies.
    const covering = withDeputies({ assignees, each: !!step.each, absent: ctx.absent, deputyOf: ctx.deputyOf, submittedBy, decides: !!step.decides });
    if (covering) {
      assignees = covering.assignees;
      const names = await this.names(db, covering.covered.map((c) => c.absent));
      for (const c of covering.covered) history.push({ key: 'approvals.event.deputy', by: c.deputy, at, note: names.get(c.absent) ?? null });
      notices.push({ to: covering.covered.map((c) => c.deputy), key: 'notice.workflow.deputy', vars: {} });
    }

    // 2. Waiting: the reminder, the escalation.
    const now = dueNow(step, startedDay, ctx.today, due);
    if (now.remind) {
      due.reminded = true;
      history.push({ key: 'approvals.event.reminded', by: null, at });
      notices.push({ to: assignees, key: 'notice.workflow.reminder', vars: { days: now.days }, mail: 'remind' });
    }
    let escalated = false;
    if (now.escalate) {
      due.escalated = true;
      due.reminded = true;
      const above = (await this.escalationTargets(db, row.organization_id, assignees, ctx.today))
        .filter((id) => !assignees.includes(id) && !(step.decides && id === submittedBy));
      if (above.length) {
        assignees = [...assignees, ...above];
        escalated = true;
        history.push({ key: 'approvals.event.escalated', by: null, at });
        notices.push({ to: above, key: 'notice.workflow.escalated', vars: { days: now.days }, mail: 'escalate' });
      }
    }
    if (!covering && !now.remind && !now.escalate) return { deputies: 0, reminded: false, escalated: false };

    // Only while the step is still the one that was read (someone may have acted in between).
    const patch = { assigned_to_user_id: assignees, workflow_data: { ...data, history, due } };
    const updated = await db.execute(sql`
      UPDATE workflows SET assigned_to_user_id = ${`{${assignees.join(',')}}`}::uuid[], workflow_data = ${JSON.stringify(patch.workflow_data)}::jsonb
      WHERE workflow_id = ${row.id}::uuid AND step_status = 'pending' AND step = ${row.step} AND workflow_step_started = ${row.started}::timestamptz
      RETURNING workflow_id`);
    if (updated.rows.length === 0) return { deputies: 0, reminded: false, escalated: false };
    void this.versions.record('workflows', row.id, 'update_delta', null, patch).catch(() => {});

    const stepName = stepNameValue(step);
    for (const n of notices) {
      const to = [...new Set(n.to)];
      if (!to.length) continue;
      await this.notifications
        .notifyMany({
          organizationId: row.organization_id,
          recipientUserIds: to,
          type: 'workflow.assigned',
          title: n.key === 'notice.workflow.deputy' ? `A flow was passed on to you as deputy: ${step.label}` : n.key === 'notice.workflow.escalated' ? `A flow is waiting too long: ${step.label}` : `Reminder: a flow is waiting for your step: ${step.label}`,
          text: { key: n.key, vars: { step: stepName, ...(n.vars as Record<string, number>) } },
          sourceTable: row.source_table,
          sourceTableUuid: row.source_table_uuid,
          workflowId: row.id,
          data: { workflowId: row.id, sourceTable: row.source_table, sourceTableUuid: row.source_table_uuid },
        })
        .catch(() => {});
      if (n.mail) await this.mail(db, to, n.mail, step, now.days);
    }
    return { deputies: covering?.covered.length ?? 0, reminded: now.remind, escalated };
  }

  /**
   * A residence permit (My Data, `residencePermitValidUntil`) ending within PERMIT_REMIND_DAYS: the person and HR of
   * each organization they work in (`section.basicdata.personalien` edit on everyone) are told, by the bell and by
   * mail, once per end date (a notification of type `basicdata.permit` with that date is the mark).
   */
  private async remindPermits(db: Db, today: string): Promise<number> {
    const due = (await db.execute(sql`
      SELECT u.id AS user_id, coalesce(u.display_name, u.email) AS name, m.organization_id, u.basicdata->>'residencePermitValidUntil' AS until
      FROM users u JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
      WHERE u.basicdata->>'residencePermitValidUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND (u.basicdata->>'residencePermitValidUntil')::date BETWEEN ${today}::date AND ${today}::date + ${PERMIT_REMIND_DAYS}::int
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'basicdata.permit' AND n.organization_id = m.organization_id
                          AND n.source_table_uuid = u.id AND n.data->>'validUntil' = u.basicdata->>'residencePermitValidUntil')`)).rows as { user_id: string; name: string; organization_id: string; until: string }[];
    let sent = 0;
    // An organization whose trigger opens a flow for a permit ending (Auslöser, event permitExpires), or where a plugin
    // still says it reminds itself (the deprecated `permitReminders`), gets none from here.
    const pluginReminds = new Map<string, boolean>();
    const remindedByPlugin = async (orgId: string) => {
      if (!pluginReminds.has(orgId)) {
        const answers = await Promise.all(this.plugins.map((pl) => pl.permitReminders?.(db, orgId).catch(() => false) ?? false));
        pluginReminds.set(orgId, answers.some(Boolean) || (await permitTriggered(db, orgId)));
      }
      return pluginReminds.get(orgId)!;
    };
    for (const p of due) {
      if (await remindedByPlugin(p.organization_id)) continue;
      const date = p.until.split('-').reverse().join('.');
      const hr = ((await db.execute(sql`
        SELECT DISTINCT m.user_id FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id JOIN role_permissions rp ON rp.role_id = mr.role_id
        WHERE m.organization_id = ${p.organization_id}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
          AND rp.permission_id = 'section.basicdata.personalien:edit:all'`)).rows as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== p.user_id);
      const base = { organizationId: p.organization_id, type: 'basicdata.permit', sourceTable: 'basicdata', sourceTableUuid: p.user_id, data: { validUntil: p.until } };
      // The person's notification is the mark (once per end date): without it, no mail either, so none repeats.
      try {
        await this.notifications.notifyMany({ ...base, recipientUserIds: [p.user_id], title: `Your residence permit ends on ${date}`, text: { key: 'notice.basicdata.permitOwn', vars: { date } } });
      } catch (err) {
        this.log.warn(`permit reminder for ${p.user_id} failed: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      if (hr.length) await this.notifications.notifyMany({ ...base, recipientUserIds: hr, title: `The residence permit of ${p.name} ends on ${date}`, text: { key: 'notice.basicdata.permit', vars: { name: p.name, date } } }).catch(() => {});
      await this.permitMail(db, p.user_id, hr, p.name, date);
      sent++;
    }
    return sent;
  }

  /** The permit reminder's mail: to the person ("your permit"), to HR (whose). */
  private async permitMail(db: Db, personId: string, hr: string[], name: string, date: string): Promise<void> {
    const TEXT: Record<Lang, { own: string; other: string; body: string }> = {
      de: { own: 'Ihr Ausländerausweis läuft am {{date}} ab', other: 'Der Ausländerausweis von {{name}} läuft am {{date}} ab', body: 'Bitte rechtzeitig verlängern und das neue Ablaufdatum unter «Meine Daten» erfassen.' },
      fr: { own: 'Votre permis de séjour expire le {{date}}', other: 'Le permis de séjour de {{name}} expire le {{date}}', body: 'Merci de le renouveler à temps et de saisir la nouvelle date sous « Mes données ».' },
      it: { own: 'Il suo permesso di soggiorno scade il {{date}}', other: 'Il permesso di soggiorno di {{name}} scade il {{date}}', body: 'Per favore rinnovarlo in tempo e inserire la nuova data in «I miei dati».' },
      en: { own: 'Your residence permit ends on {{date}}', other: 'The residence permit of {{name}} ends on {{date}}', body: 'Please renew it in time and enter the new end date under "My Data".' },
    };
    const ids = [personId, ...hr];
    const users = (await db.execute(sql`SELECT id, email, locale FROM users WHERE id = ANY(${`{${ids.join(',')}}`}::uuid[])`)).rows as { id: string; email: string | null; locale: string | null }[];
    for (const u of users) {
      if (!u.email) continue;
      const m = TEXT[langOf(u.locale)];
      const subject = fill(u.id === personId ? m.own : m.other, { name, date });
      try {
        await sendMail({ to: u.email, subject, text: `${subject}.\n\n${m.body}\n\n${appBaseUrl()}\n` }, 15_000);
      } catch (err) {
        this.log.warn(`permit mail to ${u.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Per organization, who of `people` is away the whole of `today` (an approved absence, not a half day). */
  private async absentToday(db: Db, people: string[], today: string): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!people.length) return out;
    const rows = (await db.execute(sql`
      SELECT DISTINCT organization_id, user_id FROM absences
      WHERE status = 'approved' AND NOT half_day AND date_start <= ${today}::date AND date_end >= ${today}::date
        AND user_id = ANY(${`{${people.join(',')}}`}::uuid[])`)).rows as { organization_id: string; user_id: string }[];
    for (const r of rows) {
      if (!out.has(r.organization_id)) out.set(r.organization_id, new Set());
      out.get(r.organization_id)!.add(r.user_id);
    }
    return out;
  }

  /** Per organization, the deputy of each of `people` who has one that is an active member there. */
  private async deputies(db: Db, people: string[]): Promise<Map<string, Map<string, string>>> {
    const out = new Map<string, Map<string, string>>();
    if (!people.length) return out;
    const rows = (await db.execute(sql`
      SELECT m.organization_id, m.user_id, m.deputy_user_id FROM organization_memberships m
      JOIN organization_memberships dm ON dm.organization_id = m.organization_id AND dm.user_id = m.deputy_user_id
        AND dm.status = 'active' AND (dm.exit_at IS NULL OR dm.exit_at > ${sqlNow()})
      WHERE m.deputy_user_id IS NOT NULL AND m.user_id = ANY(${`{${people.join(',')}}`}::uuid[])`)).rows as { organization_id: string; user_id: string; deputy_user_id: string }[];
    for (const r of rows) {
      if (!out.has(r.organization_id)) out.set(r.organization_id, new Map());
      out.get(r.organization_id)!.set(r.user_id, r.deputy_user_id);
    }
    return out;
  }

  /** Who an escalation goes to: the assignees' managers today (active members), else HR (employment edit on all). */
  private async escalationTargets(db: Db, organizationId: string, assignees: string[], today: string): Promise<string[]> {
    const managers = (await db.execute(sql`
      SELECT DISTINCT a.manager_user_id AS user_id FROM employee_assignments a
      JOIN organization_memberships m ON m.organization_id = a.organization_id AND m.user_id = a.manager_user_id
        AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
      WHERE a.organization_id = ${organizationId}::uuid AND a.manager_user_id IS NOT NULL
        AND a.user_id = ANY(${`{${assignees.join(',')}}`}::uuid[])
        AND a.valid_from = (SELECT max(b.valid_from) FROM employee_assignments b
                            WHERE b.organization_id = a.organization_id AND b.user_id = a.user_id AND b.valid_from <= ${today}::date)`)).rows as { user_id: string }[];
    const ids = managers.map((r) => r.user_id).filter((id) => !assignees.includes(id));
    if (ids.length) return ids;
    const hr = (await db.execute(sql`
      SELECT DISTINCT m.user_id FROM organization_memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE m.organization_id = ${organizationId}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
        AND rp.permission_id = 'section.people.employment:edit:all'`)).rows as { user_id: string }[];
    return hr.map((r) => r.user_id);
  }

  private async names(db: Db, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = (await db.execute(sql`SELECT id, coalesce(display_name, email) AS name FROM users WHERE id = ANY(${`{${ids.join(',')}}`}::uuid[])`)).rows as { id: string; name: string }[];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The reminder's or the escalation's mail, in each recipient's language; best effort. */
  private async mail(db: Db, to: string[], kind: 'remind' | 'escalate', step: WorkflowStepDefinition, days: number): Promise<void> {
    const users = (await db.execute(sql`SELECT id, email, locale FROM users WHERE id = ANY(${`{${to.join(',')}}`}::uuid[])`)).rows as { id: string; email: string | null; locale: string | null }[];
    for (const u of users) {
      if (!u.email) continue;
      const lang = langOf(u.locale);
      const m = MAIL[lang];
      // The step's own name in the reader's language (English: also the blocks' names), else none.
      const name = (step.labels as Partial<Record<Lang, string>> | undefined)?.[lang]?.trim() || (lang === 'en' ? step.label : '');
      const vars = { step: name ? m.quote(name) : '', days: String(days) };
      const subject = `${kind === 'remind' ? m.remind : m.escalate}${name ? ` (${name})` : ''}`.slice(0, 250);
      const body = fill(kind === 'remind' ? m.remindBody : m.escalateBody, vars);
      try {
        await sendMail({ to: u.email, subject, text: `${body}\n\n${m.open}: ${appBaseUrl()}/#/flows\n` }, 15_000);
      } catch (err) {
        this.log.warn(`${kind} mail to ${u.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
