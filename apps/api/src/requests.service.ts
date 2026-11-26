import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { resolveModules } from '@worktime3/shared/modules';
import { cleanDueDate } from '@worktime3/shared/requests';
import { DbService, type Db } from './db.service';
import type { Executor } from './access';
import { membershipManagerId } from './access';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { sendMail } from './mailer';
import { appBaseUrl } from './app-url';
import { localDate } from './work-time-model.service';
import { workflowParticipants } from './request-workflow';

/** Assignments in force today, one row per person of the organization. */
export function currentAssignments(orgId: string): SQL {
  return sql`SELECT DISTINCT ON (user_id) user_id, department_id, manager_user_id FROM employee_assignments
             WHERE organization_id = ${orgId} AND valid_from <= CURRENT_DATE
             ORDER BY user_id, valid_from DESC`;
}

/** What `handlerIds` needs of a request. */
export interface RequestTarget {
  organization_id: string;
  requester_user_id: string | null;
  target_kind: 'manager' | 'department' | 'workflow';
  target_department_id: string | null;
  id?: string;
}

/** A task a module or plugin opens (`RequestsService.openTask`). */
export interface SystemTaskInput {
  organizationId: string;
  /** The module or plugin id (e.g. 'hr'); shown as the sender. */
  source: string;
  /** The source's own key, unique per organization; it must start with the source id (e.g. 'hr:exit:<user>:<date>'). */
  key: string;
  /** The section of the web app that shows what the task is about (e.g. 'hr'). */
  section?: string | null;
  departmentId: string;
  subject: string;
  message: string;
  /** YYYY-MM-DD; after it, an open task alerts its handlers by e-mail. */
  dueDate?: string | null;
  /** Only the department sees it, not `nav.requests:edit:all`; notifications and alert mails carry neither subject nor text. */
  confidential?: boolean;
}

export type SystemTaskResult =
  | { ok: true; id: string; created: boolean; changed: boolean }
  | { ok: false; error: 'requests-off' | 'unknown-department' | 'invalid-task' };

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
/** How often the overdue alerts are looked for. */
const ALERT_TICK_MS = 10 * 60_000;

type Lang = 'en' | 'de' | 'fr' | 'it';
const OVERDUE: Record<Lang, { subject: string; body: string; due: string; open: string; title: string; confidential: string }> = {
  en: {
    subject: 'Overdue: {{subject}}',
    title: 'Overdue since {{date}}: {{subject}}',
    body: 'This flow was due on {{date}} and is still open:',
    confidential: 'Confidential flow',
    due: 'Due',
    open: 'Open',
  },
  de: {
    subject: 'Überfällig: {{subject}}',
    title: 'Überfällig seit {{date}}: {{subject}}',
    body: 'Dieser Flow war am {{date}} fällig und ist noch offen:',
    confidential: 'Vertraulicher Flow',
    due: 'Fällig',
    open: 'Öffnen',
  },
  fr: {
    subject: 'En retard : {{subject}}',
    title: 'En retard depuis le {{date}} : {{subject}}',
    body: 'Ce flow était dû le {{date}} et est toujours ouvert :',
    confidential: 'Flow confidentiel',
    due: 'Échéance',
    open: 'Ouvrir',
  },
  it: {
    subject: 'Scaduta: {{subject}}',
    title: 'Scaduta dal {{date}}: {{subject}}',
    body: 'Questo flow scadeva il {{date}} ed è ancora aperto:',
    confidential: 'Flow confidenziale',
    due: 'Scadenza',
    open: 'Apri',
  },
};
const SWISS: Record<Lang, string> = { en: 'en-CH', de: 'de-CH', fr: 'fr-CH', it: 'it-CH' };
const fill = (text: string, v: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => v[k] ?? '');
const langOf = (locale: string | null | undefined): Lang => {
  const l = (locale ?? '').slice(0, 2);
  return l === 'en' || l === 'fr' || l === 'it' ? l : 'de';
};

