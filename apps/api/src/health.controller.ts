import { Controller, Get, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Db } from './db.service';
import { DbService } from './db.service';
import { Public } from './jwt.guard';
import { lastSmtpStatus } from './mailer';

/** When this process started: lets scripts/wait-for-api.mjs tell a fresh API from a leftover one. */
export const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

/**
 * A demo instance that starts over on a schedule (DEMO_RESET_EVERY_HOURS, set for the GitHub Environment
 * demo; .github/workflows/demo-reset.yml): the web app warns before a reset and waits through it. Only
 * whole hours that divide a day, else none.
 */
export function demoResetEveryHours(env: NodeJS.ProcessEnv = process.env): number | null {
  const hours = Number(env.DEMO_RESET_EVERY_HOURS);
  return Number.isInteger(hours) && hours >= 1 && hours <= 24 && 24 % hours === 0 ? hours : null;
}

/** The instances the app bar names (InstanceInfo.tsx); prod and an unset or unknown name show nothing. */
export const NAMED_INSTANCES = ['development', 'local', 'test', 'demo', 'preprod'] as const;

/**
 * Which instance this is, for the app bar's box on every instance but prod: INSTANCE (infra/vps/remote.sh sets the
 * GitHub Environment's name, scripts/with-env.mjs `development`/`local`, compose local `local`) and DEPLOYED_AT, when
 * remote.sh last deployed it (not a demo's reset; null in development and local, which are not deployed).
 */
export function instanceInfo(env: NodeJS.ProcessEnv = process.env): { name: (typeof NAMED_INSTANCES)[number]; deployedAt: string | null } | null {
  const name = (env.INSTANCE ?? '').trim().toLowerCase();
  if (!(NAMED_INSTANCES as readonly string[]).includes(name)) return null;
  const d = env.DEPLOYED_AT ? new Date(env.DEPLOYED_AT) : null;
  return { name: name as (typeof NAMED_INSTANCES)[number], deployedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null };
}

/**
 * Whether the database answers `SELECT 1` within `timeoutMs`; no database (offline mode) counts as not.
 * Nothing else is told: an outside monitor (docs/OPERATIONS.md "Monitoring") only sees ok or not.
 */
export async function databaseAnswers(db: Pick<Db, 'execute'> | null, timeoutMs = 3000): Promise<boolean> {
  if (!db) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([db.execute(sql`SELECT 1`).then(() => true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('health')
  health() {
    // smtp: the mail relay as last seen (startup check, then each send); details only in the log.
    const everyHours = demoResetEveryHours();
    return { status: 'ok', time: new Date().toISOString(), startedAt: STARTED_AT, smtp: lastSmtpStatus(), demoReset: everyHours ? { everyHours } : null, instance: instanceInfo() };
  }

  /** For outside monitors (HTTP status only): 200 while the database answers, else 503. */
  @Public()
  @Get('health/db')
  async database(@Res({ passthrough: true }) res: Response) {
    const ok = await databaseAnswers(this.db.getDb());
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'unavailable' };
  }
}
