// An organization's limit for paid cloud AI calls (organizations.settings.ai), set by an operator
// only, since the instance owner pays the bill. It covers every AI function that goes through the
// API's budget (ai-budget.service.ts): Cases, the expenses plugin's receipt reading, any plugin.
// The instance's own budget is AI_MONTHLY_BUDGET_CHF; both count per calendar month (Zurich).
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

/** Largest per-organization monthly limit that can be set, in CHF. */
export const AI_MAX_MONTHLY_LIMIT_CHF = 1000;

export interface AiSettings {
  /** Azure spend allowed per calendar month for this organization, CHF. */
  monthlyLimitChf: number;
}

/** What an organization gets until an operator changes it. */
export const DEFAULT_AI_SETTINGS: AiSettings = { monthlyLimitChf: 10 };

function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= AI_MAX_MONTHLY_LIMIT_CHF;
}

/** The stored settings with defaults for anything missing or invalid (reading never fails). */
export function parseAiSettings(raw: unknown): AiSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { monthlyLimitChf: isLimit(o.monthlyLimitChf) ? o.monthlyLimitChf : DEFAULT_AI_SETTINGS.monthlyLimitChf };
}

/** Checks the settings as sent by the browser; the error is an i18n-able kebab code. */
export function validateAiSettings(raw: unknown): { ok: true; value: AiSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'ai-settings-invalid' };
  if (!isLimit(o.monthlyLimitChf)) return { ok: false, error: 'ai-settings-limit' };
  return { ok: true, value: { monthlyLimitChf: Math.round(o.monthlyLimitChf * 100) / 100 } };
}
