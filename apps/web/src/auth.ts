import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * Single sign-on through the instance's identity provider (Dex or Keycloak, whichever the API names in
 * `GET auth/sso`; none = no SSO button). OpenID Connect code flow with PKCE: the browser signs in there, comes
 * back with a code, and hands the ID token to the API once (`auth/sso/exchange`), which returns a session like
 * a password login's. Nothing of the provider's is kept afterwards.
 */

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export interface SsoConfig {
  provider: 'dex' | 'keycloak';
  issuer: string;
  clientId: string;
}

let configPromise: Promise<SsoConfig | null> | null = null;

/** The instance's SSO, asked once; null when it has none or the API cannot be reached. */
export function ssoConfig(): Promise<SsoConfig | null> {
  if (!configPromise) {
    configPromise = fetch(`${API}/auth/sso`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data?.enabled && typeof data.issuer === 'string' && typeof data.clientId === 'string'
        ? { provider: data.provider, issuer: data.issuer, clientId: data.clientId }
        : null))
      .catch(() => null);
  }
  return configPromise;
}

function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

function manager(config: SsoConfig): UserManager {
  return new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    loadUserInfo: false,
    automaticSilentRenew: false,
    monitorSession: false,
    // Only the state of the redirect, for this tab; the user is removed right after the exchange.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

/** Sends the browser to the identity provider. */
export async function startSsoLogin(): Promise<void> {
  const config = await ssoConfig();
  if (!config) throw new Error('sso-off');
  await manager(config).signinRedirect();
}

/** The URL is the provider's answer (code and state, or an error). */
export function isSsoCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

/**
 * Finishes a login the provider sent back: the ID token (state, PKCE and nonce checked by the library), with the
 * code and state taken out of the address bar. Throws when it does not hold.
 */
export async function completeSsoLogin(): Promise<string> {
  const config = await ssoConfig();
  const url = window.location.href;
  // Out of the address bar first, so a reload never replays the code.
  window.history.replaceState(null, '', redirectUri() + window.location.hash);
  if (!config) throw new Error('sso-off');
  const users = manager(config);
  try {
    const user = await users.signinRedirectCallback(url);
    if (!user.id_token) throw new Error('sso-invalid');
    return user.id_token;
  } finally {
    await users.removeUser().catch(() => {});
  }
}
