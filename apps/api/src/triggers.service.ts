import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { resolveModules } from '@worktime3/shared/modules';
import { DbService, type Db } from './db.service';
import { FlowsService } from './flows.service';
import { actingManagerId } from './access';
import { clock } from './clock';
import { localDate } from './work-time-model.service';
import { API_PLUGINS } from './plugin-registrar';
import type { ApiPlugin } from './plugin';
import {
  CORE_TRIGGERS, triggerFlowKey, triggerKeyPrefix, withinLead,
  type FlowTrigger, type TriggerEventDef, type TriggerLang, type TriggerOccurrence, type TriggerSource,
} from './triggers';

const HOUR = 60 * 60_000;

export type TriggerRun = { ok: true; opened: number; updated: number; closed: number } | { ok: false; error: string };

/** An event with the source that offers it. */
export interface KnownEvent {
  def: TriggerEventDef;
  source: TriggerSource;
  /** The module whose switch decides (a plugin's), none for the core's. */
  module: string | null;
}

/** Reads an organization's triggers (flow_triggers) as the API gives them. */
export async function triggersOf(db: Db, orgId: string): Promise<FlowTrigger[]> {
  const rows = (await db.execute(sql`
    SELECT id, event, enabled, lead_days, flow_type, target, department_id, confidential, label
    FROM flow_triggers WHERE organization_id = ${orgId}::uuid ORDER BY event, id
  `)).rows as { id: string; event: string; enabled: boolean; lead_days: number; flow_type: string | null; target: FlowTrigger['target']; department_id: string | null; confidential: boolean; label: string | null }[];
  return rows.map((r) => ({
    id: r.id, event: r.event, enabled: r.enabled, leadDays: r.lead_days, flowType: r.flow_type, target: r.target,
    departmentId: r.department_id, confidential: r.confidential, label: r.label,
  }));
}

/** Which modules are on (and licensed) in the organization. */
async function modulesOf(db: Db, orgId: string): Promise<Record<string, boolean>> {
  const rows = (await db.execute(sql`
    SELECT o.settings -> 'modules' AS modules,
      (SELECT jsonb_agg(l.module_id) FROM organization_licenses l
        WHERE l.organization_id = o.id AND (l.valid_until IS NULL OR l.valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date)) AS licenses -- real time: licenses are contracts in real time
    FROM organizations o WHERE o.id = ${orgId}::uuid
  `)).rows as { modules: unknown; licenses: unknown }[];
  return rows.length ? resolveModules(rows[0].modules, rows[0].licenses) : {};
}

/**
 * Auslöser: opens the flows of each organization's enabled triggers (flow_triggers) for the occurrences of their events
 * within the lead time (FlowsService.openTask, key `trigger:<id>:<occurrence>`), brings open ones up to date and resolves
 * those whose occurrence is gone (an exit date changed). A disabled trigger resolves its open flows; one whose module is
 * off (or not licensed) is left alone. Runs a minute after the start, then every hour (`TRIGGERS=off` turns it off, e.g.
 * on a second instance); saving a trigger runs its organization.
 */
