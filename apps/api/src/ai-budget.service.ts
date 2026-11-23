import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { parseAiSettings } from '@worktime3/shared/ai';
import { azureOpenAiConfig } from './ai-client';
import { DbService, type Db } from './db.service';
import { sendMail } from './mailer';

/**
 * Cost barriers for paid cloud AI calls (Azure) of every module and plugin (Cases, receipt reading,
 * ...). Every such call reserves its estimated cost in ai_usage (078) before anything is sent and is
 * refused when it would exceed:
 *   - the instance's monthly budget, AI_MONTHLY_BUDGET_CHF (unset or 0 = Azure is off: fail closed),
 *   - the organization's monthly limit (organizations.settings.ai.monthlyLimitChf, packages/shared/src/ai.ts),
 *   - one running call per user, USER_CALLS_PER_HOUR calls per user and hour. The chat assistant is its
 *     own lane (ASSISTANT_KIND): its questions neither count towards nor wait for the other calls, and
 *     have their own ASSISTANT_CALLS_PER_HOUR. The CHF budgets above cover both lanes together.
 * AI_AZURE_ENABLED=false switches Azure off for the whole instance at once. Prices come from the env
 * (the Azure price sheet, in CHF), never from code; without them Azure stays off as well.
 * Superdevelopers get one mail per month and threshold (80 % and exhausted) for the instance and each org.
 */

export interface AzurePrices {
  /** Azure OpenAI Whisper, per hour of audio. */
  transcribePerHour: number;
  /** Azure OpenAI deployment, per million input / output tokens. */
  inputPer1M: number;
  outputPer1M: number;
}

function positive(value: string | undefined): number | null {
  const n = Number(value);
  return value?.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function azurePrices(env: NodeJS.ProcessEnv = process.env): AzurePrices | null {
  const transcribePerHour = positive(env.AZURE_TRANSCRIBE_CHF_PER_HOUR);
  const inputPer1M = positive(env.AZURE_OPENAI_CHF_PER_1M_INPUT);
  const outputPer1M = positive(env.AZURE_OPENAI_CHF_PER_1M_OUTPUT);
  return transcribePerHour && inputPer1M && outputPer1M ? { transcribePerHour, inputPer1M, outputPer1M } : null;
}

export function instanceBudgetChf(env: NodeJS.ProcessEnv = process.env): number | null {
  return positive(env.AI_MONTHLY_BUDGET_CHF);
}

/** Azure may be used at all: not switched off, a budget and prices set. */
export function azureAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_AZURE_ENABLED?.trim().toLowerCase() !== 'false' && instanceBudgetChf(env) !== null && azurePrices(env) !== null;
}

/** Azure OpenAI chat can be called: allowed (budget, prices, kill switch) and configured. */
export function azureOpenAiAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return azureAllowed(env) && azureOpenAiConfig(env) !== null;
}

/** Audio length is unknown before Azure answers: assume a low bitrate (32 kbit/s), so the estimate is high. */
export const ESTIMATE_AUDIO_BYTES_PER_SECOND = 4000;
/** Characters per token assumed for the estimate (German text is ~4; 3 errs on the high side). */
export const ESTIMATE_CHARS_PER_TOKEN = 3;
export const USER_CALLS_PER_HOUR = 20;
/** The chat assistant's usage kind: a lane of its own for the per-user limits (not for the CHF budgets). */
export const ASSISTANT_KIND = 'assistant';
/** Assistant questions per user and hour (each is one call, however many model rounds it takes). */
export const ASSISTANT_CALLS_PER_HOUR = 60;

/** The hourly allowance of a call's lane. */
export function callsPerHour(kind: string): number {
  return kind === ASSISTANT_KIND ? ASSISTANT_CALLS_PER_HOUR : USER_CALLS_PER_HOUR;
}
/** A pending call older than this no longer blocks its user (the API restarted mid-call); it still counts as spent. */
export const PENDING_BLOCKS_MINUTES = 10;

export function estimateTranscribeChf(bytes: number, prices: AzurePrices): number {
  return (bytes / ESTIMATE_AUDIO_BYTES_PER_SECOND / 3600) * prices.transcribePerHour;
}

export function transcribeChf(seconds: number, prices: AzurePrices): number {
  return (seconds / 3600) * prices.transcribePerHour;
}

export function estimateChatChf(inputChars: number, maxOutputTokens: number, prices: AzurePrices): number {
  return chatChf(Math.ceil(inputChars / ESTIMATE_CHARS_PER_TOKEN) + 200, maxOutputTokens, prices);
}

export function chatChf(inputTokens: number, outputTokens: number, prices: AzurePrices): number {
  return (inputTokens * prices.inputPer1M + outputTokens * prices.outputPer1M) / 1_000_000;
}

export interface BudgetState {
  instanceSpent: number;
  instanceBudget: number;
  orgSpent: number;
  orgLimit: number;
  estimate: number;
  /** The user's calls in the last hour and running now, in the same lane as this call (assistant or other). */
  userCallsLastHour: number;
  userPending: number;
  /** That lane's hourly allowance (callsPerHour); USER_CALLS_PER_HOUR when left out. */
  callsPerHour?: number;
}

