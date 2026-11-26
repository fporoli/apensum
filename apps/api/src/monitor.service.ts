import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { DbService } from './db.service';
import { DOCUMENTS_ROOT } from './documents.service';
import { lastSmtpStatus, sendMail } from './mailer';
import { pushToOperator } from './operator-push';
import { NotificationsService } from './notifications.service';

/**
 * The inside monitor: what only the server knows, checked every hour (MONITOR=off disables it) and told to the
 * operators (members of the Admin organization) by mail and as a notification there, each finding at most once
 * a day. Whether the instance answers at all is the outside monitor's (.github/workflows/monitor.yml).
 */

export const MONITOR_EVERY_MS = 60 * 60 * 1000;
/** Free disk space below which it is reported: either limit. */
export const DISK_MIN_FREE_RATIO = 0.1;
export const DISK_MIN_FREE_BYTES = 2 * 1024 ** 3;

export interface MonitorFacts {
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  smtp: 'unknown' | 'ok' | 'failed';
}

export interface Finding { id: 'disk' | 'mail'; text: Record<'en' | 'de', string> }

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/** What is wrong, from the facts (pure). */
export function findings(f: MonitorFacts): Finding[] {
  const out: Finding[] = [];
  if (f.diskFreeBytes !== null && f.diskTotalBytes) {
    const ratio = f.diskFreeBytes / f.diskTotalBytes;
    if (ratio < DISK_MIN_FREE_RATIO || f.diskFreeBytes < DISK_MIN_FREE_BYTES) {
      out.push({
        id: 'disk',
        text: {
          en: `Disk space is low: ${gb(f.diskFreeBytes)} free of ${gb(f.diskTotalBytes)} (${Math.round(ratio * 100)} %).`,
          de: `Der Speicherplatz wird knapp: ${gb(f.diskFreeBytes)} frei von ${gb(f.diskTotalBytes)} (${Math.round(ratio * 100)} %).`,
        },
      });
    }
  }
  if (f.smtp === 'failed') {
    out.push({
      id: 'mail',
      text: {
        en: 'Sending mail fails (see the API log). Notifications reach people in the app only.',
        de: 'Der Mailversand schlägt fehl (siehe API-Log). Benachrichtigungen erreichen die Leute nur in der App.',
      },
    });
  }
  return out;
}

/** The disk the documents are on (in the API container: the documents volume). */
export async function diskFacts(path = DOCUMENTS_ROOT): Promise<Pick<MonitorFacts, 'diskFreeBytes' | 'diskTotalBytes'>> {
  try {
    const s = await statfs(path);
    return { diskFreeBytes: s.bavail * s.bsize, diskTotalBytes: s.blocks * s.bsize };
  } catch {
    return { diskFreeBytes: null, diskTotalBytes: null };
  }
}

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Monitor');
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  /** `${finding}:${day}` already told today. */
  private readonly told = new Set<string>();

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.MONITOR === 'off' || !this.db.getDb()) return;
    // A first look a few minutes after the start (the mail relay has been tried by then), then every hour.
    this.first = setTimeout(() => void this.run(), 5 * 60 * 1000);
    this.timer = setInterval(() => void this.run(), MONITOR_EVERY_MS);
    this.first.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  /** One round; `facts` only in tests (else this server's disk and mail relay). */
  async run(now = new Date(), facts?: MonitorFacts): Promise<Finding[]> {
    const found = findings(facts ?? { ...(await diskFacts()), smtp: lastSmtpStatus() });
    const day = now.toISOString().slice(0, 10);
    const fresh = found.filter((f) => !this.told.has(`${f.id}:${day}`));
    for (const f of fresh) {
      this.told.add(`${f.id}:${day}`);
      this.logger.warn(f.text.en);
      await this.tell(f).catch((err) => this.logger.error(`could not tell the operators: ${err instanceof Error ? err.message : err}`));
    }
    return fresh;
  }

  private async tell(f: Finding) {
    // On the operator's phone too (operator-push.ts), also when the mail relay is what fails.
    void pushToOperator({ title: f.text.de.split(':')[0].replace(/\.$/, ''), message: f.text.de, tags: ['warning'], priority: 4 });
    const db = this.db.getDb();
    if (!db) return;
    const operators = (
      await db.execute(sql`
        SELECT u.id, u.email::text AS email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ${OPERATOR_ORG_ID} AND m.status = 'active' AND u.status = 'active'`)
    ).rows as { id: string; email: string; locale: string | null }[];
    for (const o of operators) {
      const text = (o.locale ?? 'de').startsWith('de') ? f.text.de : f.text.en;
      if (f.id !== 'mail') await sendMail({ to: o.email, subject: `Apensum: ${text.split(':')[0]}`, text: `${text}\n` }).catch(() => {});
      await this.notifications.notifyMany({
        organizationId: OPERATOR_ORG_ID,
        recipientUserIds: [o.id],
        type: `operator.monitor.${f.id}`,
        title: text.split(':')[0].replace(/\.$/, ''),
        body: text,
        sourceTable: 'operator_monitor',
        sourceTableUuid: OPERATOR_ORG_ID,
      });
    }
  }
}
