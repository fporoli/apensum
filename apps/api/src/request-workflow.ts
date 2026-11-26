import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { REQUEST_FORM, mergeForm, requestTypeForm } from '@worktime3/shared/fields';
import { requestTypeKeys } from '@worktime3/shared/requests';
import type { FactType, WorkflowKindCatalogue } from '@worktime3/shared/workflowConfig';
import type { Db } from './db.service';
import { DbService } from './db.service';
import { FieldsService } from './fields.service';
import { VersionsService } from './versions.service';
import { WorkflowsService, type WorkflowActionContext, type WorkflowKind } from './workflows.service';
import { sendMail } from './mailer';
import { workflowMail, type MailAnswer } from './workflow-mail';

/** The configurable kind of a request's workflow: one per request type (its key is the variant). */
export const REQUEST_WORKFLOW_KIND = 'requests.request';

/** Who a request's step may go to. */
const ASSIGNEES = [
  'manager', 'department', 'team', 'person',
  'permission:nav.requests', 'permission:section.people.employment', 'permission:nav.expensePayout',
];

/**
 * A request type's workflow (Admin settings -> Workflows, one per type): the steps a request of that type goes through
 * instead of one handler. `review` approves it or sends it back to the requester; `task` is work someone does
 * ("order in the web shop"); `form` asks the step's own fields (an amount, a date, ...), each assignee's answers kept
 * and shown in the thread. A step may go to one person, or to everyone of a team or department each on their own.
 * The facts its conditions test: urgency, type, the requester's department (its code)
 * and management flag, and the organization's own request fields (`field.<key>`).
 */
export const REQUEST_CATALOGUE: WorkflowKindCatalogue = {
  id: REQUEST_WORKFLOW_KIND,
  definitionName: 'request',
  rejectModes: ['none', 'back'],
  each: true,
  facts: { urgent: 'boolean', type: 'string', 'requester.department': 'string', 'requester.management': 'boolean' },
  blocks: {
    review: { label: 'Review', action: 'request.reviewed', returnAction: 'request.returned', assignees: ASSIGNEES, actionKey: 'requests.workflow.approve', decides: true },
    task: { label: 'Task', action: 'request.done', returnAction: 'request.returned', assignees: ASSIGNEES, actionKey: 'requests.workflow.done' },
    // Sent by the system the moment the workflow gets there (its own step, nobody acts on it): to the step's assignees.
    mail: { label: 'E-mail', action: 'request.mail', assignees: [...ASSIGNEES, 'requester'], automatic: true, message: true, doneKey: 'approvals.event.sent' },
    form: { label: 'Form', action: 'request.done', returnAction: 'request.returned', assignees: ASSIGNEES, actionKey: 'requests.workflow.submitForm', fields: true },
  },
  defaultConfig: {
    version: 1,
    steps: [{ key: 'handle', do: ['task'], assignTo: 'manager', reject: 'back', label: { de: 'Erledigen', fr: 'Traiter', it: 'Evadere', en: 'Handle' } }],
  },
  source: 'Request',
  source_name: 'getRequestTitle',
};

/** A fact's type for a field type of the request form. */
const FACT_OF_FIELD: Record<string, FactType> = { number: 'number', checkbox: 'boolean', text: 'string', date: 'string', datetime: 'string', select: 'string' };

/** A step's event in the request's thread (Requests.tsx shows `data.workflow`). */
async function threadEvent(db: Db, ctx: WorkflowActionContext, what: 'approved' | 'done' | 'returned' | 'finished' | 'resubmitted' | 'withdrawn' | 'mailed') {
  const data = {
    workflow: what,
    ...(ctx.stepKey ? { step: { key: ctx.stepKey, label: ctx.stepLabel ?? ctx.stepKey, ...(ctx.stepLabels ? { labels: ctx.stepLabels } : {}), ...(ctx.stepBlocks?.length ? { blocks: ctx.stepBlocks } : {}) } } : {}),
    ...(ctx.automatic && what !== 'mailed' ? { automatic: true } : {}),
    ...(what === 'mailed' ? { recipients: ctx.recipients?.length ?? 0 } : {}),
    ...(ctx.decisionNote ? { note: ctx.decisionNote } : {}),
    // A form step's answers, with their fields' labels and types, so the thread shows them as they were asked.
    ...(ctx.values && ctx.fields?.length
      ? { values: ctx.fields.filter((f) => ctx.values![f.key] !== undefined).map((f) => ({ key: f.key, type: f.type, label: f.label, value: ctx.values![f.key] })) }
      : {}),
    // Answers for the requester only: the thread shows them to the requester and their author (`visibleThread`).
    ...(ctx.values && ctx.fields?.length && ctx.privateAnswers ? { private: true } : {}),
  };
  await db.execute(sql`INSERT INTO request_messages (request_id, author_user_id, kind, data)
                       VALUES (${ctx.sourceTableUuid}::uuid, ${ctx.actorUserId}::uuid, 'event', ${JSON.stringify(data)}::jsonb)`);
}

