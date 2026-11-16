import { Controller, Get } from '@nestjs/common';
import { Public } from './jwt.guard';
import { lastSmtpStatus } from './mailer';

/** When this process started: lets scripts/wait-for-api.mjs tell a fresh API from a leftover one. */
const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    // smtp: the mail relay as last seen (startup check, then each send); details only in the log.
    return { status: 'ok', time: new Date().toISOString(), startedAt: STARTED_AT, smtp: lastSmtpStatus() };
  }
}
