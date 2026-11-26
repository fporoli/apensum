// The Flows page's list (Flows.tsx): one row per flow, whichever source it comes from. Plain TypeScript so Node tests
// import it (flowRows.test.mjs).
import type { ActionItem } from './Approvals';
import type { Box_, FlowItem } from './FlowDetail';

export type FlowsTab = 'todo' | 'mine' | 'done';

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
    if (tab === 'done' && i.step_status === 'pending') continue;
    rows.push({ source: 'workflow', id: i.id, at: i.finished ?? i.started ?? '', ...label.item(i) });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