/**
 * Registers the request's configurable workflow with the engine: its kind (one configuration per request type), what
 * its steps do to the request (status, thread events), its records for the Workflow page.
 */
@Injectable()
export class RequestWorkflow implements OnModuleInit {
  constructor(
    private readonly dbService: DbService,
    private readonly workflows: WorkflowsService,
    private readonly fields: FieldsService,
    private readonly versions: VersionsService,
  ) {}

  onModuleInit(): void {
    const kind: WorkflowKind = {
      catalogue: REQUEST_CATALOGUE,
      description: 'A request of a type with its own workflow: its steps, one after the other.',
      sourceTable: 'requests',
      facts: (db, id) => this.facts(db, id),
      variants: (db, orgId) => this.types(db, orgId),
      catalogueFor: (db, orgId, variant) => this.catalogue(orgId, variant),
      onFinished: async (db, id, actorUserId) => {
        await db.execute(sql`UPDATE requests SET status = 'resolved', resolved_at = now(), last_activity_at = now() WHERE id = ${id}::uuid`);
        await threadEvent(db, { sourceTable: 'requests', sourceTableUuid: id, actorUserId, decisionNote: null }, 'finished');
        void this.versions.record('requests', id, 'update_delta', actorUserId, { status: 'resolved' }).catch(() => {});
      },
    };
    this.workflows.registerKind(kind);
    // A step done moves an open request on; sending back opens it again for the requester.
    const moveOn = (what: 'approved' | 'done') => async (db: Db, ctx: WorkflowActionContext) => {
      await db.execute(sql`UPDATE requests SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, last_activity_at = now() WHERE id = ${ctx.sourceTableUuid}::uuid`);
      await threadEvent(db, ctx, what);
    };
    this.workflows.registerAction('request.reviewed', moveOn('approved'));
    this.workflows.registerAction('request.done', moveOn('done'));
    // A message step: the mail to its assignees (best effort: a failed mail never stops the workflow), then the thread.
    this.workflows.registerAction('request.mail', async (db, ctx) => {
      const recipients = ctx.recipients ?? [];
      if (!ctx.message || recipients.length === 0) return;
      const [r] = (await db.execute(sql`SELECT id, organization_id, subject, confidential, requester_user_id FROM requests WHERE id = ${ctx.sourceTableUuid}::uuid`)).rows as { id: string; organization_id: string; subject: string; confidential: boolean; requester_user_id: string | null }[];
      if (!r) return;
      const answers = ctx.message.answers && !r.confidential
        ? ((await db.execute(sql`
            SELECT COALESCE(u.display_name, u.email) AS name, m.data->'values' AS values, COALESCE((m.data->>'private')::boolean, false) AS private
            FROM request_messages m LEFT JOIN users u ON u.id = m.author_user_id
            WHERE m.request_id = ${r.id}::uuid AND m.kind = 'event' AND jsonb_typeof(m.data->'values') = 'array' ORDER BY m.posted_at`)).rows as unknown as (MailAnswer & { private: boolean })[])
        : [];
      const users = (await db.execute(sql`
        SELECT u.id, u.email, u.locale FROM users u
        JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ${r.organization_id}::uuid AND m.status = 'active'
        WHERE u.id = ANY(${`{${recipients.join(',')}}`}::uuid[])`)).rows as { id: string; email: string | null; locale: string | null }[];
      for (const u of users) {
        if (!u.email) continue;
        // Answers for the requester only go to the requester alone.
        const theirs = answers.filter((a) => !a.private || u.id === r.requester_user_id).map(({ private: _p, ...a }) => a);
        const mail = workflowMail({ message: ctx.message, request: { id: r.id, subject: r.subject, confidential: !!r.confidential }, answers: theirs }, u.locale);
        await sendMail({ to: u.email, subject: mail.subject, text: mail.text }, 15_000).catch((err) => console.warn(`workflow mail for request ${r.id} failed: ${err instanceof Error ? err.message : err}`));
      }
      await threadEvent(db, ctx, 'mailed');
    });
    this.workflows.registerAction('request.returned', async (db, ctx) => {
      await db.execute(sql`UPDATE requests SET status = 'open', resolved_at = NULL, last_activity_at = now() WHERE id = ${ctx.sourceTableUuid}::uuid`);
      await threadEvent(db, ctx, 'returned');
    });
    // The Workflow page's record: who asked and what (a confidential request's subject stays out).
    this.workflows.registerSourceRecords('requests', 'request', async (db, ids) => {
      if (ids.length === 0) return [];
      const rows = await db.execute(sql`
        SELECT r.id, r.requester_user_id AS user_id, COALESCE(u.display_name, u.email) AS user_display_name, u.email AS user_email,
               CASE WHEN r.confidential THEN NULL ELSE r.subject END AS subject, r.request_type, r.confidential
        FROM requests r LEFT JOIN users u ON u.id = r.requester_user_id
        WHERE r.id = ANY(${`{${ids.join(',')}}`}::uuid[])`);
      return rows.rows as Array<{ id: string } & Record<string, unknown>>;
    });
  }

