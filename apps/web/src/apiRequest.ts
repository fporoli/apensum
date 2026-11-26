// One way to call the API and read its answer (useApi.ts builds the loading on it). The API answers with
// `{ ok: false, error: 'kebab-code' }` on refusal and with a JSON body (an object or a list) on success; a network
// failure, a body that is not JSON or an HTTP error without one become codes too, so a page has one shape to handle.
// Pure (no React), tested in apiRequest.test.mjs.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The codes this file adds to the API's own (shown with `common.cannotReachApi` / the page's "failed" text). */
export const CANNOT_REACH_API = 'cannot-reach-api';
export const BAD_RESPONSE = 'bad-response';

export interface ApiRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Replaceable in tests. */
  fetchImpl?: typeof fetch;
}

/** Calls `url` and reads the answer as ApiResult; never throws (an aborted call rejects, as fetch does). */
export async function apiRequest<T>(url: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
  const doFetch = init.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: init.method ?? 'GET',
      signal: init.signal,
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return { ok: false, error: CANNOT_REACH_API };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: res.ok ? BAD_RESPONSE : `http-${res.status}` };
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && (data as { ok?: unknown }).ok === false) {
    const error = (data as { error?: unknown }).error;
    return { ok: false, error: typeof error === 'string' && error ? error : 'unknown' };
  }
  if (!res.ok) return { ok: false, error: `http-${res.status}` };
  return { ok: true, data: data as T };
}