@Injectable()
export class TriggersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TriggersService');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly flows: FlowsService,
    @Optional() @Inject(API_PLUGINS) private readonly plugins: readonly ApiPlugin[] = [],
  ) {}

  onModuleInit(): void {
    if (process.env.TRIGGERS === 'off' || !this.db.getDb()) return;
    const first = setTimeout(() => void this.runAll(), 60_000);
    const every = setInterval(() => void this.runAll(), HOUR);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  /** The event sources: the core's and each plugin's (its module = its id unless it says otherwise). */
  sources(): TriggerSource[] {
    return [CORE_TRIGGERS, ...this.plugins.filter((p) => p.triggers).map((p) => ({ ...p.triggers!, module: p.triggers!.module ?? p.id }))];
  }

  /** Every event, by id. */
  events(): Map<string, KnownEvent> {
    const out = new Map<string, KnownEvent>();
    for (const source of this.sources()) for (const def of source.events) if (!out.has(def.id)) out.set(def.id, { def, source, module: source.module ?? null });
    return out;
  }

  /** Whether an event's module is on in the organization (the core's always are). */
  async eventsOn(db: Db, orgId: string): Promise<Set<string>> {
    const modules = await modulesOf(db, orgId);
    const on = new Set<string>();
    for (const [id, e] of this.events()) if (!e.module || modules[e.module] !== false) on.add(id);
    return on;
  }

  async runAll(): Promise<void> {
    const db = this.db.getDb();
    if (!db || this.running) return;
    this.running = true;
    try {
      const orgs = (await db.execute(sql`SELECT DISTINCT organization_id AS id FROM flow_triggers`)).rows as { id: string }[];
      for (const o of orgs) {
        const result = await this.run(db, o.id).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
        if (!result.ok && result.error !== 'flows-off') this.log.warn(`triggers for ${o.id}: ${result.error}`);
      }
    } finally {
      this.running = false;
    }
  }

  /** Runs the organization's triggers now. */
  async run(db: Db, orgId: string, now: Date = clock.now()): Promise<TriggerRun> {
    if (!(await this.flows.enabled(db, orgId))) return { ok: false, error: 'flows-off' };
    const today = localDate(now, 'Europe/Zurich');
    const triggers = await triggersOf(db, orgId);
    const events = this.events();
    const on = await this.eventsOn(db, orgId);
    let opened = 0;
    let updated = 0;
    let closed = 0;
    // A disabled trigger (or one whose event no longer exists): its open flows are resolved.
    for (const t of triggers.filter((x) => !x.enabled || !events.has(x.event))) {
      closed += await this.flows.closeTasks(db, orgId, 'trigger', [], today, triggerKeyPrefix(t.id));
    }
    const active = triggers.filter((x) => x.enabled && events.has(x.event) && on.has(x.event));
    // Each source once, for the events of its active triggers, as far ahead as the longest lead time asks.
    const bySource = new Map<TriggerSource, Record<string, number>>();
    for (const t of active) {
      const e = events.get(t.event)!;
      const horizons = bySource.get(e.source) ?? {};
      horizons[t.event] = Math.max(horizons[t.event] ?? 0, e.def.defaultLeadDays === false ? 0 : t.leadDays);
      bySource.set(e.source, horizons);
    }
    const occurrences = new Map<TriggerSource, TriggerOccurrence[] | null>();
    for (const [source, horizons] of bySource) {
      occurrences.set(source, await source.due(db, orgId, today, horizons).catch((err: unknown) => {
        this.log.warn(`trigger events of ${orgId}: ${err instanceof Error ? err.message : err}`);
        return null;
      }));
    }
    for (const t of active) {
      const e = events.get(t.event)!;
      const list = occurrences.get(e.source);
      // The source failed: its flows stay as they are until the next run.
      if (!list) continue;
      const keys: string[] = [];
      for (const occ of list) {
        if (occ.event !== t.event || !withinLead(occ.date, today, e.def.defaultLeadDays === false ? false : t.leadDays)) continue;
        const key = triggerFlowKey(t.id, occ.key);
        keys.push(key);
        const departmentId = occ.departmentId ?? t.departmentId;
        const text = occ.text(await this.language(db, orgId, t, departmentId, occ.aboutUserId));
        const result = await this.flows.openTask(db, {
          organizationId: orgId,
          source: 'trigger',
          key,
          section: e.def.section ?? null,
          target: t.target,
          departmentId,
          subject: text.subject,
          message: text.message,
          dueDate: occ.dueDate ?? occ.date,
          confidential: t.confidential,
          flowType: t.flowType,
          aboutUserId: occ.aboutUserId,
          data: occ.data,
        });
        if (!result.ok) {
          this.log.warn(`trigger ${t.id} of ${orgId}: ${result.error}`);
          continue;
        }
        if (result.created) opened++;
        else if (result.changed) updated++;
      }
      closed += await this.flows.closeTasks(db, orgId, 'trigger', keys, today, triggerKeyPrefix(t.id));
    }
    return { ok: true, opened, updated, closed };
  }

  /** The flow's language: whoever gets it first (the department's leader, the manager, the person), else German. */
  private async language(db: Db, orgId: string, t: FlowTrigger, departmentId: string | null, aboutUserId: string): Promise<TriggerLang> {
    let userId: string | null = null;
    if (t.target === 'person') userId = aboutUserId;
    else if (t.target === 'manager') userId = await actingManagerId(db, orgId, aboutUserId);
    else if (departmentId) {
      const rows = (await db.execute(sql`SELECT leader_user_id FROM departments WHERE id = ${departmentId}::uuid`)).rows as { leader_user_id: string | null }[];
      userId = rows[0]?.leader_user_id ?? null;
    }
    if (!userId) return 'de';
    const rows = (await db.execute(sql`SELECT locale FROM users WHERE id = ${userId}::uuid`)).rows as { locale: string | null }[];
    const l = (rows[0]?.locale ?? '').slice(0, 2);
    return l === 'en' || l === 'fr' || l === 'it' ? l : 'de';
  }
}
