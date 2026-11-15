import { Controller, Get } from '@nestjs/common';
import { Public } from './jwt.guard';

/** When this process started: lets scripts/wait-for-api.mjs tell a fresh API from a leftover one. */
const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString(), startedAt: STARTED_AT };
  }
}
