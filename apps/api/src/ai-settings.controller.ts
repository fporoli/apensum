import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Param, Put, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { parseAiSettings, validateAiSettings } from '@worktime3/shared/ai';
import { AiBudgetService, azureAllowed, instanceBudgetChf } from './ai-budget.service';
import { callerUserId, can, isOperator } from './access';
import { DbService, type Db } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';

/**
 * The organization's limit for paid cloud AI calls and this month's spend (Organization settings ->
 * AI and costs; organizations.settings.ai, packages/shared/src/ai.ts). It covers every AI function
 * that goes through AiBudgetService (Cases, the expenses plugin's receipt reading, ...). Whoever sees
 * Organization settings sees it; only an operator changes it and sees the whole instance's
 * spend, since the instance owner pays the Azure bill.
 */
@Controller('organizations/:orgId/ai-settings')
export class AiSettingsController {
  constructor(
    private readonly dbService: DbService,
    private readonly budget: AiBudgetService,
    private readonly versions: VersionsService,
  ) {}

  private get db(): Db {
    const d = this.dbService.getDb();
    if (!d) throw new ServiceUnavailableException('db-unavailable');
    return d;
  }

  private async caller(req: AuthenticatedRequest): Promise<string> {
    const id = req.user ? await callerUserId(this.db, req.user) : null;
    if (!id) throw new UnauthorizedException('unauthenticated');
    return id;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async get(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const callerId = await this.caller(req);
    const operator = await isOperator(this.db, callerId);
    if (!operator && !(await can(this.db, orgId, callerId, 'nav.orgSettings', 'see'))) throw new ForbiddenException('forbidden');
    const rows = await this.db.execute(sql`SELECT settings->'ai' AS ai FROM organizations WHERE id = ${orgId}::uuid`);
    const totals = await this.budget.totals(orgId);
    return {
      ok: true,
      settings: parseAiSettings((rows.rows[0] as { ai?: unknown } | undefined)?.ai),
      azure: azureAllowed(),
      canConfigure: operator,
      usage: {
        orgSpentChf: totals.orgSpentChf,
        orgCalls: totals.orgCalls,
        ...(operator ? { instanceSpentChf: totals.instanceSpentChf, instanceBudgetChf: instanceBudgetChf() } : {}),
      },
    };
  }

  @Put()
  async put(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const callerId = await this.caller(req);
    if (!(await isOperator(this.db, callerId))) throw new ForbiddenException('forbidden');
    const checked = validateAiSettings(body);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.db.execute(sql`
      UPDATE organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}', COALESCE(settings->'ai', '{}'::jsonb) || ${JSON.stringify(checked.value)}::jsonb)
      WHERE id = ${orgId}::uuid
    `);
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { ai: checked.value } }).catch(() => {});
    return { ok: true, settings: checked.value };
  }
}
