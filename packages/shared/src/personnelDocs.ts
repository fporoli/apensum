/**
 * Personnel file documents (API personnel-documents.controller.ts, web PersonnelDocumentsPanel.tsx): what a
 * category asks for, from its properties in static data personnel/document_category (core changeset 108), and
 * the checks the browser and the API share.
 */

export const PERSONNEL_CATEGORY_LIST = { entity: 'personnel', enumName: 'document_category' } as const;

/** What a category asks for (its static data properties). */
export interface PersonnelCategoryRules {
  /** A key date (Stichtag, e.g. "valid from") is required. */
  keyDate: boolean;
  /** Shared with the person, they confirm it ("taken note"). */
  acknowledge: boolean;
  /** Shared with the person's manager by default. */
  manager: boolean;
  /** Suggested follow-up after this many months (0 = none). */
  followUpMonths: number;
}

export function categoryRules(attrs: unknown): PersonnelCategoryRules {
  const a = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? (attrs as Record<string, unknown>) : {};
  const months = Number.parseInt(String(a.followUpMonths ?? ''), 10);
  return {
    keyDate: a.keyDate === true,
    acknowledge: a.acknowledge === true,
    manager: a.manager === true,
    followUpMonths: Number.isFinite(months) && months > 0 && months < 100 ? months : 0,
  };
}

/** The categories in their order (`sort`, then key). */
export function categoryKeys(values: Record<string, unknown> | null | undefined): string[] {
  const sortOf = (v: unknown) => {
    const n = Number.parseInt(String((v as Record<string, unknown> | null)?.sort ?? ''), 10);
    return Number.isFinite(n) ? n : 999;
  };
  return Object.entries(values ?? {})
    .sort(([ka, va], [kb, vb]) => sortOf(va) - sortOf(vb) || ka.localeCompare(kb))
    .map(([k]) => k);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `months` after an ISO date (day clamped to the month's end), for the suggested follow-up. */
export function addMonthsIso(date: string, months: number): string {
  if (!ISO.test(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export interface PersonnelDocState {
  category: string;
  effectiveDate: string | null;
  visibleToEmployee: boolean;
  requireAck: boolean;
}

/**
 * What is wrong with a document's state (after a create or a change), or null: a category that needs a key
 * date has one; a confirmation is asked only of a person who sees the document.
 */
export function personnelDocError(state: PersonnelDocState, rules: PersonnelCategoryRules): 'key-date-required' | 'ack-needs-sharing' | null {
  if (rules.keyDate && !state.effectiveDate) return 'key-date-required';
  if (state.requireAck && !state.visibleToEmployee) return 'ack-needs-sharing';
  return null;
}
