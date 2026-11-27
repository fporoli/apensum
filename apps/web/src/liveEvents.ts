// Live reloads: what changed for the signed-in person, pushed over the notifications' WebSocket (useNotifications.ts),
// so open lists load again by themselves instead of polling. A push names the record it is about (`sourceTable`,
// `sourceId`, as notifications do); after the socket was down (a push may have been missed) a `resync` reaches every
// list. Pages and plugins subscribe with `useLive` (in the plugin contract); pure parts tested in liveEvents.test.mjs.
import { useEffect, useRef } from 'react';

export interface LiveEvent {
  /** The table of the record it is about (`flows`, `absences`, `expense_reports`, a plugin's `notes.notes`, ...). */
  sourceTable: string | null;
  sourceId: string | null;
  /** The connection came back: anything may have changed meanwhile. */
  resync?: boolean;
}

type Listener = (event: LiveEvent) => void;
const listeners = new Set<Listener>();

/** Tells every subscriber (useNotifications: a push arrived, or the socket is back). */
export function publishLive(event: LiveEvent): void {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch {
      /* one page's error never stops the others */
    }
  }
}

/** Listens until the returned function is called. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether an event concerns a page that shows `tables` (`true`: every table); a resync concerns all. */
export function liveMatches(event: LiveEvent, tables: true | readonly string[]): boolean {
  if (event.resync || tables === true) return true;
  return !!event.sourceTable && tables.includes(event.sourceTable);
}

/** How long a page waits for more pushes before it loads again (several come at once, e.g. a step to a team). */
export const LIVE_DEBOUNCE_MS = 400;

/**
 * Calls `onChange` when something about `tables` changed for the signed-in person (a push), or after the connection
 * came back; several pushes at once give one call. The latest `onChange` is used, without subscribing again.
 * `null`: not listening (a hook can't be called conditionally).
 */
export function useLive(onChange: (event: LiveEvent) => void, tables: true | readonly string[] | null): void {
  const handler = useRef(onChange);
  handler.current = onChange;
  const key = tables === null ? null : tables === true ? '*' : [...tables].sort().join(',');
  useEffect(() => {
    if (key === null) return;
    const wanted: true | string[] = key === '*' ? true : key.split(',').filter(Boolean);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: LiveEvent | null = null;
    const off = subscribeLive((event) => {
      if (!liveMatches(event, wanted)) return;
      last = event;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (last) handler.current(last); }, LIVE_DEBOUNCE_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}
