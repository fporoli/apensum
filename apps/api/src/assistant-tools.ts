import type { Type } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import type { Db } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { organization_memberships, projects, users } from './db/schema';
import { zoneOffsetMinutes } from './report-schedule';
import { zoneFormatter } from './zone-format';

/**
 * The assistant's tools (assistant.service.ts). A tool does what a page does by calling that page's
 * controller method with a request made for the caller (`ctx.req`), so it runs exactly the checks the
 * REST endpoint runs (rights, reporting line, locked months) with the caller's real identity, and
 * answers with the same `{ ok, error }` codes. The core's tools are assistant-core-tools.ts; a
 * plugin adds its own with `ApiPlugin.assistantTools` (names starting with its id).
 */

export interface AssistantToolContext {
  db: Db;
  orgId: string;
  callerId: string;
  /** A request as the caller, for controller methods (`@Req()`). */
  req: AuthenticatedRequest;
  /** The caller's time zone: dates and times the model reads and writes are wall-clock times there. */
  timeZone: string;
  /** Today in the caller's time zone, 'YYYY-MM-DD'. */
  today: string;
  /** A controller or provider of the app, the plugin's own included, by its class. */
  get<T>(type: Type<T>): T;
  /** An active member of the organization by name or e-mail (the controller still decides access). */
  findPerson(text: unknown): Promise<{ id: string; name: string } | { error: string }>;
  /** A project of the organization by name. */
  findProject(text: unknown): Promise<{ id: string; name: string } | { error: string }>;
  /** 'YYYY-MM-DD' + 'HH:MM' in the caller's zone as an ISO instant, or null when malformed. */
  instant(date: unknown, time: unknown): string | null;
  /** An instant as the caller's local date and time. */
  local(instant: string | Date): { date: string; time: string };
}

export interface AssistantToolResult {
  /** What the model gets back (JSON). */
  data: unknown;
  /** A line for the "done" list under the reply, when the tool changed something. */
  action?: string;
}

export interface AssistantTool {
  /** Unique; a plugin's start with its id (`expenses_add`). Letters, digits, `_` and `-` only. */
  name: string;
  /** What it does and when to use it, for the model. */
  description: string;
  /** JSON schema of its arguments. */
  parameters: Record<string, unknown>;
  /**
   * The page's permission object: the tool is offered only to whoever may see that page (a module
   * switched off hides it). The controller checks every call anyway.
   */
  object?: string;
  run(args: Record<string, unknown>, ctx: AssistantToolContext): Promise<AssistantToolResult>;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const registry = new Map<string, AssistantTool>();

/** Adds a tool to the catalogue (the core's at start, a plugin's when it loads); a name registered again is replaced. */
export function registerAssistantTool(tool: AssistantTool): void {
  if (!TOOL_NAME.test(tool.name)) throw new Error(`Invalid assistant tool name: ${tool.name}`);
  registry.set(tool.name, tool);
}

export function assistantTools(): AssistantTool[] {
  return [...registry.values()];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The instant of a wall-clock time in a zone ('24:00' is the next midnight), or null when malformed. */
export function zonedInstant(date: unknown, time: unknown, timeZone: string): string | null {
  if (!isIsoDay(date) || typeof time !== 'string') return null;
  const m = TIME.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hour, minute);
  const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Once more with the offset in force at the result (differs around a daylight saving switch).
  return new Date(guess - zoneOffsetMinutes(new Date(first), timeZone) * 60_000).toISOString();
}

/** An instant as local date and 'HH:MM' in a zone. */
export function zonedLocal(instant: string | Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(zoneFormatter('parts', timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The zone when Intl knows it, else Europe/Zurich (the app's home). */
export function assistantZone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      zoneFormatter('date', timeZone);
      return timeZone;
    } catch { /* unknown zone */ }
  }
  return 'Europe/Zurich';
}

/** Minutes between two instants. */
export function minutesBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

/** One match by exact name/e-mail, else by a unique partial match; a clear error otherwise. */
function pick<T extends { name: string | null; email?: string | null }>(rows: T[], text: string, what: string): T | { error: string } {
  const t = text.toLowerCase();
  const exact = rows.filter((r) => r.name?.toLowerCase() === t || r.email?.toLowerCase() === t);
  if (exact.length === 1) return exact[0];
  const list = exact.length > 1 ? exact : rows;
  if (list.length === 1) return list[0];
  if (list.length === 0) return { error: `no ${what} matches "${text}"` };
  return { error: `several ${what}s match "${text}": ${list.slice(0, 8).map((r) => r.name ?? r.email).join(', ')}; ask which one` };
}

export async function findOrgMember(db: Db, orgId: string, text: unknown): Promise<{ id: string; name: string } | { error: string }> {
  if (typeof text !== 'string' || !text.trim()) return { error: 'person missing' };
  const q = `%${text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({ id: users.id, name: users.display_name, email: users.email })
    .from(organization_memberships)
    .innerJoin(users, eq(users.id, organization_memberships.user_id))
    .where(and(
      eq(organization_memberships.organization_id, orgId),
      eq(organization_memberships.status, 'active'),
      or(ilike(users.display_name, q), ilike(users.email, q)),
    ))
    .orderBy(asc(users.display_name))
    .limit(20);
  const found = pick(rows, text.trim(), 'colleague');
  return 'error' in found ? found : { id: found.id, name: found.name ?? found.email };
}

export async function findOrgProject(db: Db, orgId: string, text: unknown): Promise<{ id: string; name: string } | { error: string }> {
  if (typeof text !== 'string' || !text.trim()) return { error: 'project missing' };
  const q = `%${text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.organization_id, orgId), ilike(projects.name, q)))
    .orderBy(asc(projects.name))
    .limit(20);
  return pick(rows, text.trim(), 'project');
}

/** A tool's answer for the model: kept under `max` characters so one big list cannot eat the budget. */
export function toolPayload(data: unknown, max = 12_000): string {
  const text = JSON.stringify(data ?? null);
  return text.length <= max ? text : `${text.slice(0, max)}… (cut: ask for a shorter period)`;
}
