import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { formatLocaleNumber, useI18n } from '@worktime3/web/plugin';

interface Page<T, D> { entries: T[]; hasMore: boolean; draft?: D | null }

export function useExpensePage<T, D = never>(url: string | null, authHeaders: () => Promise<Record<string, string>>) {
  const [position, setPosition] = useState({ url, index: 0 });
  const page = position.url === url ? position.index : 0;
  const [revision, refresh] = useState(0);
  const [result, setResult] = useState<{ url: string; page: number; revision: number; data?: Page<T, D> }>();
  const auth = useRef(authHeaders);
  auth.current = authHeaders;
  const go = useCallback((index: number) => setPosition({ url, index }), [url]);
  const reload = useCallback(() => refresh(n => n + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${url}&page=${page}&pageSize=25`, { headers: await auth.current(), signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as Page<T, D>;
        if (!Array.isArray(data.entries) || typeof data.hasMore !== 'boolean') throw new Error();
        if (controller.signal.aborted) return;
        if (page > 0 && !data.entries.length) go(page - 1);
        else setResult({ url, page, revision, data });
      } catch {
        if (!controller.signal.aborted) setResult({ url, page, revision });
      }
    })();
    return () => controller.abort();
  }, [url, page, revision, go]);

  const current = result?.url === url && result?.page === page ? result : undefined;
  const fresh = current?.revision === revision;
  return {
    entries: current?.data?.entries ?? [],
    draft: result?.url === url ? result?.data?.draft ?? null : null,
    hasMore: !!current?.data?.hasMore,
    loading: !!url && !fresh,
    failed: !!url && fresh && !current?.data,
    page,
    go,
    reload,
  };
}

export function ExpensePager({ page, hasMore, loading, go }: { page: number; hasMore: boolean; loading: boolean; go: (page: number) => void }) {
  const { t, locale } = useI18n();
  if (page === 0 && !hasMore) return null;
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ mt: 1 }}>
      <Button size="small" disabled={loading || page === 0} onClick={() => go(page - 1)}>{t('expenses.paging.previous')}</Button>
      <Typography variant="body2">{t('expenses.paging.page', { page: formatLocaleNumber(page + 1, locale) })}</Typography>
      <Button size="small" disabled={loading || !hasMore} onClick={() => go(page + 1)}>{t('expenses.paging.next')}</Button>
    </Stack>
  );
}
