import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { sqlNow } from './clock';
import { TRIGGER_TEMPLATES, type TriggerTemplate } from '@worktime3/shared/triggerTemplates';

// Auslöser (flow triggers, docs/dev/FLOWS.md): events the core and plugins offer (a residence permit ending, an
// anniversary, ...), and an organization's rules for the flows they open (table flow_triggers, 123). Pure parts here,
// the engine in triggers.service.ts, the endpoints in flow-triggers.controller.ts.

export type TriggerLang = 'de' | 'fr' | 'it' | 'en';
export const TRIGGER_LANGS: readonly TriggerLang[] = ['de', 'fr', 'it', 'en'];

/** Whom a trigger's Free Flow goes to: a department, the acting manager of the person it is about, or that person. */
export const TRIGGER_TARGETS = ['department', 'manager', 'person'] as const;
export type TriggerTarget = (typeof TRIGGER_TARGETS)[number];

/** The longest lead time a trigger may have, in days. */
export const MAX_TRIGGER_LEAD_DAYS = 365;
const MAX_LABEL = 100;
const FLOW_TYPE_KEY = /^[a-z][a-z0-9_]{0,29}$/;

/** An event a trigger can react to. */
export interface TriggerEventDef {
  /** Unique; a plugin's start with its id and a dot (`hr.anniversary`). */
  id: string;
  /** Its name per language (the Auslöser tab). */
  label: Record<TriggerLang, string>;
  /**
   * About people's sensitive data (sickness, permits, exits): only who edits this permission object for everyone
   * (`reachesAll`, e.g. `nav.hr` or `section.basicdata.personalien`) sees and edits its triggers, besides the
   * Flow-Designer's own permission.
   */
  sensitive?: string;
  /** The values it gives the e-mail templates of the flow type's steps (`{{years}}`, `{{date}}`, ...). */
  placeholders: string[];
  /** The lead time a new trigger starts with; `false`: opened as soon as the event is known (an exit's steps). */
  defaultLeadDays: number | false;
  /** The page that shows what it is about (a section id; the flow's link adds `?user=<about>`). */
  section?: string;
}

/** One time an event happens (a person's anniversary on a date). */
export interface TriggerOccurrence {
  event: string;
  /** Unique within the event and organization, e.g. `anniversary:<user>:<date>`. */
  key: string;
  /** The person it is about (a member of the organization). */
  aboutUserId: string;
  /** The day it happens (YYYY-MM-DD): the flow is due then, and opened `lead_days` before. */
  date: string;
  /** When the flow is due, if not on `date` (an exit's step a few days before the last day). */
  dueDate?: string;
  /** Values for the templates: `date`, `years`, ... */
  data: Record<string, string | number>;
  /** A department of its own (an exit step's), used instead of the trigger's. */
  departmentId?: string | null;
  /** The flow's subject and first message in a language. */
  text: (lang: TriggerLang) => { subject: string; message: string };
}

/**
 * A provider of trigger events: the core's, or a plugin's (`ApiPlugin.triggers`). `due` returns the occurrences of the
 * events asked for whose date lies between today and today + the horizon given per event (and those that have no
 * lead time, `defaultLeadDays: false`, whenever they apply).
 */
export interface TriggerSource {
  /** The module whose switch (and license) decides whether its events run (a plugin's id), none for the core's. */
  module?: string;
  events: TriggerEventDef[];
  /**
   * Vorlagen for its events (the Auslöser tab's "Vorlagen"): a flow type with an e-mail from a template, and the
   * trigger that opens it (`@worktime3/shared/triggerTemplates`). Offered while its module is on.
   */
  templates?: readonly TriggerTemplate[];
  due(db: Db, orgId: string, today: string, horizons: Record<string, number>): Promise<TriggerOccurrence[]>;
}

/** A trigger as stored (flow_triggers). */
export interface FlowTrigger {
  id: string;
  event: string;
  enabled: boolean;
  leadDays: number;
  flowType: string | null;
  target: TriggerTarget;
  departmentId: string | null;
  confidential: boolean;
  label: string | null;
}

export type TriggerInput = Omit<FlowTrigger, 'id'>;

