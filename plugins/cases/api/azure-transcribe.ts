import { HttpException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { azureOpenAiConfig, retryStaleConnection } from '@worktime3/api/plugin';
import { interviewAudioFormat, MAX_INTERVIEW_TEXT } from './case-interview-processing';

/**
 * Azure OpenAI Whisper (a "Standard" deployment in Switzerland North, so the audio is processed in
 * Switzerland): one synchronous multipart request, the text comes back in the answer. Azure has no
 * fast Speech transcription in Switzerland, hence Whisper; it does not separate speakers and writes
 * Swiss German phonetically. Uses the Azure OpenAI resource (AZURE_OPENAI_ENDPOINT / _KEY) and the
 * deployment AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT. Whisper is served on the classic deployments route,
 * not on /openai/v1. Not retried (every attempt is billed), except a stale pooled connection. Paid, so only via CaseAiService (budget).
 */
export const AZURE_TRANSCRIBE_API_VERSION = '2024-06-01';

export interface AzureTranscribeConfig { url: string; key: string }

export function azureTranscribeConfig(env: NodeJS.ProcessEnv = process.env): AzureTranscribeConfig | null {
  const openai = azureOpenAiConfig(env);
  const deployment = env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT?.trim();
  if (!openai || !deployment || !/^[\w.-]{1,64}$/.test(deployment)) return null;
  return {
    url: `${openai.endpoint}/openai/deployments/${deployment}/audio/transcriptions?api-version=${AZURE_TRANSCRIBE_API_VERSION}`,
    key: openai.key,
  };
}

/** The answer's text and the billed audio length (verbose_json). */
export function parseAzureTranscription(body: unknown): { text: string; seconds: number } {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  const seconds = typeof o.duration === 'number' && Number.isFinite(o.duration) ? Math.max(0, o.duration) : 0;
  return { text, seconds };
}

/**
 * Errors keep `billed`: whether Azure may have charged the call. An HTTP error answer is not
 * billed; a timeout or a broken connection might be, so the budget keeps the estimate for it.
 */
export class AzureCallError extends Error {
  constructor(readonly code: string, readonly billed: boolean, readonly seconds?: number) { super(code); }
  toHttp(): HttpException {
    return this.code === 'interview-transcription-failed' ? new UnprocessableEntityException(this.code) : new ServiceUnavailableException(this.code);
  }
}

/** HTTP status of a failed provider call -> the error the browser shows. */
export function providerErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'ai-provider-unavailable'; // key rotated (kill switch) or wrong
  if (status === 429 || status >= 500) return 'ai-provider-busy';
  return 'interview-transcription-failed';
}

export async function azureTranscribe(
  audio: Buffer,
  config: AzureTranscribeConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000,
): Promise<{ text: string; seconds: number }> {
  // Whisper tells the format by the file name's extension; take it from the bytes, as for local Whisper.
  const { extension, mime } = interviewAudioFormat(audio);
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(audio)], { type: mime }), `audio.${extension}`);
  form.append('response_format', 'verbose_json');
  let response: Response;
  try {
    // A fresh signal per attempt; only a stale pooled connection is tried again (ai-client.ts).
    response = await retryStaleConnection(() => fetchImpl(config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'api-key': config.key },
      body: form,
    }));
  } catch {
    throw new AzureCallError('ai-provider-busy', true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AzureCallError(providerErrorCode(response.status), false);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AzureCallError('interview-transcription-failed', true);
  }
  const result = parseAzureTranscription(body);
  if (!result.text || result.text.includes('\0')) throw new AzureCallError('interview-transcription-failed', true, result.seconds);
  return { text: result.text.slice(0, MAX_INTERVIEW_TEXT), seconds: result.seconds };
}
