import OpenAI from 'openai';

/**
 * The AI provider shared by the assistant and the Cases AI draft. Gemini exposes an
 * OpenAI-compatible endpoint (https://ai.google.dev/gemini-api/docs/openai), so the `openai` SDK
 * with another baseURL, key and model is enough. GEMINI_API_KEY wins if both are set; none = off.
 */
export function aiClient(): OpenAI | null {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) return new OpenAI({ apiKey: geminiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) return new OpenAI({ apiKey: openaiKey });
  return null;
}

export function aiModel(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

/** Who receives the data, as shown to the user before sending: 'gemini', 'openai' or null (off). */
export function aiProvider(): 'gemini' | 'openai' | null {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

/**
 * Azure OpenAI, used only by the Cases module for organizations a superdeveloper switched to it
 * (organizations.settings.cases.ai), always through CaseAiService and its budget. The resource's
 * OpenAI-compatible v1 endpoint takes the `openai` SDK as is; the deployment name is the model.
 * AZURE_OPENAI_ENDPOINT is the resource URL (https://<name>.openai.azure.com or
 * https://<name>.cognitiveservices.azure.com), AZURE_OPENAI_KEY its key, AZURE_OPENAI_DEPLOYMENT
 * the deployment (a small pay-as-you-go one; keep its tokens-per-minute quota low).
 * No retries: every attempt is billed.
 */
export interface AzureOpenAiConfig { endpoint: string; baseURL: string; key: string; deployment: string }

export function azureOpenAiConfig(env: NodeJS.ProcessEnv = process.env): AzureOpenAiConfig | null {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/+$/, '');
  const key = env.AZURE_OPENAI_KEY?.trim();
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  if (!endpoint || !key || !deployment || !/^[\w.-]{1,64}$/.test(deployment)) return null;
  if (!/^https:\/\/[a-z0-9][a-z0-9-]{1,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com)$/.test(endpoint)) return null;
  return { endpoint, baseURL: `${endpoint}/openai/v1/`, key, deployment };
}

export function azureOpenAiClient(config: AzureOpenAiConfig, timeoutMs = 90_000): OpenAI {
  return new OpenAI({ apiKey: config.key, baseURL: config.baseURL, defaultHeaders: { 'api-key': config.key }, maxRetries: 0, timeout: timeoutMs });
}

/** The instance's own provider (Gemini/OpenAI) for one Cases call: bounded, so an overloaded provider fails within minutes, not ten. */
export function instanceCaseClient(): OpenAI | null {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) return new OpenAI({ apiKey: geminiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', maxRetries: 1, timeout: 90_000 });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) return new OpenAI({ apiKey: openaiKey, maxRetries: 1, timeout: 90_000 });
  return null;
}

/** HTTP status of a failed chat call (undefined = no answer: timeout or connection) -> error code. */
export function chatErrorCode(status: number | undefined, fallback: string): string {
  if (status === 401 || status === 403) return 'ai-provider-unavailable';
  if (status === undefined || status === 408 || status === 429 || status >= 500) return 'ai-provider-busy';
  return fallback;
}
