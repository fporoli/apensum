import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** GET health, once per page load: the app bar's instance box and the test-file buttons share it. */
let health: Promise<Record<string, unknown> | null> | null = null;

export function loadHealth(): Promise<Record<string, unknown> | null> {
  health ??= fetch(`${API}/health`, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => {
      health = null; // tried again next time
      return null;
    });
  return health;
}

/** The instance's name from GET health (`development`, `local`, `test`, `demo`, `preprod`), or null: prod or unknown. */
export function instanceName(data: Record<string, unknown> | null): string | null {
  const instance = data?.instance as { name?: unknown } | null | undefined;
  return typeof instance?.name === 'string' ? instance.name : null;
}

/** Whether this is an instance but prod (one that names itself in GET health): only there test files are offered. */
export function useTestInstance(): boolean {
  const [test, setTest] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadHealth().then((data) => { if (!cancelled) setTest(instanceName(data) !== null); });
    return () => { cancelled = true; };
  }, []);
  return test;
}
