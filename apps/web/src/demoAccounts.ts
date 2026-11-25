// The demo instance's accounts (global static data `login` / `demo_accounts`, public `GET auth/demo-accounts`):
// the login screen's dropdown, the sign-in without a session (`DEMO_AUTO_LOGIN`) and the user menu's switcher.
// Switching is an ordinary sign-in with that account's published demo password, never a token for another
// account; only instances that show demo accounts (VITE_SHOW_DEMO_ACCOUNTS) offer it.
import type { Session } from './Login';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
export const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

export interface DemoAccount {
  /** The role it shows, e.g. "Manager (Acme)". */
  name: string;
  user: string;
  password: string;
}

/** A person of the demo organization to switch to (`DEMO_AUTO_LOGIN`, from the database: roles and department in force). */
export interface DemoPerson extends DemoAccount {
  roles: string[];
  department: string | null;
}

export interface DemoAccounts {
  /** The login screen's list. */
  accounts: DemoAccount[];
  /** The user menu's switcher (the demo instance only), the auto-login account first. */
  people: DemoPerson[];
  /** The account to sign in as without a session, or null. */
  autoLogin: string | null;
}

const NONE: DemoAccounts = { accounts: [], people: [], autoLogin: null };
let loading: Promise<DemoAccounts> | null = null;

export function loadDemoAccounts(): Promise<DemoAccounts> {
  if (!SHOW_DEMO_ACCOUNTS) return Promise.resolve(NONE);
  loading ??= fetch(`${API}/auth/demo-accounts`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => ({
      accounts: Array.isArray(data?.accounts) ? (data.accounts as DemoAccount[]) : [],
      people: Array.isArray(data?.people) ? (data.people as DemoPerson[]) : [],
      autoLogin: typeof data?.autoLogin === 'string' ? data.autoLogin : null,
    }))
    .catch(() => {
      loading = null;
      return NONE;
    });
  return loading;
}

/** Signs in with a demo account's password; throws the API's error code. */
export async function signInAsDemo(account: DemoAccount): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.user, password: account.password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || typeof data.token !== 'string') throw new Error(data?.error ?? 'request-failed');
  return data as Session;
}

// After "Log out" the login page shows instead of signing in again, for this tab.
const AUTO_LOGIN_OFF = 'worktime.demoAutoLoginOff';

export function demoAutoLoginOff(): boolean {
  try {
    return sessionStorage.getItem(AUTO_LOGIN_OFF) === '1';
  } catch {
    return false;
  }
}

export function setDemoAutoLoginOff() {
  try {
    sessionStorage.setItem(AUTO_LOGIN_OFF, '1');
  } catch {
    // Without storage the login page shows after a reload anyway.
  }
}

const BUILTIN_ROLES = new Set(['owner', 'admin', 'manager', 'member', 'hr', 'developer', 'billing_admin', 'guest']);

/** "Admin, HR · People & Culture": the roles (built-in ones translated) and the department. */
export function demoLabel(person: DemoPerson, t: (key: string) => string): string {
  const roles = person.roles.map((r) => (BUILTIN_ROLES.has(r) ? t(`roles.builtin.${r}`) : r.charAt(0).toUpperCase() + r.slice(1))).join(', ');
  return [roles, person.department].filter(Boolean).join(' · ');
}