/** Why a call must not be made (an error code), or null. */
export function budgetRefusal(s: BudgetState): string | null {
  if (s.userPending > 0) return 'ai-user-busy';
  if (s.userCallsLastHour >= (s.callsPerHour ?? USER_CALLS_PER_HOUR)) return 'ai-rate-limited';
  if (s.instanceSpent + s.estimate > s.instanceBudget) return 'ai-budget-exhausted';
  if (s.orgSpent + s.estimate > s.orgLimit) return 'ai-org-limit-reached';
  return null;
}

/** What a call does, e.g. 'transcribe', 'summarize', 'draft', 'receipt': any lowercase name (ai_usage.kind). */
export type AiUsageKind = string;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** Start of the current calendar month in Zurich, as a SQL timestamptz expression. */
export const MONTH_START = sql`(date_trunc('month', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich')`;

@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger('AiBudget');
  /** `<YYYY-MM>:<scope>:<threshold>` already mailed; in memory, so a restart may mail once more. */
  private readonly alerted = new Set<string>();

  constructor(private readonly dbService: DbService) {}

  private get db(): Db {
    const d = this.dbService.getDb();
    if (!d) throw new ServiceUnavailableException('db-unavailable');
    return d;
  }

  /**
   * The organization's monthly limit for every paid AI call (organizations.settings.ai.monthlyLimitChf,
   * set by an operator under Organization settings -> AI and costs).
   */
  async orgMonthlyLimitChf(orgId: string): Promise<number> {
    const rows = await this.db.execute(sql`SELECT settings->'ai' AS ai FROM organizations WHERE id = ${orgId}::uuid`);
    return parseAiSettings((rows.rows[0] as { ai?: unknown } | undefined)?.ai).monthlyLimitChf;
  }

  /** Reserves the estimated cost or throws the refusal. Returns the usage row's id for finish(). */
  async reserve(input: {
    orgId: string;
    userId: string;
    /** The record the call is about (e.g. `{ table: 'cases.cases', id }`), kept with the usage row; none for receipt reading. */
    subject?: { table: string; id: string } | null;
    kind: AiUsageKind;
    provider: string;
    estimateChf: number;
    orgLimitChf: number;
  }): Promise<string> {
    const budget = instanceBudgetChf();
    if (!azureAllowed() || budget === null) throw new ServiceUnavailableException('ai-provider-not-configured');
    const estimate = round4(input.estimateChf);
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai_usage'))`);
      const spent = await tx.execute(sql`
        SELECT
          COALESCE(SUM(COALESCE(actual_chf, estimated_chf)) FILTER (WHERE created_at >= ${MONTH_START}), 0) AS instance_spent,
          COALESCE(SUM(COALESCE(actual_chf, estimated_chf)) FILTER (WHERE created_at >= ${MONTH_START} AND organization_id = ${input.orgId}::uuid), 0) AS org_spent,
          COUNT(*) FILTER (WHERE user_id = ${input.userId}::uuid AND created_at > now() - interval '1 hour'
                             AND (kind = ${ASSISTANT_KIND}) = ${input.kind === ASSISTANT_KIND}) AS user_calls,
          COUNT(*) FILTER (WHERE user_id = ${input.userId}::uuid AND status = 'pending'
                             AND created_at > now() - make_interval(mins => ${PENDING_BLOCKS_MINUTES})
                             AND (kind = ${ASSISTANT_KIND}) = ${input.kind === ASSISTANT_KIND}) AS user_pending
        FROM ai_usage
        WHERE created_at >= LEAST(${MONTH_START}, now() - interval '1 hour')
      `);
      const row = spent.rows[0] as Record<string, unknown>;
      const state: BudgetState = {
        instanceSpent: Number(row.instance_spent),
        instanceBudget: budget,
        orgSpent: Number(row.org_spent),
        orgLimit: input.orgLimitChf,
        estimate,
        userCallsLastHour: Number(row.user_calls),
        userPending: Number(row.user_pending),
        callsPerHour: callsPerHour(input.kind),
      };
      const refusal = budgetRefusal(state);
      if (refusal) return { refusal, state };
      const inserted = await tx.execute(sql`
        INSERT INTO ai_usage (organization_id, user_id, subject_table, subject_id, kind, provider, estimated_chf)
        VALUES (${input.orgId}::uuid, ${input.userId}::uuid, ${input.subject?.table ?? null}, ${input.subject?.id ?? null}::uuid,
                ${input.kind}, ${input.provider}, ${estimate})
        RETURNING id
      `);
      return { id: String((inserted.rows[0] as { id: string }).id), state };
    });
    if ('refusal' in outcome && outcome.refusal) {
      this.logger.warn(`Refused ${input.kind} via ${input.provider} for org ${input.orgId}, user ${input.userId}: ${outcome.refusal} (estimate CHF ${estimate})`);
      // Mail only when the month's spend is really up (≥ 80 %), not for one oversized call (that is logged above).
      if (outcome.refusal === 'ai-budget-exhausted' && outcome.state.instanceSpent >= budget * 0.8) this.alert('instance', 'exhausted', `Instance AI budget exhausted: CHF ${outcome.state.instanceSpent.toFixed(2)} of ${budget.toFixed(2)} spent this month. Azure calls are refused until next month or a higher AI_MONTHLY_BUDGET_CHF.`);
      if (outcome.refusal === 'ai-org-limit-reached' && input.orgLimitChf > 0 && outcome.state.orgSpent >= input.orgLimitChf * 0.8) this.alert(input.orgId, 'exhausted', `Organization ${input.orgId} reached its monthly AI limit: CHF ${outcome.state.orgSpent.toFixed(2)} of ${input.orgLimitChf.toFixed(2)}. Its Azure calls are refused until next month or a higher limit.`);
      const status = outcome.refusal === 'ai-user-busy' || outcome.refusal === 'ai-rate-limited' ? 429 : 503;
      throw new HttpException(outcome.refusal, status);
    }
    return (outcome as { id: string }).id;
  }

  /**
   * Records the outcome. actualChf null = unknown (a timeout: Azure may have billed it), so the
   * estimate keeps counting; 0 = certainly not billed (Azure answered with an error).
   */
  async finish(
    id: string,
    result: { ok: boolean; error?: string; audioSeconds?: number; inputTokens?: number; outputTokens?: number; actualChf: number | null },
    context: { orgId: string; orgLimitChf: number },
  ): Promise<void> {
    try {
      await this.db.execute(sql`
        UPDATE ai_usage SET
          status = ${result.ok ? 'ok' : 'failed'},
          error = ${result.error ?? null},
          audio_seconds = ${result.audioSeconds === undefined ? null : Math.round(result.audioSeconds * 10) / 10},
          input_tokens = ${result.inputTokens ?? null},
          output_tokens = ${result.outputTokens ?? null},
          actual_chf = ${result.actualChf === null ? null : round4(result.actualChf)},
          finished_at = now()
        WHERE id = ${id}::uuid
      `);
      const totals = await this.totals(context.orgId);
      const budget = instanceBudgetChf();
      if (budget && totals.instanceSpentChf >= budget * 0.8) {
        this.alert('instance', '80', `Instance AI spend is at CHF ${totals.instanceSpentChf.toFixed(2)} of the monthly budget of CHF ${budget.toFixed(2)} (80 % reached).`);
      }
      if (context.orgLimitChf > 0 && totals.orgSpentChf >= context.orgLimitChf * 0.8) {
        this.alert(context.orgId, '80', `Organization ${context.orgId} is at CHF ${totals.orgSpentChf.toFixed(2)} of its monthly AI limit of CHF ${context.orgLimitChf.toFixed(2)} (80 % reached).`);
      }
    } catch (error) {
      // The reservation stays pending and keeps counting with its estimate: safe side.
      this.logger.error(`Could not record AI usage ${id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** This month's spend (Zurich calendar month): the organization's and the whole instance's, CHF. */
  async totals(orgId: string): Promise<{ orgSpentChf: number; instanceSpentChf: number; orgCalls: number }> {
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(COALESCE(actual_chf, estimated_chf)), 0) AS instance_spent,
        COALESCE(SUM(COALESCE(actual_chf, estimated_chf)) FILTER (WHERE organization_id = ${orgId}::uuid), 0) AS org_spent,
        COUNT(*) FILTER (WHERE organization_id = ${orgId}::uuid) AS org_calls
      FROM ai_usage
      WHERE created_at >= ${MONTH_START}
    `);
    const row = result.rows[0] as Record<string, unknown>;
    return { instanceSpentChf: Number(row.instance_spent), orgSpentChf: Number(row.org_spent), orgCalls: Number(row.org_calls) };
  }

  private alert(scope: string, threshold: '80' | 'exhausted', text: string): void {
    const key = `${new Date().toISOString().slice(0, 7)}:${scope}:${threshold}`;
    if (this.alerted.has(key)) return;
    this.alerted.add(key);
    this.logger.warn(text);
    void this.mailSuperdevelopers(`[Apensum] AI budget: ${threshold === '80' ? '80 % reached' : 'exhausted'}`, text);
  }

  private async mailSuperdevelopers(subject: string, text: string): Promise<void> {
    try {
      const rows = await this.db.execute(sql`SELECT u.email FROM organization_memberships m JOIN users u ON u.id = m.user_id
                                              WHERE m.organization_id = ${OPERATOR_ORG_ID} AND m.status = 'active'`);
      for (const r of rows.rows as { email: string }[]) {
        await sendMail({ to: r.email, subject, text }).catch(() => {});
      }
    } catch {
      // Best effort: the log line above is the record.
    }
  }
}
