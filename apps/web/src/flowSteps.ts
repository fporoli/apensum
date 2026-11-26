// A flow's steps as its detail shows them (Requests.tsx, WorkflowPanel): done (by whom, when), the one it waits at
// (how many of the assignees did it, for a step everyone does on their own), sent back, skipped (its condition did not
// hold) or still to come. Worked out from the thread's step events (request-workflow.ts threadEvent) since the flow was
// last submitted. Plain TypeScript so Node tests import it (flowSteps.test.mjs).

export type StepState = 'done' | 'current' | 'returned' | 'skipped' | 'upcoming';

export interface StepEvent {
  data: { workflow?: string; step?: { key: string } | null; automatic?: boolean };
  author_name: string | null;
  posted_at: string;
}

export interface StepProgress {
  key: string;
  state: StepState;
  /** Who did it (or, at the current step, who did it so far), oldest first; empty when the system did it. */
  by: string[];
  /** When it was last done or sent back. */
  at: string | null;
  automatic: boolean;
}

const DONE = new Set(['approved', 'done', 'mailed']);

export function stepProgress(
  steps: readonly { key: string }[],
  events: readonly StepEvent[],
  current: { step: string; status: 'pending' | 'approved' | 'rejected' },
): StepProgress[] {
  // A resubmission starts the steps over: only what happened since counts.
  const lastStart = events.reduce((n, e, i) => (e.data.workflow === 'resubmitted' ? i : n), -1);
  const since = events.slice(lastStart + 1);
  const at = steps.findIndex((s) => s.key === current.step);
  return steps.map((s, i) => {
    const mine = since.filter((e) => e.data.step?.key === s.key);
    const done = mine.filter((e) => e.data.workflow && DONE.has(e.data.workflow));
    const returned = mine.filter((e) => e.data.workflow === 'returned');
    const by = done.filter((e) => !e.data.automatic && e.data.workflow !== 'mailed').map((e) => e.author_name ?? '').filter(Boolean);
    const automatic = done.length > 0 && done.every((e) => e.data.automatic || e.data.workflow === 'mailed');
    const last = (list: readonly StepEvent[]) => (list.length ? list[list.length - 1].posted_at : null);
    let state: StepState;
    if (current.status === 'approved' || i < at) state = done.length ? 'done' : 'skipped';
    else if (i === at) state = current.status === 'rejected' ? 'returned' : 'current';
    else state = 'upcoming';
    return { key: s.key, state, by: [...new Set(by)], at: state === 'returned' ? last(returned) : last(done), automatic };
  });
}
