// The Flows page's list (Flows.tsx): one row per flow, whichever source it comes from. Plain TypeScript so Node tests
// import it (flowRows.test.mjs).
import type { ActionItem } from './Approvals';
import type { Box_, FlowItem } from './FlowDetail';

export type FlowsTab = 'todo' | 'mine' | 'done';

/** A flow to open (a notification, `#/flows?id=`): a row of `flows` or a workflow item (an absence, an expense report,
 * ...), on its tab when it names one; `at` tells two clicks on the same one apart. */
export interface FlowFocus {
  source: 'flow' | 'workflow';
  id: string;
  tab?: FlowsTab;
  at: number;
}

/** One row of the list, whichever source it comes from. */
export interface FlowRow {
  source: 'flow' | 'workflow';
  id: string;
  title: string;
  /** The flow's type (Art), also the filter. */
  type: string;
  /** Who it is about or from, and where it goes. */
  line: string;
  at: string;
  status: { label: string; color: 'warning' | 'info' | 'success' | 'error' };
  urgent?: boolean;
  confidential?: boolean;
}

export type RowLabels = {
  flow: (r: FlowItem & { box: Box_ }) => Pick<FlowRow, 'title' | 'type' | 'line' | 'status'>;
  item: (i: ActionItem) => Pick<FlowRow, 'title' | 'type' | 'line' | 'status'>;
};

/**
 * The tab's rows from both sources, newest first: in "To do" only what is still open, in "Done" only what is finished
 * (decided, resolved or archived); a workflow item of a request is left out where the request itself is listed.
 */
export function flowRows(
  tab: FlowsTab,
  requests: readonly (FlowItem & { box: Box_ })[],
  items: readonly ActionItem[],
  label: RowLabels,
  requestsListed: boolean,
): FlowRow[] {
  const seen = new Set<string>();
  const rows: FlowRow[] = [];
  for (const r of requests) {
    if (seen.has(r.id)) continue;
    if (tab === 'todo' && r.status === 'resolved') continue;
    if (tab === 'done' && r.box === 'inbox' && r.status !== 'resolved') continue;
    seen.add(r.id);
    rows.push({ source: 'flow', id: r.id, at: r.last_activity_at, urgent: r.urgent && r.status !== 'resolved', confidential: r.confidential, ...label.flow(r) });
  }
  for (const i of items) {
    if (requestsListed && i.source_table === 'flows') continue;
    // Done: what is finished, and what the caller did a step of that waits with someone else now (recalled).
    if (tab === 'done' && i.step_status === 'pending' && i.assigned_to_me !== false) continue;
    rows.push({ source: 'workflow', id: i.id, at: i.finished ?? i.started ?? '', ...label.item(i) });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * The Flows page's filters, sent to both sources (the API filters, so they reach every flow, not only the loaded ones).
 * `type`: `def:<workflow definition>` (a built-in kind: absence, timesheet, a plugin's), `type:<key>` (an own flow
 * type) or `free` (a Free Flow); `days`: last activity within so many days; `state`: open, done or sent back (Mine and
 * Done); `person`: who started it (To do and Done).
 */
export interface FlowFilters {
  type: string;
  days: number | null;
  state: '' | 'open' | 'done' | 'rejected';
  person: string;
  q: string;
}

export const NO_FILTERS: FlowFilters = { type: '', days: null, state: '', person: '', q: '' };

/** The day `days` before `today` (YYYY-MM-DD). */
export function sinceDay(days: number, today: Date = new Date()): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The query strings of the two sources for a tab and its filters, without paging: `workflows` for
 * `workflows/assigned-to-me`, `flows` for `organizations/:orgId/flows` (null: that source has nothing for the filters,
 * or the Free Flows are off). A flow of an own type comes from `flows` only when the Free Flows are on.
 */
export function flowQueries(tab: FlowsTab, f: FlowFilters, orgId: string, requestsListed: boolean, today: Date = new Date()): { workflows: string | null; flows: string | null } {
  const since = f.days ? sinceDay(f.days, today) : '';
  const state = tab === 'todo' ? '' : f.state;
  const person = tab === 'mine' ? '' : f.person;
  const common = (p: URLSearchParams) => {
    if (since) p.set('since', since);
    if (person) p.set('person', person);
    if (f.q.trim()) p.set('q', f.q.trim());
    return p;
  };
  const ownType = f.type === 'free' || f.type.startsWith('type:');
  let workflows: string | null = null;
  if (!(ownType && requestsListed)) {
    const p = new URLSearchParams({ scope: tab === 'mine' ? 'mine' : 'assigned', status: tab === 'todo' ? 'pending' : 'all', orgId });
    if (f.type.startsWith('def:')) p.set('definition', f.type.slice(4));
    else if (f.type.startsWith('type:')) p.set('definition', `flow:${f.type.slice(5)}`);
    if (state) p.set('state', state === 'open' ? 'pending' : state === 'done' ? 'approved' : 'rejected');
    workflows = common(p).toString();
  }
  let flows: string | null = null;
  // A Free Flow is never sent back; a built-in kind is not a row of `flows`.
  if (requestsListed && !f.type.startsWith('def:') && state !== 'rejected') {
    const p = new URLSearchParams({ box: tab === 'todo' ? 'inbox' : tab });
    if (f.type === 'free') p.set('type', 'free');
    else if (f.type.startsWith('type:')) p.set('type', f.type.slice(5));
    if (tab === 'todo') p.set('state', 'open');
    else if (state) p.set('state', state);
    flows = common(p).toString();
  }
  return { workflows, flows };
}

/**
 * Two lists, each newest first and loaded a page at a time, shown as one: while a source has more, only what is not
 * older than its oldest loaded row can be shown (the other's older rows wait for "Load older", else they would stand
 * where that source's next rows belong). The time from which rows are shown, or null for all.
 */
export function shownFrom(sources: readonly { more: boolean; oldest: string | null }[]): number | null {
  let from: number | null = null;
  for (const s of sources) {
    if (!s.more || !s.oldest) continue;
    const at = Date.parse(s.oldest);
    if (!Number.isNaN(at) && (from === null || at > from)) from = at;
  }
  return from;
}
