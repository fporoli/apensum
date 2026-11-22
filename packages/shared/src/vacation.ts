// Vacation rules of an organization (`organizations.settings.vacation`, edited by HR) and the probation
// period. A person's days depend on the date: the rule in force, whether they are management then
// (their employment assignment) and their age then. Used by the API, the web app and plugins.
//
// Dates are 'YYYY-MM-DD'. Keep this file erasable TypeScript (no enums, no imports).

/** Art. 329a CO: four weeks a year, five until the 20th birthday, in full-time days. */
export const LEGAL_VACATION_DAYS = 20;
export const LEGAL_VACATION_DAYS_YOUTH = 25;
export const YOUTH_UNTIL_AGE = 20;

export const MAX_VACATION_DAYS = 100;
export const MAX_VACATION_RULES = 20;
export const MAX_AGE_STEPS = 5;
/** Art. 335b CO: one month unless agreed otherwise, at most three. */
export const DEFAULT_PROBATION_MONTHS = 1;
export const MAX_PROBATION_MONTHS = 3;

/** From this age on (the birthday), this many days more. */
export interface AgeStep {
  age: number;
  days: number;
}

export interface VacationRule {
  /** The first day it applies; the earliest rule also applies to every day before. */
  validFrom: string;
  baseDays: number;
  /** A manager's days in place of the base; null = like everyone. */
  managementDays: number | null;
  /** The highest step reached counts (they don't add up among themselves); it adds to the base or management days. */
  ageSteps: AgeStep[];
}

export interface VacationSettings {
  rules: VacationRule[];
  probationMonths: number;
}

/** What a person's days depend on. */
export interface VacationPerson {
  birthDate: string | null;
  /** From which days on they are management or not (their assignments), in any order. */
  management: readonly { validFrom: string; management: boolean }[];
}

export interface VacationDays {
  days: number;
  baseDays: number;
  /** The management days that replace the base, when they do. */
  managementDays: number | null;
  ageStep: AgeStep | null;
  /** The legal minimum is above what the rule gives. */
  legalMinimum: boolean;
}

export const FIRST_RULE_DATE = '2000-01-01';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isDays(value: unknown, min: number, max = MAX_VACATION_DAYS): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && Number.isInteger(value * 2);
}

export type VacationSettingsError = 'invalid-rules' | 'invalid-date' | 'invalid-days' | 'invalid-age-step' | 'invalid-probation';

export function validateVacationSettings(input: unknown): { ok: true; value: VacationSettings } | { ok: false; error: VacationSettingsError } {
  if (!isObject(input) || !Array.isArray(input.rules) || input.rules.length === 0 || input.rules.length > MAX_VACATION_RULES) {
    return { ok: false, error: 'invalid-rules' };
  }
  const rules: VacationRule[] = [];
  for (const r of input.rules) {
    if (!isObject(r)) return { ok: false, error: 'invalid-rules' };
    const { validFrom, baseDays } = r;
    const managementDays = r.managementDays ?? null;
    if (!isDate(validFrom) || rules.some((x) => x.validFrom === validFrom)) return { ok: false, error: 'invalid-date' };
    if (!isDays(baseDays, LEGAL_VACATION_DAYS) || (managementDays !== null && !isDays(managementDays, baseDays))) return { ok: false, error: 'invalid-days' };
    const steps = r.ageSteps ?? [];
    if (!Array.isArray(steps) || steps.length > MAX_AGE_STEPS) return { ok: false, error: 'invalid-age-step' };
    const ageSteps: AgeStep[] = [];
    for (const s of steps) {
      if (!isObject(s)) return { ok: false, error: 'invalid-age-step' };
      const { age, days } = s;
      if (typeof age !== 'number' || !Number.isInteger(age) || age < YOUTH_UNTIL_AGE || age > 80 || !isDays(days, 0.5) || ageSteps.some((x) => x.age === age)) {
        return { ok: false, error: 'invalid-age-step' };
      }
      ageSteps.push({ age, days });
    }
    rules.push({ validFrom, baseDays, managementDays: managementDays as number | null, ageSteps: ageSteps.sort((a, b) => a.age - b.age) });
  }
  const months = input.probationMonths;
  if (typeof months !== 'number' || !Number.isInteger(months) || months < 0 || months > MAX_PROBATION_MONTHS) return { ok: false, error: 'invalid-probation' };
  return { ok: true, value: { rules: rules.sort((a, b) => a.validFrom.localeCompare(b.validFrom)), probationMonths: months } };
}

