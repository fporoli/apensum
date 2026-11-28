import { Injectable, Logger } from '@nestjs/common';
import type { Db } from './db.service';
import { modulesOf } from './modules-of';

/**
 * Something a module offers to bill a customer for (a plugin's `billables`): an expense to bill on, later perhaps a
 * flat fee. The module that owns it says what is ready to bill and describes it; whoever bills (the billing plugin)
 * asks the core, never the owner's tables. `kind` names the owner's records (billing keeps it as its items' source).
 */
export interface BillableItem {
  kind: string;
  id: string;
  projectId: string;
  projectName: string;
  subprojectId: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** What the customer may see (never an internal note). */
  description: string;
  amount: number;
  currency: string;
  userId: string;
  userName: string;
  /** Its receipt (a core `documents` row of the organization), read only through DocumentsService. */
  documentId: string | null;
}

/** A module's billable records (ApiPlugin.billables). */
export interface BillableSource {
  /** The records' kind (e.g. `expenses`), unique across modules. */
  kind: string;
  /** The module that must be on (and licensed) in the organization; none = always. */
  module?: string;
  /** What is ready to bill: on these projects (one subproject only, when set), dated up to `to`. */
  open: (db: Db, query: { orgId: string; projectIds: readonly string[]; subprojectId: string | null; to: string }) => Promise<BillableItem[]>;
  /** These records of the organization (still billable ones only), whatever their state: for what was billed or set aside. */
  byIds: (db: Db, query: { orgId: string; ids: readonly string[] }) => Promise<BillableItem[]>;
}

const SOURCES: BillableSource[] = [];

export function registerBillableSource(source: BillableSource): void {
  if (SOURCES.some((s) => s.kind === source.kind)) throw new Error(`billable kind ${source.kind} is registered twice`);
  SOURCES.push(source);
}

/**
 * The billable records the modules offer (docs/PLUGINS.md "Billables"): a module reads another's records only through
 * here. A source whose module is off (or not licensed) in the organization offers nothing; one that fails is logged
 * and left out, so billing still works with the others.
 */
@Injectable()
export class BillablesService {
  private readonly log = new Logger('Billables');

  /** The kinds the organization's modules offer now. */
  async kinds(db: Db, orgId: string): Promise<string[]> {
    return (await this.sources(db, orgId)).map((s) => s.kind);
  }

  private async sources(db: Db, orgId: string): Promise<BillableSource[]> {
    if (!SOURCES.length) return [];
    const modules = await modulesOf(db, orgId);
    return SOURCES.filter((s) => !s.module || modules[s.module] === true);
  }

  async open(db: Db, query: { orgId: string; projectIds: readonly string[]; subprojectId: string | null; to: string }): Promise<BillableItem[]> {
    if (!query.projectIds.length) return [];
    const out: BillableItem[] = [];
    for (const s of await this.sources(db, query.orgId)) {
      try {
        out.push(...(await s.open(db, query)).map((i) => ({ ...i, kind: s.kind })));
      } catch (err) {
        this.log.error(`billables ${s.kind} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  /** Records by kind and id (unknown kinds and ids are left out). */
  async byIds(db: Db, orgId: string, refs: readonly { kind: string; id: string }[]): Promise<BillableItem[]> {
    const out: BillableItem[] = [];
    for (const s of SOURCES) {
      const ids = refs.filter((r) => r.kind === s.kind).map((r) => r.id);
      if (!ids.length) continue;
      try {
        out.push(...(await s.byIds(db, { orgId, ids })).map((i) => ({ ...i, kind: s.kind })));
      } catch (err) {
        this.log.error(`billables ${s.kind} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }
}
