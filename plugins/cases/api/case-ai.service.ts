import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type OpenAI from 'openai';
import { MAX_INTERVIEW_AUDIO_BYTES, parseCaseAiSettings, type CaseAiSettings } from '../shared/cases';
import { DbService, type Db } from '@worktime3/api/plugin';
import { azureOpenAiClient, azureOpenAiConfig, chatErrorCode, retryStaleConnection } from '@worktime3/api/plugin';
import { AiBudgetService, azureAllowed, azurePrices, chatChf, estimateChatChf, estimateTranscribeChf, transcribeChf, type AiUsageKind } from '@worktime3/api/plugin';
import { AzureCallError, azureTranscribeConfig, azureTranscribe } from './azure-transcribe';
import { summarizeInterview } from './case-interview-processing';
import { AI_SUMMARY_MAX_TOKENS, buildAiSummaryMessages, parseAiSummary } from './case-ai-summary';

/** Who actually handles a job for an organization; null = what it chose isn't configured on this instance. */
export type TranscriptionProvider = 'azure';
export type TextProvider = 'azure';

/** What this instance offers (env), independent of any organization. Cases data goes to Azure OpenAI (Switzerland) only. */
export function caseAiAvailability(env: NodeJS.ProcessEnv = process.env) {
  const azure = azureAllowed(env);
  return {
    azureTranscription: azure && azureTranscribeConfig(env) !== null,
    azureOpenai: azure && azureOpenAiConfig(env) !== null,
  };
}

export function transcriptionProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TranscriptionProvider | null {
  if (s.transcription === 'off') return null;
  return a.azureTranscription ? 'azure' : null;
}

/** 'local' = key sentences, no model and no network. */
export function summaryProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TextProvider | 'local' | null {
  if (s.summary === 'local') return 'local';
  return a.azureOpenai ? 'azure' : null;
}

export function draftProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TextProvider | null {
  if (s.draft === 'off') return null;
  return a.azureOpenai ? 'azure' : null;
}

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];
/** A structured-output schema (response_format json_schema). */
export type JsonSchema = { name: string; strict: boolean; schema: Record<string, unknown> };

@Injectable()
export class CaseAiService {
  private readonly logger = new Logger('CaseAi');

  constructor(
    private readonly dbService: DbService,
    private readonly budget: AiBudgetService,
  ) {}

  private get db(): Db {
    const d = this.dbService.getDb();
    if (!d) throw new ServiceUnavailableException('db-unavailable');
    return d;
  }

  async settings(orgId: string): Promise<CaseAiSettings> {
    const rows = await this.db.execute(sql`SELECT settings->'cases'->'ai' AS ai FROM organizations WHERE id = ${orgId}::uuid`);
    return parseCaseAiSettings((rows.rows[0] as { ai?: unknown } | undefined)?.ai);
  }

  async saveSettings(orgId: string, value: CaseAiSettings): Promise<void> {
    await this.db.execute(sql`
      UPDATE organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{cases}',
                               COALESCE(settings->'cases', '{}'::jsonb) || jsonb_build_object('ai', ${JSON.stringify(value)}::jsonb))
      WHERE id = ${orgId}::uuid
    `);
  }

  /** The draft transcript of an interview's audio, from the organization's transcription provider. */
  async transcribe(orgId: string, userId: string, caseId: string, audio: Buffer): Promise<string> {
    const settings = await this.settings(orgId);
    const provider = transcriptionProviderFor(settings);
    if (!provider) throw new ServiceUnavailableException(settings.transcription === 'off' ? 'interview-transcription-disabled' : 'ai-provider-not-configured');
    if (audio.length > MAX_INTERVIEW_AUDIO_BYTES) throw new BadRequestException('interview-audio-too-large');

    const prices = azurePrices()!;
    const config = azureTranscribeConfig()!;
    const orgLimitChf = await this.budget.orgMonthlyLimitChf(orgId);
    const id = await this.budget.reserve({
      orgId, userId, subject: { table: 'cases.cases', id: caseId }, kind: 'transcribe', provider: 'azure-whisper',
      estimateChf: estimateTranscribeChf(audio.length, prices), orgLimitChf,
    });
    this.logger.log(`Azure transcription: org ${orgId}, case ${caseId}, user ${userId}, ${audio.length} bytes`);
    const context = { orgId, orgLimitChf };
    try {
      const { text, seconds } = await azureTranscribe(audio, config);
      await this.budget.finish(id, { ok: true, audioSeconds: seconds, actualChf: transcribeChf(seconds, prices) }, context);
      return text;
    } catch (error) {
      const e = error instanceof AzureCallError ? error : new AzureCallError('interview-transcription-failed', true);
      const actualChf = e.seconds !== undefined ? transcribeChf(e.seconds, prices) : e.billed ? null : 0;
      await this.budget.finish(id, { ok: false, error: e.code, audioSeconds: e.seconds, actualChf }, context);
      throw e.toHttp();
    }
  }

