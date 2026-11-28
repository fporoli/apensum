// An organization's limit for paid cloud AI calls (organizations.settings.ai), set by an operator
// only, since the instance owner pays the bill. It covers every AI function that goes through the
// API's budget (ai-budget.service.ts): Cases, the expenses plugin's receipt reading, any plugin.
// The instance's own budget is AI_MONTHLY_BUDGET_CHF; both count per calendar month (Zurich).
//
// Levels (AI_LEVELS) and an organization's own Azure resource (AiOwnAzure) are here too.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

/** Largest per-organization monthly limit that can be set, in CHF. */
export const AI_MAX_MONTHLY_LIMIT_CHF = 1000;

/**
 * How much thinking an AI call gets: `standard` (the instance's small model, "Schnell"), `advanced` ("Gründlich")
 * and `max` ("Maximal"), each an Azure deployment of its own with its own prices (the instance's env, or the
 * organization's own Azure resource). Ordered from cheap to dear.
 */
export const AI_LEVELS = ['standard', 'advanced', 'max'] as const;
export type AiLevel = (typeof AI_LEVELS)[number];

export function isAiLevel(value: unknown): value is AiLevel {
  return typeof value === 'string' && (AI_LEVELS as readonly string[]).includes(value);
}

/** A reasoning model's effort (Azure `reasoning_effort`); none for a model that does not reason. */
export const AI_REASONING = ['low', 'medium', 'high'] as const;
export type AiReasoning = (typeof AI_REASONING)[number];

export function isAiReasoning(value: unknown): value is AiReasoning {
  return typeof value === 'string' && (AI_REASONING as readonly string[]).includes(value);
}

/**
 * The organization's own Azure OpenAI resource (organizations.settings.ai.own): its calls go there, billed to the
 * organization by Azure, outside the instance's budget. Its key is not here (organization_ai_keys, encrypted).
 * `region` is what Azure reported when it was checked; only a resource in Switzerland is accepted.
 */
export interface AiOwnAzure {
  endpoint: string;
  /** Deployment per level; `standard` is required. */
  deployments: Partial<Record<AiLevel, string>>;
  reasoning: Partial<Record<AiLevel, AiReasoning>>;
  region: string;
  checkedAt: string;
}

export interface AiSettings {
  /** Azure spend allowed per calendar month for this organization, CHF. */
  monthlyLimitChf: number;
  /** The highest of the instance's levels the organization may use (an operator sets it: the instance pays). */
  maxLevel: AiLevel;
  /** The organization's own Azure resource, if any. */
  own?: AiOwnAzure | null;
}

/** What an organization gets until an operator changes it. */
export const DEFAULT_AI_SETTINGS: AiSettings = { monthlyLimitChf: 10, maxLevel: 'standard' };

function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= AI_MAX_MONTHLY_LIMIT_CHF;
}

/** The stored settings with defaults for anything missing or invalid (reading never fails). */
export function parseAiSettings(raw: unknown): AiSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const own = parseOwnAzure(o.own);
  return {
    monthlyLimitChf: isLimit(o.monthlyLimitChf) ? o.monthlyLimitChf : DEFAULT_AI_SETTINGS.monthlyLimitChf,
    maxLevel: isAiLevel(o.maxLevel) ? o.maxLevel : DEFAULT_AI_SETTINGS.maxLevel,
    ...(own ? { own } : {}),
  };
}

/** An Azure OpenAI resource URL as the app accepts it (no path, an Azure host). */
export const AZURE_ENDPOINT = /^https:\/\/[a-z0-9][a-z0-9-]{1,62}\.(openai\.azure\.com|cognitiveservices\.azure\.com)$/;
/** An Azure deployment name. */
export const AZURE_DEPLOYMENT = /^[\w.-]{1,64}$/;
/** Azure regions in Switzerland, as Azure names them in its answers (x-ms-region). */
export const SWISS_REGION = /^switzerland\s?(north|west)$/i;