/** An organization's rules from its settings; without any, the one number it had (`vacationDaysPerYear`). */
export function parseVacationSettings(orgSettings: unknown): VacationSettings {
  const s = isObject(orgSettings) ? orgSettings : {};
  const stored = isObject(s.vacation) ? s.vacation : {};
  const months = stored.probationMonths;
  const probationMonths =
    typeof months === 'number' && Number.isInteger(months) && months >= 0 && months <= MAX_PROBATION_MONTHS ? months : DEFAULT_PROBATION_MONTHS;
  const checked = validateVacationSettings({ rules: stored.rules, probationMonths });
  if (checked.ok) return checked.value;
  const days = s.vacationDaysPerYear;
  const baseDays = typeof days === 'number' && Number.isFinite(days) && days >= 0 ? days : 25;
  return { rules: [{ validFrom: FIRST_RULE_DATE, baseDays, managementDays: null, ageSteps: [] }], probationMonths };
}

/** Full years lived on `date`; someone born on 29 February has their birthday on 1 March in other years. */
export function ageOn(birthDate: string | null, date: string): number | null {
  if (!birthDate || !isDate(birthDate) || birthDate > date) return null;
  const years = Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return date.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

function inForce<T extends { validFrom: string }>(items: readonly T[], date: string): T | undefined {
  let best: T | undefined;
  for (const item of items) if (item.validFrom <= date && (!best || item.validFrom > best.validFrom)) best = item;
  return best;
}

/** A full-time year's days as they apply on `date`. */
export function vacationDaysOn(date: string, rules: readonly VacationRule[], person: VacationPerson): VacationDays {
  const rule = inForce(rules, date) ?? rules.reduce((a, b) => (b.validFrom < a.validFrom ? b : a));
  const manages = inForce(person.management, date)?.management === true;
  const managementDays = manages && rule.managementDays !== null ? rule.managementDays : null;
  const age = ageOn(person.birthDate, date);
  let ageStep: AgeStep | null = null;
  if (age !== null) for (const s of rule.ageSteps) if (s.age <= age && (!ageStep || s.age > ageStep.age)) ageStep = s;
  const agreed = (managementDays ?? rule.baseDays) + (ageStep?.days ?? 0);
  const minimum = age !== null && age < YOUTH_UNTIL_AGE ? LEGAL_VACATION_DAYS_YOUTH : LEGAL_VACATION_DAYS;
  return { days: Math.max(agreed, minimum), baseDays: rule.baseDays, managementDays, ageStep, legalMinimum: minimum > agreed };
}

/** Art. 329b para. 1 CO: a full month of absence, counted as 30 calendar days. */
export const UNPAID_MONTH_DAYS = 30;

/**
 * Calendar days of `year` covered by unpaid leave (`[dateStart, dateEnd]` inclusive; a half day
 * counts half), each day once.
 */
export function unpaidLeaveDays(year: number, spans: readonly { dateStart: string; dateEnd: string; halfDay: boolean }[]): number {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const covered = new Map<string, number>();
  for (const s of spans) {
    const from = s.dateStart > first ? s.dateStart : first;
    const to = s.dateEnd < last ? s.dateEnd : last;
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      covered.set(d, Math.max(covered.get(d) ?? 0, s.halfDay ? 0.5 : 1));
    }
  }
  let days = 0;
  for (const v of covered.values()) days += v;
  return days;
}

/**
 * Days the year's entitlement is cut for unpaid leave: one twelfth per full month (Art. 329b
 * para. 1 CO, which never cuts before a full month); at most the whole entitlement.
 */
export function unpaidLeaveCut(entitlement: number, days: number): number {
  const months = Math.min(12, Math.floor(days / UNPAID_MONTH_DAYS));
  return Math.round(((entitlement * months) / 12) * 100) / 100;
}

/** The last day of probation: the date HR set, else `months` from the start; null without probation. */
export function probationEnd(start: string | null, months: number, until?: string | null): string | null {
  if (!start) return null;
  if (until) return until < start ? null : until;
  if (months <= 0) return null;
  const m = Number(start.slice(5, 7)) - 1 + months;
  const year = Number(start.slice(0, 4)) + Math.floor(m / 12);
  const lastOfMonth = new Date(Date.UTC(year, (m % 12) + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, m % 12, Math.min(Number(start.slice(8, 10)), lastOfMonth)) - 86_400_000);
  return end.toISOString().slice(0, 10);
}