/** Checks a trigger from the Auslöser tab (create or update); `events` are the event ids that exist. */
export function validateTrigger(body: unknown, events: readonly string[]): { ok: true; value: TriggerInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid-trigger' };
  const b = body as Record<string, unknown>;
  if (typeof b.event !== 'string' || !events.includes(b.event)) return { ok: false, error: 'unknown-event' };
  const leadDays = b.leadDays === undefined ? 14 : b.leadDays;
  if (typeof leadDays !== 'number' || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_TRIGGER_LEAD_DAYS) return { ok: false, error: 'invalid-lead-days' };
  const flowType = b.flowType === undefined || b.flowType === null || b.flowType === '' ? null : b.flowType;
  if (flowType !== null && (typeof flowType !== 'string' || !FLOW_TYPE_KEY.test(flowType))) return { ok: false, error: 'invalid-flow-type' };
  const target = b.target === undefined ? 'department' : b.target;
  if (!(TRIGGER_TARGETS as readonly unknown[]).includes(target)) return { ok: false, error: 'invalid-target' };
  const departmentId = b.departmentId === undefined || b.departmentId === null || b.departmentId === '' ? null : b.departmentId;
  if (departmentId !== null && (typeof departmentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(departmentId))) return { ok: false, error: 'invalid-department' };
  // A Free Flow to a department needs one; a flow type's steps decide who does what themselves.
  if (target === 'department' && flowType === null && departmentId === null) return { ok: false, error: 'department-required' };
  const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null;
  if (label !== null && label.length > MAX_LABEL) return { ok: false, error: 'invalid-label' };
  if (b.label !== undefined && b.label !== null && typeof b.label !== 'string') return { ok: false, error: 'invalid-label' };
  return {
    ok: true,
    value: {
      event: b.event,
      enabled: b.enabled === undefined ? true : b.enabled === true,
      leadDays,
      flowType: flowType as string | null,
      target: target as TriggerTarget,
      departmentId: departmentId as string | null,
      confidential: b.confidential === undefined ? true : b.confidential === true,
      label,
    },
  };
}

/** The flow's key of a trigger's occurrence (flows.source_key, unique per organization). */
export function triggerFlowKey(triggerId: string, occurrenceKey: string): string {
  return `trigger:${triggerId}:${occurrenceKey}`;
}

/** The key prefix of a trigger's flows (to close the ones no longer due). */
export function triggerKeyPrefix(triggerId: string): string {
  return `trigger:${triggerId}:`;
}

/** Whether an occurrence is to be opened today: on or after today, at most `leadDays` ahead (always without a lead time). */
export function withinLead(date: string, today: string, leadDays: number | false): boolean {
  if (leadDays === false) return true;
  if (date < today) return false;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + leadDays);
  return date <= d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD as 17.11.2026. */
const swissDate = (iso: string) => iso.split('-').reverse().join('.');

const PERMIT_TEXT: Record<TriggerLang, { subject: string; message: string }> = {
  de: { subject: 'Bewilligung läuft ab: {{name}} ({{date}})', message: 'Die Aufenthalts- bzw. Arbeitsbewilligung von {{name}} ({{type}}) läuft am {{date}} ab. Bitte die Verlängerung rechtzeitig anstossen.' },
  fr: { subject: 'Autorisation échue : {{name}} ({{date}})', message: "L'autorisation de séjour ou de travail de {{name}} ({{type}}) échoit le {{date}}. Veuillez lancer le renouvellement à temps." },
  it: { subject: 'Permesso in scadenza: {{name}} ({{date}})', message: 'Il permesso di soggiorno o di lavoro di {{name}} ({{type}}) scade il {{date}}. Avviare per tempo il rinnovo.' },
  en: { subject: 'Permit expires: {{name}} ({{date}})', message: "{{name}}'s residence or work permit ({{type}}) expires on {{date}}. Please start the renewal in time." },
};

const fill = (text: string, values: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (w, k: string) => values[k] ?? w);

/** The core's event id of a residence permit ending (My Data's `residencePermitValidUntil`). */
export const PERMIT_EVENT = 'permitExpires';

/**
 * The core's events: a residence permit ending (My Data, active members not past their exit). Sensitive: who edits
 * people's personal data for everyone (HR) sees its triggers.
 */
export const CORE_TRIGGERS: TriggerSource = {
  templates: TRIGGER_TEMPLATES,
  events: [{
    id: PERMIT_EVENT,
    label: { de: 'Bewilligung läuft ab', fr: "Autorisation de séjour échue", it: 'Permesso in scadenza', en: 'Permit expires' },
    sensitive: 'section.basicdata.personalien',
    placeholders: ['name', 'firstName', 'date', 'type'],
    defaultLeadDays: 90,
    section: 'users',
  }],
  async due(db, orgId, today, horizons) {
    const horizon = horizons[PERMIT_EVENT];
    if (horizon === undefined) return [];
    const rows = (await db.execute(sql`
      SELECT u.id AS user_id, coalesce(u.display_name, u.email) AS name, u.basicdata->>'residencePermitValidUntil' AS until,
             coalesce(u.basicdata->>'residencePermitCode', '') AS type
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId}::uuid AND m.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > ${sqlNow()})
        AND u.basicdata->>'residencePermitValidUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND (u.basicdata->>'residencePermitValidUntil')::date BETWEEN ${today}::date AND ${today}::date + ${horizon}::int
    `)).rows as { user_id: string; name: string; until: string; type: string }[];
    return rows.map((r) => ({
      event: PERMIT_EVENT,
      key: `${PERMIT_EVENT}:${r.user_id}:${r.until}`,
      aboutUserId: r.user_id,
      date: r.until,
      data: { date: r.until, ...(r.type ? { type: r.type } : {}) },
      text: (lang: TriggerLang) => {
        const values = { name: r.name, date: swissDate(r.until), type: r.type || '—' };
        return { subject: fill(PERMIT_TEXT[lang].subject, values), message: fill(PERMIT_TEXT[lang].message, values) };
      },
    }));
  },
};
