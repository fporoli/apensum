// What the organization calls its customers (organizations.settings.customers.term, 127): Kunde, Auftraggeber or
// Mandant. App.tsx loads it when the organization changes (GET customers-term); the Customers page sets it when an
// editor changes it. A text that names them has a variant per term (`<key>.client`, `<key>.principal`, in the core's
// dictionaries or a plugin's); `useTermT` picks it, `termKeyOf` for a key outside a component (the navbar).
import { useSyncExternalStore } from 'react';
import { parseCustomerTerm, termKey, type CustomerTerm } from '@worktime3/shared/customers';
import { DICTIONARIES } from './dictionaries';
import { useI18n, type TFunction } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

let term: CustomerTerm = 'customer';
const listeners = new Set<() => void>();

export function setCustomerTerm(next: CustomerTerm) {
  if (next === term) return;
  term = next;
  for (const l of listeners) l();
}

export function useCustomerTerm(): CustomerTerm {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => term);
}

/** The organization's term from the API (every member may read it); 'customer' when it cannot be read. */
export async function loadCustomerTerm(orgId: string, authHeaders: () => Promise<Record<string, string>>): Promise<void> {
  try {
    const res = await fetch(`${API}/organizations/${orgId}/customers-term`, { headers: await authHeaders() });
    const data = await res.json().catch(() => null);
    setCustomerTerm(parseCustomerTerm(data?.term));
  } catch {
    setCustomerTerm('customer');
  }
}

/** A key with the term's variant, where the English dictionary (the reference: every key is there) has one. */
export function termKeyOf(key: string, t: CustomerTerm = term): string {
  return termKey(key, t, (k) => k in DICTIONARIES.en);
}

/** The app's `t` with the organization's term. */
export function useTermT(): TFunction {
  const { t } = useI18n();
  const current = useCustomerTerm();
  return (key, vars) => t(termKeyOf(key, current), vars);
}