  /** The organization's request types (the variants), with their labels per language. */
  private async types(db: Db, orgId: string): Promise<{ key: string; label: string; labels?: Record<string, string> }[]> {
    const rows = await db.execute(sql`
      SELECT "values", translation FROM static_data
      WHERE entity = 'requests' AND enum_name = 'request_type' AND (organization_id = ${orgId}::uuid OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1`);
    const row = rows.rows[0] as { values?: unknown; translation?: Record<string, Record<string, string>> } | undefined;
    return requestTypeKeys(row?.values).map((key) => {
      const labels = Object.fromEntries(Object.entries(row?.translation ?? {}).flatMap(([lang, t]) => (t?.[key] ? [[lang, t[key]]] : [])));
      return { key, label: labels.en ?? key, ...(Object.keys(labels).length ? { labels } : {}) };
    });
  }

  /** The catalogue with the request fields as facts (`field.<key>`): every request's and the type's own. */
  private async catalogue(orgId: string, type?: string): Promise<WorkflowKindCatalogue> {
    const common = (await this.fields.resolved(orgId, REQUEST_FORM.id)) ?? mergeForm(REQUEST_FORM);
    const typeDef = type ? requestTypeForm(type) : null;
    const own = typeDef ? (await this.fields.resolved(orgId, typeDef.id)) ?? mergeForm(typeDef) : null;
    const facts: Record<string, FactType> = { ...REQUEST_CATALOGUE.facts };
    for (const f of [...common.fields, ...(own?.fields ?? [])]) if (f.custom && !f.retired && FACT_OF_FIELD[f.type]) facts[`field.${f.key}`] = FACT_OF_FIELD[f.type];
    return { ...REQUEST_CATALOGUE, facts };
  }

  /** A request's facts for the steps' conditions. */
  private async facts(db: Db, id: string): Promise<Record<string, unknown>> {
    const rows = await db.execute(sql`
      SELECT r.urgent, r.request_type, r.custom,
        (SELECT d.code FROM employee_assignments a JOIN departments d ON d.id = a.department_id
          WHERE a.organization_id = r.organization_id AND a.user_id = r.requester_user_id AND a.valid_from <= CURRENT_DATE
          ORDER BY a.valid_from DESC LIMIT 1) AS department,
        COALESCE((SELECT a.is_management FROM employee_assignments a
          WHERE a.organization_id = r.organization_id AND a.user_id = r.requester_user_id AND a.valid_from <= CURRENT_DATE
          ORDER BY a.valid_from DESC LIMIT 1), false) AS management
      FROM requests r WHERE r.id = ${id}::uuid`);
    const r = rows.rows[0] as { urgent: boolean; request_type: string | null; custom: Record<string, unknown> | null; department: string | null; management: boolean } | undefined;
    if (!r) return {};
    const facts: Record<string, unknown> = { urgent: !!r.urgent, 'requester.management': !!r.management };
    if (r.request_type) facts.type = r.request_type;
    if (r.department) facts['requester.department'] = r.department;
    for (const [key, value] of Object.entries(r.custom ?? {})) {
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') facts[`field.${key}`] = value;
    }
    return facts;
  }
}

/**
 * Who takes part in a workflow request's steps: whoever its pending step waits for, and whoever already acted on it.
 * They see the request and its thread (like a request's handlers).
 */
/**
 * The thread as `callerId` may read it: a form step's answers for the requester only (`data.private`) are left out
 * for everyone but the requester and whoever gave them (the event stays: that they answered).
 */
export function visibleThread<M extends { author_user_id?: unknown; data?: unknown }>(messages: M[], callerId: string, requesterId: string | null): M[] {
  if (callerId === requesterId) return messages;
  return messages.map((m) => {
    const data = m.data as Record<string, unknown> | null | undefined;
    if (!data?.private || !('values' in data) || m.author_user_id === callerId) return m;
    const { values: _values, ...rest } = data;
    return { ...m, data: rest };
  });
}

export async function workflowParticipants(db: Db, requestId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT unnest(w.assigned_to_user_id) AS user_id FROM workflows w
    WHERE w.source_table = 'requests' AND w.source_table_uuid = ${requestId}::uuid AND w.step_status = 'pending'
    UNION
    SELECT DISTINCT (e->>'by')::uuid FROM workflows w, jsonb_array_elements(COALESCE(w.workflow_data->'history', '[]'::jsonb)) e
    WHERE w.source_table = 'requests' AND w.source_table_uuid = ${requestId}::uuid AND e->>'by' IS NOT NULL`);
  return (rows.rows as { user_id: string | null }[]).map((r) => r.user_id).filter((x): x is string => !!x);
}
