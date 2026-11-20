import { Controller, Get } from '@nestjs/common';
import { Public } from './jwt.guard';
import { lastSmtpStatus } from './mailer';

/** When this process started: lets scripts/wait-for-api.mjs tell a fresh API from a leftover one. */
const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

/**
 * A demo instance that starts over on a schedule (DEMO_RESET_EVERY_HOURS, set for the GitHub Environment
 * demo; .github/workflows/demo-reset.yml): the web app warns before a reset and waits through it. Only
 * whole hours that divide a day, else none.
 */
export function demoResetEveryHours(env: NodeJS.ProcessEnv = process.env): number | null {
  const hours = Number(env.DEMO_RESET_EVERY_HOURS);
  return Number.isInteger(hours) && hours >= 1 && hours <= 24 && 24 % hours === 0 ? hours : null;
}

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    // smtp: the mail relay as last seen (startup check, then each send); details only in the log.
    const everyHours = demoResetEveryHours();
    return { status: 'ok', time: new Date().toISOString(), startedAt: STARTED_AT, smtp: lastSmtpStatus(), demoReset: everyHours ? { everyHours } : null };
  }
}
