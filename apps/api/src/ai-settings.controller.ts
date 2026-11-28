import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Logger, Param, Put, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AI_LEVELS, SWISS_REGION, parseAiSettings, validateAiSettings, validateOwnAzure, type AiOwnAzure } from '@worktime3/shared/ai';
import { AiBudgetService, azureAllowed, completionTokens, instanceBudgetChf, instanceLevels } from './ai-budget.service';
import { azureOpenAiClient } from './ai-client';
import { currentMasterKey, sealSecret } from './document-crypto';
import { callerUserId, can, isOperator } from './access';
import { DbService, type Db } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';

/**
 * The organization's limit for paid cloud AI calls and this month's spend (Organization settings ->
 * AI and costs; organizations.settings.ai, packages/shared/src/ai.ts). It covers every AI function
 * that goes through AiBudgetService (Cases, the expenses plugin's receipt reading, ...). Whoever sees
 * Organization settings sees it; only an operator changes it and sees the whole instance's
 * spend, since the instance owner pays the Azure bill. The operator also sets the highest level the organization
 * may use (`maxLevel`, AI_LEVELS).
 * The organization's own Azure resource (`own`, PUT/DELETE own): whoever edits Organization settings enters its
 * endpoint, deployments and key; the server tries each deployment once and keeps it only when Azure answers from
 * Switzerland (x-ms-region). Its calls are billed to the organization and do not count against either budget.
 */
/** Characters of an Azure key accepted. */
const OWN_KEY_CHARS = 200;

/** The last four characters of a key, shown to tell keys apart (an Azure key has 32 or more). */
export function keyHint(key: string): string | null {
  return key.length >= 16 ? key.slice(-4) : null;
}

/**
 * Tries one deployment of an own resource with a tiny request (billed to the organization): the region Azure
 * answered from, or the error code. Pure apart from the call; the key is never logged.
 */
export async function probeOwnDeployment(endpoint: string, key: string, deployment: string, reasoning: boolean): Promise<{ region: string } | { error: string }> {
  const client = azureOpenAiClient({ endpoint, baseURL: `${endpoint}/openai/v1/`, key, deployment }, 30_000);
  try {
    const { response } = await client.chat.completions.create({
      model: deployment, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: completionTokens(16, reasoning ? 'low' : null),
      ...(reasoning ? { reasoning_effort: 'low' as const } : {}),
    }).withResponse();
    return { region: response.headers.get('x-ms-region') ?? '' };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return { error: 'ai-own-key-invalid' };
    if (status === 404) return { error: 'ai-own-deployment-missing' };
    if (status === 400) return { error: 'ai-own-deployment-refused' };
    return { error: 'ai-own-unreachable' };
  }
}
@Controller('organizations/:orgId/ai-settings')
export class AiSettingsController {
  private readonly logger = new Logger('AiSettings');

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
      // The levels this organization can use now, and (for the operator's choice of maximum) the instance's.
      levels: (await this.budget.levels(orgId)).levels,
      instanceLevels: instanceLevels(),
      canOwn: await can(this.db, orgId, callerId, 'nav.orgSettings', 'edit'),
      // Whether a key is stored, and its last four characters (key_hint, 126): never the key.
      ...(await this.db.execute(sql`SELECT key_hint FROM organization_ai_keys WHERE organization_id = ${orgId}::uuid`).then((r) => {
        const row = r.rows[0] as { key_hint: string | null } | undefined;
        return { ownKeyStored: !!row, ownKeyHint: row?.key_hint ?? null };
      })),
      ownPossible: currentMasterKey() !== null,
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

  /**
   * The organization's own Azure resource: endpoint, deployments per level (standard required), reasoning effort,
   * and its key (required the first time; left out = keep the stored one). Every deployment is tried; stored only
   * when all answer from Switzerland. The key is sealed (DOCUMENTS_KEY) and never sent back.
   */
  @Put('own')
  async putOwn(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: { key?: unknown } & Record<string, unknown>) {
    const callerId = await this.caller(req);
    if (!(await can(this.db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    const master = currentMasterKey();
    if (!master) return { ok: false, error: 'ai-own-no-secret-store' };
    const checked = validateOwnAzure(body);
    if (!checked.ok) return { ok: false, error: checked.error };
    if (body.key !== undefined && (typeof body.key !== 'string' || body.key.trim().length > OWN_KEY_CHARS)) return { ok: false, error: 'ai-own-key-invalid' };
    const newKey = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : null;
    const key = newKey ?? (await this.budget.ownKey(orgId));
    if (!key) return { ok: false, error: 'ai-own-key-missing' };
    const { endpoint, deployments, reasoning } = checked.value;
    let region = '';
    for (const level of AI_LEVELS) {
      const deployment = deployments[level];
      if (!deployment) continue;
      const probe = await probeOwnDeployment(endpoint, key, deployment, !!reasoning[level]);
      if ('error' in probe) return { ok: false, error: probe.error, level };
      if (!SWISS_REGION.test(probe.region)) {
        this.logger.warn(`Own Azure of org ${orgId} refused: ${level} answered from "${probe.region || 'unknown'}"`);
        return { ok: false, error: 'ai-own-region', level, region: probe.region || null };
      }
      region = probe.region;
    }
    const own: AiOwnAzure = { endpoint, deployments, reasoning, region, checkedAt: new Date().toISOString() }; // real time: when the resource was checked
    await this.db.transaction(async (tx) => {
      if (newKey) {
        const sealed = sealSecret(newKey, master);
        await tx.execute(sql`
          INSERT INTO organization_ai_keys (organization_id, sealed_key, key_id, key_hint) VALUES (${orgId}::uuid, ${sealed.sealed}, ${sealed.keyId}, ${keyHint(newKey)})
          ON CONFLICT (organization_id) DO UPDATE SET sealed_key = EXCLUDED.sealed_key, key_id = EXCLUDED.key_id, key_hint = EXCLUDED.key_hint
        `);
      }
      await tx.execute(sql`
        UPDATE organizations
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}', COALESCE(settings->'ai', '{}'::jsonb) || jsonb_build_object('own', ${JSON.stringify(own)}::jsonb))
        WHERE id = ${orgId}::uuid
      `);
    });
    this.logger.log(`Own Azure set for org ${orgId} by ${callerId}: ${Object.keys(deployments).join(', ')} (${region})`);
    // The history says what was set up, never the key.
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { ai: { own: { ...own, key: newKey ? `replaced …${keyHint(newKey) ?? ''}` : 'kept' } } } }).catch(() => {});
    return { ok: true, own };
  }

  /** Removes the own Azure resource and its key: the organization's calls go to the instance's levels again. */
  @Delete('own')
  async deleteOwn(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const callerId = await this.caller(req);
    if (!(await can(this.db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM organization_ai_keys WHERE organization_id = ${orgId}::uuid`);
      await tx.execute(sql`UPDATE organizations SET settings = settings #- '{ai,own}' WHERE id = ${orgId}::uuid AND settings ? 'ai'`);
    });
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { ai: { own: null } } }).catch(() => {});
    return { ok: true };
  }
}