/**
 * What notifications call a request (their titles are English): a confidential one's subject never leaves
 * the request itself, as it can name a person and their sickness. Overdue alerts use `OVERDUE.confidential`.
 */
export function noticeSubject(r: { subject: string; confidential?: boolean }): string {
  return r.confidential ? OVERDUE.en.confidential : r.subject;
}

/** The overdue alert's mail in the recipient's language; a confidential request's without its subject. */
export function overdueMail(r: { subject: string; confidential?: boolean; due_date: string; id: string }, locale: string | null | undefined): { subject: string; text: string; title: string } {
  const lang = langOf(locale);
  const m = OVERDUE[lang];
  const date = new Date(`${r.due_date}T12:00:00Z`).toLocaleDateString(SWISS[lang], { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  const shown = r.confidential ? m.confidential : r.subject;
  const vars = { subject: shown, date };
  const link = `${appBaseUrl()}/#/requests?id=${r.id}`;
  return {
    subject: fill(m.subject, vars).slice(0, 250),
    title: fill(m.title, vars),
    text: `${fill(m.body, vars)}\n\n${shown}\n${m.due}: ${date}\n\n${m.open}: ${link}\n`,
  };
}

/**
 * Requests as tasks (module "requests"): who handles a request, the tasks modules and plugins open
 * (`openTask`/`closeTasks`, exported to plugins), and the e-mail alert when an open request's due
 * date has passed (a runner in the API, every 10 minutes; `REQUEST_ALERTS=off` turns it off, e.g. on
 * a second instance). An alert goes once per due date: changing the date arms it again.
 */
@Injectable()
export class RequestsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RequestsService');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
  ) {}

  onModuleInit(): void {
    if (process.env.REQUEST_ALERTS === 'off' || !this.db.getDb()) return;
    this.timer = setInterval(() => void this.alertOverdue(), ALERT_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Who handles `r` today (ids), not counting `nav.requests:edit:all`. */
  async handlerIds(db: Executor, r: RequestTarget): Promise<string[]> {
    // A request with a workflow: whoever its steps went or go to (not the requester).
    if (r.target_kind === 'workflow') return r.id ? (await workflowParticipants(db as Db, r.id)).filter((x) => x !== r.requester_user_id) : [];
    if (r.target_kind === 'manager') {
      if (!r.requester_user_id) return [];
      const manager = await membershipManagerId(db, r.organization_id, r.requester_user_id);
      return manager ? [manager] : [];
    }
    const rows = await db.execute(
      sql`SELECT a.user_id FROM (${currentAssignments(r.organization_id)}) a
            JOIN organization_memberships m ON m.organization_id = ${r.organization_id} AND m.user_id = a.user_id AND m.status = 'active'
            WHERE a.department_id = ${r.target_department_id}
          UNION
          SELECT leader_user_id FROM departments WHERE id = ${r.target_department_id} AND leader_user_id IS NOT NULL`,
    );
    return rows.rows.map((x: Record<string, unknown>) => x.user_id as string);
  }

  /** Whether the organization has the Requests module on. */
  async enabled(db: Executor, orgId: string): Promise<boolean> {
    const rows = (await db.execute(sql`SELECT settings -> 'modules' AS modules FROM organizations WHERE id = ${orgId}`)).rows as { modules: unknown }[];
    return rows.length > 0 && resolveModules(rows[0].modules).requests === true;
  }

  /**
   * Opens the task `key` of `source`, or brings an open one up to date (subject, message as an event,
   * due date). A task that was resolved or archived is left alone: it is not opened again. The
   * department's members and leader are notified of a new task.
   */
  async openTask(db: Db, input: SystemTaskInput): Promise<SystemTaskResult> {
    const subject = input.subject?.trim().slice(0, MAX_SUBJECT);
    const message = input.message?.trim().slice(0, MAX_BODY);
    const due = cleanDueDate(input.dueDate ?? null);
    if (!subject || !message || due === undefined || !/^[a-z][a-zA-Z0-9]*$/.test(input.source) || !input.key?.startsWith(input.source)) {
      return { ok: false, error: 'invalid-task' };
    }
    if (!(await this.enabled(db, input.organizationId))) return { ok: false, error: 'requests-off' };
    const department = await db.execute(
      sql`SELECT id FROM departments WHERE id = ${input.departmentId}::uuid AND organization_id = ${input.organizationId} AND is_active`,
    );
    if (department.rows.length === 0) return { ok: false, error: 'unknown-department' };

    const existing = (
      await db.execute(
        sql`SELECT id, subject, due_date::text AS due_date, status, archived_at, target_department_id FROM requests
            WHERE organization_id = ${input.organizationId} AND source_key = ${input.key}`,
      )
    ).rows as { id: string; subject: string; due_date: string | null; status: string; archived_at: string | null; target_department_id: string }[];
    const old = existing[0];
    if (old) {
      if (old.status === 'resolved' || old.archived_at) return { ok: true, id: old.id, created: false, changed: false };
      // Confidentiality follows the source's wish (also for tasks opened before it asked for it).
      await db.execute(sql`UPDATE requests SET confidential = ${input.confidential === true} WHERE id = ${old.id} AND confidential <> ${input.confidential === true}`);
      const changed = old.subject !== subject || old.due_date !== due || old.target_department_id !== input.departmentId;
      if (!changed) return { ok: true, id: old.id, created: false, changed: false };
      await db.execute(
        sql`UPDATE requests SET subject = ${subject}, due_date = ${due}::date, target_department_id = ${input.departmentId}::uuid, last_activity_at = now(),
              overdue_alerted_at = CASE WHEN due_date IS DISTINCT FROM ${due}::date THEN NULL ELSE overdue_alerted_at END
            WHERE id = ${old.id}`,
      );
      await db.execute(
        sql`INSERT INTO request_messages (request_id, author_user_id, kind, data)
            VALUES (${old.id}, NULL, 'event', ${JSON.stringify({ details: { due_date: due, subject } })}::jsonb)`,
      );
      void this.versions.record('requests', old.id, 'update_delta', null, { subject, due_date: due }).catch(() => {});
      return { ok: true, id: old.id, created: false, changed: true };
    }

    const inserted = (
      await db.execute(
        sql`INSERT INTO requests (organization_id, requester_user_id, target_kind, target_department_id, subject, due_date, source, source_key, source_section, confidential)
            VALUES (${input.organizationId}, NULL, 'department', ${input.departmentId}::uuid, ${subject}, ${due}::date, ${input.source}, ${input.key}, ${input.section ?? null},
                    ${input.confidential === true})
            ON CONFLICT (organization_id, source_key) WHERE source_key IS NOT NULL DO NOTHING
            RETURNING id`,
      )
    ).rows as { id: string }[];
    if (inserted.length === 0) {
      // Another run opened it at the same moment.
      const again = (await db.execute(sql`SELECT id FROM requests WHERE organization_id = ${input.organizationId} AND source_key = ${input.key}`)).rows as { id: string }[];
      return { ok: true, id: again[0]?.id ?? '', created: false, changed: false };
    }
    const id = inserted[0].id;
    await db.execute(sql`INSERT INTO request_messages (request_id, author_user_id, kind, body) VALUES (${id}, NULL, 'message', ${message})`);
    void this.versions.record('requests', id, 'insert', null, { source: input.source, source_key: input.key, subject, due_date: due, message }).catch(() => {});
    const handlers = await this.handlerIds(db, {
      organization_id: input.organizationId,
      requester_user_id: null,
      target_kind: 'department',
      target_department_id: input.departmentId,
    });
    await this.notifications
      .notifyMany({
        organizationId: input.organizationId,
        recipientUserIds: handlers,
        type: 'request.created',
        title: noticeSubject({ subject, confidential: input.confidential }),
        body: input.confidential ? undefined : message.slice(0, 200),
        sourceTable: 'requests',
        sourceTableUuid: id,
        data: { requestId: id },
      })
      .catch(() => {});
    return { ok: true, id, created: true, changed: true };
  }

  /**
   * Resolves the open tasks of `source` whose key is not in `keep` (what they were about is gone, e.g.
   * an absence shortened), only those due on or after `dueFrom` (past ones stay for the handlers).
   * Returns how many it resolved.
   */
  async closeTasks(db: Db, orgId: string, source: string, keep: readonly string[], dueFrom: string): Promise<number> {
    const keepList = `{${keep.map((k) => `"${k.replace(/["\\]/g, '')}"`).join(',')}}`;
    const closed = (
      await db.execute(
        sql`UPDATE requests SET status = 'resolved', resolved_at = now(), last_activity_at = now()
            WHERE organization_id = ${orgId} AND source = ${source} AND status <> 'resolved' AND archived_at IS NULL
              AND (due_date IS NULL OR due_date >= ${dueFrom}::date) AND NOT (source_key = ANY(${keepList}::text[]))
            RETURNING id`,
      )
    ).rows as { id: string }[];
    for (const r of closed) {
      await db.execute(
        sql`INSERT INTO request_messages (request_id, author_user_id, kind, data) VALUES (${r.id}, NULL, 'event', ${JSON.stringify({ status: 'resolved', obsolete: true })}::jsonb)`,
      );
      void this.versions.record('requests', r.id, 'update_delta', null, { status: 'resolved', obsolete: true }).catch(() => {});
    }
    return closed.length;
  }

  /**
   * Mails the handlers (the assignee, else everyone who handles it) of each open request whose due
   * date has passed in Zurich, once per due date, and notifies them.
   */
  async alertOverdue(now: Date = new Date()): Promise<number> {
    const db = this.db.getDb();
    if (!db || this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const today = localDate(now, 'Europe/Zurich');
      // Claim them first, so a second instance or the next tick never mails twice.
      const due = (
        await db.execute(
          sql`UPDATE requests SET overdue_alerted_at = now()
              WHERE due_date < ${today}::date AND overdue_alerted_at IS NULL AND status <> 'resolved' AND archived_at IS NULL
              RETURNING id, organization_id, requester_user_id, target_kind, target_department_id, assignee_user_id, subject, confidential, due_date::text AS due_date`,
        )
      ).rows as unknown as (RequestTarget & { id: string; assignee_user_id: string | null; subject: string; confidential: boolean; due_date: string })[];
      for (const r of due) {
        if (!(await this.enabled(db, r.organization_id))) continue;
        const recipients = r.assignee_user_id ? [r.assignee_user_id] : await this.handlerIds(db, r);
        if (recipients.length === 0) continue;
        const users = (
          await db.execute(
            sql`SELECT u.id, u.email, u.locale FROM users u
                JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ${r.organization_id} AND m.status = 'active'
                WHERE u.id IN (${sql.join(recipients.map((x) => sql`${x}`), sql`, `)})`,
          )
        ).rows as { id: string; email: string | null; locale: string | null }[];
        for (const u of users) {
          const mail = overdueMail(r, u.locale);
          await this.notifications
            .notifyMany({
              organizationId: r.organization_id,
              recipientUserIds: [u.id],
              type: 'request.overdue',
              title: mail.title,
              sourceTable: 'requests',
              sourceTableUuid: r.id,
              data: { requestId: r.id },
            })
            .catch(() => {});
          if (!u.email) continue;
          try {
            await sendMail({ to: u.email, subject: mail.subject, text: mail.text }, 15_000);
            sent++;
          } catch (err) {
            this.log.warn(`overdue alert for request ${r.id} to ${u.id} failed: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    } catch (err) {
      this.log.error(`overdue alerts failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
    return sent;
  }
}
