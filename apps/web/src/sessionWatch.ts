// The session ends when the API says so (401 on a request that carried the token: expired, the password changed, the
// account deactivated; API session-state.ts): the app then signs out and the login page says why. Installed once.
export const SESSION_ENDED_EVENT = 'apensum:session-ended';
const ENDED_FLAG = 'worktime.sessionEnded';

let installed = false;

/** Watches every fetch to `apiBase`: a 401 for a request with an Authorization header fires SESSION_ENDED_EVENT. */
export function watchSession(apiBase: string): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (res.status === 401) {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (url.startsWith(apiBase) && headers.has('Authorization')) window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
      } catch { /* not a request we can read: nothing to do */ }
    }
    return res;
  };
}

/** Remembers for the login page that the session ended (this tab only). */
export function markSessionEnded(): void {
  try { sessionStorage.setItem(ENDED_FLAG, '1'); } catch { /* the login page just won't say why */ }
}

/** Whether the session ended just before (read once). */
export function takeSessionEnded(): boolean {
  try {
    const ended = sessionStorage.getItem(ENDED_FLAG) === '1';
    sessionStorage.removeItem(ENDED_FLAG);
    return ended;
  } catch {
    return false;
  }
}
