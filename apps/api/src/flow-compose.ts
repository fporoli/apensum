// "Write an e-mail" (a flow type's block `compose`): whoever does the step writes an e-mail from the step's template
// (the designer's subject and text per language, with placeholders) to whom the step names (`mailTo`): the person the
// flow is about, who started it, or that person's manager. The draft is filled here; the person may change it before
// sending. The mail goes out from the app's address with Reply-To the sender, without a link (the recipient may not
// see the flow); the step is done only after it went out (WorkflowsService.resolve: `mail-not-sent`).
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fillPlaceholders, messageText, type MailTo } from '@worktime3/shared/workflowConfig';
import { composeLang, composeMailText, composeValues } from './flow-compose-text';
// The pure parts (texts, placeholders), also used by the automatic mail (flow-steps.ts) without this service's imports.
export { composeDate, composeLang, composeMailText, composeValues, filledMessage } from './flow-compose-text';
import { actingManagerId } from './access';
import { AuditService } from './audit.service';
import { sqlNow } from './clock';
import type { Db } from './db.service';
import { parseForward, type ForwardInput } from './forward-mail.service';
import { sendMail } from './mailer';
import { WorkflowsService } from './workflows.service';

/** The copies of a written e-mail: active members' ids, at most 10, none of them also a recipient; null = invalid. */
export function parseCc(raw: unknown, to: readonly string[]): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))) return null;
  const ids = [...new Set(raw as string[])].filter((id) => !to.includes(id));
  return ids.length > 10 ? null : ids;
}

interface FlowRow {
  id: string;
  organization_id: string;
  subject: string;
  confidential: boolean;
  requester_user_id: string | null;
  about_user_id: string | null;
  task_data: Record<string, unknown> | null;
}
interface Person { id: string; name: string; email: string | null; locale: string | null; first_name: string | null }