  /** A summary draft of a transcript: key sentences, or Azure OpenAI (Switzerland). */
  async summarize(orgId: string, userId: string, caseId: string, interview: { name: string; role: string; date: string; transcript: string }): Promise<string> {
    const settings = await this.settings(orgId);
    const provider = summaryProviderFor(settings);
    if (provider === 'local') return summarizeInterview(interview.transcript);
    if (!provider) throw new ServiceUnavailableException('ai-provider-not-configured');
    const answer = await this.complete(orgId, userId, caseId, 'summarize', buildAiSummaryMessages(interview), AI_SUMMARY_MAX_TOKENS, false);
    try {
      return parseAiSummary(answer);
    } catch {
      throw new ServiceUnavailableException('ai-summary-invalid');
    }
  }

  /**
   * The raw JSON answer for an assessment draft (parsed by the caller); the template's ai_allowed is checked there.
   * With a JSON schema (aiDraftSchema) Azure answers in exactly that shape.
   */
  async draft(orgId: string, userId: string, caseId: string, messages: Messages, maxTokens: number, schema?: JsonSchema): Promise<string> {
    const settings = await this.settings(orgId);
    const provider = draftProviderFor(settings);
    if (!provider) throw new ServiceUnavailableException(settings.draft === 'off' ? 'ai-draft-disabled' : 'ai-provider-not-configured');
    return this.complete(orgId, userId, caseId, 'draft', messages, maxTokens, schema ?? true);
  }

  /** Which provider each job goes to for this organization, as shown before anything is sent. */
  async providers(orgId: string) {
    const settings = await this.settings(orgId);
    const a = caseAiAvailability();
    return { settings, transcription: transcriptionProviderFor(settings, a), summary: summaryProviderFor(settings, a), draft: draftProviderFor(settings, a) };
  }

  private async complete(
    orgId: string, userId: string, caseId: string, kind: AiUsageKind, messages: Messages, maxTokens: number, json: boolean | JsonSchema,
  ): Promise<string> {
    const failCode = kind === 'draft' ? 'ai-draft-failed' : 'ai-summary-failed';
    const prices = azurePrices();
    const config = azureOpenAiConfig();
    if (!prices || !config) throw new ServiceUnavailableException('ai-provider-not-configured');
    const inputChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
    const orgLimitChf = await this.budget.orgMonthlyLimitChf(orgId);
    const id = await this.budget.reserve({
      orgId, userId, subject: { table: 'cases.cases', id: caseId }, kind, provider: 'azure-openai',
      estimateChf: estimateChatChf(inputChars, maxTokens, prices), orgLimitChf,
    });
    this.logger.log(`Azure ${kind}: org ${orgId}, case ${caseId}, user ${userId}, ${inputChars} chars`);
    const context = { orgId, orgLimitChf };
    try {
      const client = azureOpenAiClient(config);
      const completion = await retryStaleConnection(() => client.chat.completions.create({
        model: config.deployment, messages, max_completion_tokens: maxTokens,
        ...(json === true ? { response_format: { type: 'json_object' as const } }
          : json ? { response_format: { type: 'json_schema' as const, json_schema: json } } : {}),
      }));
      const usage = completion.usage;
      await this.budget.finish(id, {
        ok: true, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens,
        actualChf: usage ? chatChf(usage.prompt_tokens, usage.completion_tokens, prices) : null,
      }, context);
      return completion.choices[0]?.message?.content ?? '';
    } catch (error) {
      const status = (error as { status?: number }).status;
      const code = chatErrorCode(status, failCode);
      this.logger.warn(`Azure ${kind} failed for case ${caseId}: ${error instanceof Error ? error.message : error}`);
      // An error answer is not billed; no answer (timeout) may be, so its estimate keeps counting.
      await this.budget.finish(id, { ok: false, error: code, actualChf: status === undefined ? null : 0 }, context);
      throw new ServiceUnavailableException(code);
    }
  }
}
