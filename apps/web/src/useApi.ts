import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, type ApiResult } from './apiRequest';

export interface UseApiOptions {
  /** Load again every so many milliseconds while the page is open (e.g. presence that changes during the day). */
  refreshMs?: number;
}

export interface UseApi<T> {
  /** The last answer that arrived; kept while a reload runs, so the page does not flicker. */
  data: T | null;
  /** The error code of the last load (the API's `error`, or `cannot-reach-api` / `bad-response` / `http-<status>`). */
  error: string | null;
  /** True until the first answer, and while `reload` runs. */
  loading: boolean;
  reload: () => Promise<ApiResult<T> | null>;
  /** Hides the error (the page's Alert onClose); the next failed load shows it again. */
  clearError: () => void;
}

/**
 * Loads `url` (null = nothing to load yet) with the caller's headers, again whenever the url changes, and on
 * `reload` (after the page changed something). An answer that arrives after a newer request, or after the page
 * left, is dropped. New pages use this instead of their own fetch/useEffect/loading/error state (CLAUDE.md).
 */
export function useApi<T>(url: string | null, authHeaders: () => Promise<Record<string, string>>, options: UseApiOptions = {}): UseApi<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const latest = useRef(0);
  // The headers function may be a new one on every render; the latest is used, without reloading for it.
  const headersRef = useRef(authHeaders);
  headersRef.current = authHeaders;

  const reload = useCallback(async () => {
    if (url === null) return null;
    const call = ++latest.current;
    setLoading(true);
    const result = await apiRequest<T>(url, { headers: await headersRef.current() });
    if (call !== latest.current) return null;
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
    return result;
  }, [url]);

  useEffect(() => {
    setData(null);
    void reload();
    const timer = options.refreshMs ? window.setInterval(() => void reload(), options.refreshMs) : undefined;
    return () => {
      latest.current++;
      if (timer) window.clearInterval(timer);
    };
  }, [reload, options.refreshMs]);

  const clearError = useCallback(() => setError(null), []);
  return { data, error, loading, reload, clearError };
}