@Injectable()
export class FlowComposeService {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly audit: AuditService,
  ) {}

  /** The flow's pending step with `compose` that waits for the caller, or an error. */
  private async step(db: Db, orgId: string, flowId: string, callerId: string) {
    const rows = (await db.execute(sql`
      SELECT w.workflow_id AS id FROM workflows w
      WHERE w.source_table = 'flows' AND w.source_table_uuid = ${flowId}::uuid AND w.organization_id = ${orgId}::uuid AND w.step_status = 'pending'
      ORDER BY w.workflow_started DESC NULLS LAST LIMIT 1`)).rows as { id: string }[];
    const pending = rows[0] ? await this.workflows.pendingStep(db, rows[0].id) : null;
    if (!pending?.step.compose) return { ok: false as const, error: 'no-compose-step' };
    if (!pending.assignees.includes(callerId)) return { ok: false as const, error: 'forbidden' };
    if (pending.step.takeOver && pending.assignees.length > 1) return { ok: false as const, error: 'take-first' };
    const [flow] = (await db.execute(sql`
      SELECT id, organization_id, subject, confidential, requester_user_id, about_user_id, task_data FROM flows WHERE id = ${flowId}::uuid AND organization_id = ${orgId}::uuid`)).rows as unknown as FlowRow[];
    if (!flow) return { ok: false as const, error: 'not-found' };
    return { ok: true as const, pending, flow };
  }

  private async people(db: Db, orgId: string, ids: (string | null)[]): Promise<Person[]> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length === 0) return [];
    const rows = (await db.execute(sql`
      SELECT u.id, COALESCE(u.display_name, u.email) AS name, u.email, u.locale, u.first_name FROM users u
      JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = ${orgId}::uuid AND m.status = 'active'
      WHERE u.id = ANY(${`{${wanted.join(',')}}`}::uuid[])`)).rows as unknown as Person[];
    return wanted.map((id) => rows.find((r) => r.id === id)).filter((p): p is Person => !!p);
  }

  /** Whom the step's e-mail goes to by its `mailTo`, and the others to choose from (about, requester, manager). */
  private async recipients(db: Db, orgId: string, flow: FlowRow, mailTo: MailTo) {
    const about = flow.about_user_id ?? flow.requester_user_id;
    const manager = about ? await actingManagerId(db, orgId, about) : null;
    // `choose`: nobody set, the writer picks from the organization (the others are suggested).
    const byRole: Record<MailTo, string | null> = { about, requester: flow.requester_user_id, aboutManager: manager, choose: null };
    const people = await this.people(db, orgId, [byRole[mailTo], about, flow.requester_user_id, manager]);
    return { to: people.filter((p) => p.id === byRole[mailTo]), suggested: people, aboutId: about };
  }

  /** The draft: the template filled in the recipient's language (else the sender's), to whom the step names. */
  async draft(db: Db, orgId: string, flowId: string, callerId: string) {
    const found = await this.step(db, orgId, flowId, callerId);
    if (!found.ok) return found;
    const { pending, flow } = found;
    const { to, suggested, aboutId } = await this.recipients(db, orgId, flow, pending.step.mailTo ?? 'about');
    const [sender] = await this.people(db, orgId, [callerId]);
    const about = suggested.find((p) => p.id === aboutId) ?? null;
    const lang = composeLang(to[0]?.locale ?? sender?.locale);
    const values = composeValues({
      aboutName: about?.name ?? null, aboutFirstName: about?.first_name ?? null, subject: flow.subject, confidential: flow.confidential,
      taskData: flow.task_data, senderName: sender?.name ?? '',
    }, lang);
    const message = pending.step.message;
    return {
      ok: true as const,
      subject: fillPlaceholders(messageText(message?.subject, lang), values),
      text: fillPlaceholders(messageText(message?.text, lang), values),
      to: to.map((p) => ({ id: p.id, name: p.name, email: p.email ?? '' })),
      suggested: suggested.map((p) => ({ id: p.id, name: p.name, email: p.email ?? '' })),
      sent: !!(pending.data.composed as Record<string, unknown> | undefined)?.[pending.step.key],
    };
  }

  /**
   * Sends the step's e-mail (`{ userIds, subject, message, ccUserIds? }`, as "Send by e-mail" takes it, with copies)
   * to active members of the organization with Reply-To the sender, and records that it went out: the thread and the
   * workflow say so (how many, never what). Without Cc each gets their own mail (a mail that fails is reported, the
   * others still go); with Cc it is one mail, everyone sees whom it went to (e.g. HR's lead in copy).
   */
  async send(db: Db, orgId: string, flowId: string, callerId: string, body: ForwardInput & { ccUserIds?: unknown }) {
    const found = await this.step(db, orgId, flowId, callerId);
    if (!found.ok) return found;
    const parsed = parseForward(body ?? {});
    if (!parsed.ok) return parsed;
    const ccIds = parseCc(body?.ccUserIds, parsed.userIds);
    if (!ccIds) return { ok: false as const, error: 'invalid-cc' };
    const recipients = await this.people(db, orgId, parsed.userIds);
    if (recipients.length !== parsed.userIds.length) return { ok: false as const, error: 'unknown-recipient' };
    const copies = await this.people(db, orgId, ccIds);
    if (copies.length !== ccIds.length) return { ok: false as const, error: 'unknown-recipient' };
    const [sender] = await this.people(db, orgId, [callerId]);
    if (!sender?.email) return { ok: false as const, error: 'forbidden' };
    let sent = 0;
    const mail = { replyTo: sender.email, subject: parsed.subject, text: composeMailText(parsed.message) };
    if (copies.length) {
      const to = recipients.map((r) => r.email).filter((e): e is string => !!e);
      const cc = copies.map((r) => r.email).filter((e): e is string => !!e);
      try {
        if (to.length) {
          await sendMail({ ...mail, to, cc }, 15_000);
          sent = to.length + cc.length;
        }
      } catch (err) {
        console.warn(`compose mail with cc failed: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      for (const r of recipients) {
        if (!r.email) continue;
        try {
          await sendMail({ ...mail, to: r.email }, 15_000);
          sent++;
        } catch (err) {
          console.warn(`compose mail failed after ${sent} of ${recipients.length}: ${err instanceof Error ? err.message : err}`);
          break;
        }
      }
    }
    if (sent === 0) return { ok: false as const, error: 'mail-failed' };
    const { pending } = found;
    await this.workflows.markComposed(db, pending.id, pending.step.key, callerId, sent);
    await db.execute(sql`INSERT INTO flow_messages (flow_id, author_user_id, kind, data, posted_at)
      VALUES (${flowId}::uuid, ${callerId}::uuid, 'event', ${JSON.stringify({ workflow: 'composed', recipients: sent, step: { key: pending.step.key, label: pending.step.label, ...(pending.step.labels ? { labels: pending.step.labels } : {}) } })}::jsonb, ${sqlNow()})`);
    void this.audit.record(orgId, callerId, 'flow.compose-mail', 'flow', flowId, { recipients: sent }).catch(() => {});
    return { ok: true as const, sent, failed: Math.max(0, recipients.length + copies.length - sent) };
  }
}