function parseOwnAzure(raw: unknown): AiOwnAzure | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || typeof o.endpoint !== 'string' || !AZURE_ENDPOINT.test(o.endpoint)) return null;
  const d = o.deployments && typeof o.deployments === 'object' ? (o.deployments as Record<string, unknown>) : {};
  const r = o.reasoning && typeof o.reasoning === 'object' ? (o.reasoning as Record<string, unknown>) : {};
  const deployments: Partial<Record<AiLevel, string>> = {};
  const reasoning: Partial<Record<AiLevel, AiReasoning>> = {};
  for (const level of AI_LEVELS) {
    if (typeof d[level] === 'string' && AZURE_DEPLOYMENT.test(d[level] as string)) deployments[level] = d[level] as string;
    if (isAiReasoning(r[level])) reasoning[level] = r[level] as AiReasoning;
  }
  if (!deployments.standard || typeof o.region !== 'string' || !SWISS_REGION.test(o.region)) return null;
  return { endpoint: o.endpoint, deployments, reasoning, region: o.region, checkedAt: typeof o.checkedAt === 'string' ? o.checkedAt : '' };
}

/**
 * The own Azure resource as entered (endpoint, deployments, reasoning; the key comes separately): checked before
 * the server tries it. Region and time are filled by the server.
 */
export function validateOwnAzure(raw: unknown): { ok: true; value: Omit<AiOwnAzure, 'region' | 'checkedAt'> } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'ai-own-invalid' };
  const endpoint = typeof o.endpoint === 'string' ? o.endpoint.trim().replace(/\/+$/, '') : '';
  if (!AZURE_ENDPOINT.test(endpoint)) return { ok: false, error: 'ai-own-endpoint' };
  const d = o.deployments && typeof o.deployments === 'object' ? (o.deployments as Record<string, unknown>) : {};
  const r = o.reasoning && typeof o.reasoning === 'object' ? (o.reasoning as Record<string, unknown>) : {};
  const deployments: Partial<Record<AiLevel, string>> = {};
  const reasoning: Partial<Record<AiLevel, AiReasoning>> = {};
  for (const level of AI_LEVELS) {
    const name = typeof d[level] === 'string' ? (d[level] as string).trim() : '';
    if (name && !AZURE_DEPLOYMENT.test(name)) return { ok: false, error: 'ai-own-deployment' };
    if (name) deployments[level] = name;
    if (r[level] !== undefined && r[level] !== null && r[level] !== '' && !isAiReasoning(r[level])) return { ok: false, error: 'ai-own-invalid' };
    if (name && isAiReasoning(r[level])) reasoning[level] = r[level] as AiReasoning;
  }
  if (!deployments.standard) return { ok: false, error: 'ai-own-deployment' };
  return { ok: true, value: { endpoint, deployments, reasoning } };
}

/** Checks the settings as sent by the browser; the error is an i18n-able kebab code. */
export function validateAiSettings(raw: unknown): { ok: true; value: Pick<AiSettings, 'monthlyLimitChf'> & Partial<Pick<AiSettings, 'maxLevel'>> } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'ai-settings-invalid' };
  if (!isLimit(o.monthlyLimitChf)) return { ok: false, error: 'ai-settings-limit' };
  if (o.maxLevel !== undefined && !isAiLevel(o.maxLevel)) return { ok: false, error: 'ai-settings-invalid' };
  return { ok: true, value: { monthlyLimitChf: Math.round(o.monthlyLimitChf * 100) / 100, ...(o.maxLevel !== undefined ? { maxLevel: o.maxLevel as AiLevel } : {}) } };
}

/** Whether a level is within the organization's maximum (for the instance's levels; its own Azure has no maximum). */
export function levelAllowed(level: AiLevel, maxLevel: AiLevel): boolean {
  return AI_LEVELS.indexOf(level) <= AI_LEVELS.indexOf(maxLevel);
}
