import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type OpenAI from 'openai';
import { parseCaseAiSettings, type CaseAiSettings } from '@worktime3/shared/cases';
import { DbService, type Db } from './db.service';
import { aiModel, aiProvider, azureOpenAiClient, azureOpenAiConfig, chatErrorCode, instanceCaseClient, retryStaleConnection } from './ai-client';
import { AiBudgetService, azureAllowed, azurePrices, chatChf, estimateChatChf, estimateTranscribeChf, transcribeChf, type AiUsageKind } from './ai-budget.service';
import { AzureCallError, azureTranscribeConfig, azureTranscribe } from './azure-transcribe';
import { interviewTranscriptionEnabled, summarizeInterview, transcribeInterviewAudio } from './case-interview-processing';
import { AI_SUMMARY_MAX_TOKENS, buildAiSummaryMessages, parseAiSummary } from './case-ai-summary';

/** Who actually handles a job for an organization; null = what it chose isn't configured on this instance. */
export type TranscriptionProvider = 'whisper' | 'azure';
export type TextProvider = 'gemini' | 'openai' | 'azure';

/** What this instance offers (env), independent of any organization. */
export function caseAiAvailability(env: NodeJS.ProcessEnv = process.env) {
  const azure = azureAllowed(env);
  return {
    whisper: interviewTranscriptionEnabled(),
    azureTranscription: azure && azureTranscribeConfig(env) !== null,
    azureOpenai: azure && azureOpenAiConfig(env) !== null,
    instance: aiProvider(),
  };
}

export function transcriptionProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TranscriptionProvider | null {
  if (s.transcription === 'azure') return a.azureTranscription ? 'azure' : null;
  return a.whisper ? 'whisper' : null;
}

/** 'local' = key sentences, no model and no network. */
export function summaryProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TextProvider | 'local' | null {
  if (s.summary === 'local') return 'local';
  if (s.summary === 'azure') return a.azureOpenai ? 'azure' : null;
  return a.instance;
}

export function draftProviderFor(s: CaseAiSettings, a = caseAiAvailability()): TextProvider | null {
  if (s.draft === 'azure') return a.azureOpenai ? 'azure' : null;
  return a.instance;
}

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

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
    if (!provider) throw new ServiceUnavailableException(settings.transcription === 'azure' ? 'ai-provider-not-configured' : 'interview-transcription-disabled');
    if (provider === 'whisper') return transcribeInterviewAudio(audio);

    const prices = azurePrices()!;
    const config = azureTranscribeConfig()!;
    const id = await this.budget.reserve({
      orgId, userId, caseId, kind: 'transcribe', provider: 'azure-whisper',
      estimateChf: estimateTranscribeChf(audio.length, prices), orgLimitChf: settings.monthlyLimitChf,
    });
    this.logger.log(`Azure transcription: org ${orgId}, case ${caseId}, user ${userId}, ${audio.length} bytes`);
    const context = { orgId, orgLimitChf: settings.monthlyLimitChf };
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

  /** A summary draft of a transcript: key sentences, or the organization's model. */
  async summarize(orgId: string, userId: string, caseId: string, interview: { name: string; role: string; date: string; transcript: string }): Promise<string> {
    const settings = await this.settings(orgId);
    const provider = summaryProviderFor(settings);
    if (provider === 'local') return summarizeInterview(interview.transcript);
    if (!provider) throw new ServiceUnavailableException('ai-provider-not-configured');
    const answer = await this.complete(orgId, userId, caseId, settings, provider, 'summarize', buildAiSummaryMessages(interview), AI_SUMMARY_MAX_TOKENS, false);
    try {
      return parseAiSummary(answer);
    } catch {
      throw new ServiceUnavailableException('ai-summary-invalid');
    }
  }

  /** The raw JSON answer for an assessment draft (parsed by the caller); the template's ai_allowed is checked there. */
  async draft(orgId: string, userId: string, caseId: string, messages: Messages, maxTokens: number): Promise<string> {
    const settings = await this.settings(orgId);
    const provider = draftProviderFor(settings);
    if (!provider) throw new ServiceUnavailableException(settings.draft === 'azure' ? 'ai-provider-not-configured' : 'ai-not-configured');
    return this.complete(orgId, userId, caseId, settings, provider, 'draft', messages, maxTokens, true);
  }

  /** Which provider each job goes to for this organization, as shown before anything is sent. */
  async providers(orgId: string) {
    const settings = await this.settings(orgId);
    const a = caseAiAvailability();
    return { settings, transcription: transcriptionProviderFor(settings, a), summary: summaryProviderFor(settings, a), draft: draftProviderFor(settings, a) };
  }

  private async complete(
    orgId: string, userId: string, caseId: string, settings: CaseAiSettings,
    provider: TextProvider, kind: AiUsageKind, messages: Messages, maxTokens: number, json: boolean,
  ): Promise<string> {
    const failCode = kind === 'draft' ? 'ai-draft-failed' : 'ai-summary-failed';
    if (provider !== 'azure') {
      // The instance's own provider (Gemini/OpenAI): not metered here, but bounded in time.
      const client = instanceCaseClient();
      if (!client) throw new ServiceUnavailableException('ai-not-configured');
      try {
        const completion = await client.chat.completions.create({
          model: aiModel(), messages, temperature: 0.2, ...(json ? { response_format: { type: 'json_object' as const } } : {}),
        });
        return completion.choices[0]?.message?.content ?? '';
      } catch (error) {
        const status = (error as { status?: number }).status;
        this.logger.warn(`${kind} via ${provider} failed for case ${caseId}: ${error instanceof Error ? error.message : error}`);
        throw new ServiceUnavailableException(chatErrorCode(status, failCode));
      }
    }

    const prices = azurePrices()!;
    const config = azureOpenAiConfig()!;
    const inputChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
    const id = await this.budget.reserve({
      orgId, userId, caseId, kind, provider: 'azure-openai',
      estimateChf: estimateChatChf(inputChars, maxTokens, prices), orgLimitChf: settings.monthlyLimitChf,
    });
    this.logger.log(`Azure ${kind}: org ${orgId}, case ${caseId}, user ${userId}, ${inputChars} chars`);
    const context = { orgId, orgLimitChf: settings.monthlyLimitChf };
    try {
      const client = azureOpenAiClient(config);
      const completion = await retryStaleConnection(() => client.chat.completions.create({
        model: config.deployment, messages, max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' as const } } : {}),
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
