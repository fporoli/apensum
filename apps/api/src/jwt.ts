import { createHmac, createPublicKey, createVerify, timingSafeEqual, type JsonWebKeyInput } from 'node:crypto';

/**
 * Token verification for the API (zero extra dependencies).
 * - Local tokens (HS256, `worktime-api` issuer) are the only session tokens: minted by AuthController for the
 *   password login and for an SSO login alike.
 * - An SSO login (optional, one identity provider per instance: SSO_PROVIDER `dex` or `keycloak`, else none)
 *   hands its ID token to `auth/sso/exchange` once; it is verified here (RS256 against the provider's JWKS) and
 *   never used as a session.
 */

export const LOCAL_ISSUER = 'worktime-api';
export const LOCAL_ALG = 'HS256';

export interface AuthenticatedPrincipal {
  kind: 'sso' | 'local';
  /** The identity provider's `sub`, or the local user id. */
  sub: string;
  email?: string;
  /** The provider vouches for `email` (claim `email_verified`); only such an address finds or creates an account. */
  emailVerified?: boolean;
  /** A local token's password stamp (session-state.ts); absent in tokens issued before it existed. */
  pv?: string;
  /** The provider's display name (`name`, else `preferred_username`). */
  name?: string;
  /**
   * A restricted local token: `two-factor-setup` reaches only the two-step login setup (jwt.guard.ts
   * `TwoFactorSetup`), for someone an organization requires it of who has not set it up yet.
   */
  scope?: 'two-factor-setup';
}

/** How long a setup-only token lasts. */
export const TWO_FACTOR_SETUP_TOKEN_SEC = 30 * 60;

interface JwtHeader {
  alg: string;
  kid?: string;
}

export type SsoProvider = 'none' | 'dex' | 'keycloak';

/** The instance's identity provider (SSO_PROVIDER, set per GitHub Environment); anything else is none. */
export function ssoProvider(env: NodeJS.ProcessEnv = process.env): SsoProvider {
  const value = (env.SSO_PROVIDER ?? '').trim().toLowerCase();
  return value === 'dex' || value === 'keycloak' ? value : 'none';
}

/** The provider's issuer as browsers see it (`iss` of its tokens, base of its discovery document). */
export function ssoIssuer(env: NodeJS.ProcessEnv = process.env): string {
  return (env.JWT_ISSUER ?? '').trim().replace(/\/+$/, '');
}

/** The client the web app signs in with, the audience of its ID tokens. */
export function ssoClientId(env: NodeJS.ProcessEnv = process.env): string {
  return env.JWT_AUDIENCE || 'worktime-web';
}

/** What the login page needs to offer SSO; null when the instance has none (or no issuer). */
export function ssoPublicConfig(env: NodeJS.ProcessEnv = process.env): { provider: Exclude<SsoProvider, 'none'>; issuer: string; clientId: string } | null {
  const provider = ssoProvider(env);
  const issuer = ssoIssuer(env);
  if (provider === 'none' || !issuer) return null;
  return { provider, issuer, clientId: ssoClientId(env) };
}

function localSecret(): Buffer {
  const secret = process.env.API_JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('API_JWT_SECRET environment variable is required in production');
    }
    return Buffer.from('dev-only-secret-change-me', 'utf8');
  }
  return Buffer.from(secret, 'utf8');
}

/**
 * A key for one purpose other than session tokens (e.g. password-reset links), derived from
 * API_JWT_SECRET: a token signed with it can never pass as a session token, nor the other way round.
 */
export function purposeKey(purpose: string): Buffer {
  return createHmac('sha256', localSecret()).update(`purpose:${purpose}`).digest();
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function b64urlEncode(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseToken(token: string): { header: JwtHeader; payload: Record<string, unknown>; signingInput: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64urlDecode(parts[0]).toString('utf8')) as JwtHeader,
      payload: JSON.parse(b64urlDecode(parts[1]).toString('utf8')) as Record<string, unknown>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

function checkTimeClaims(payload: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) return false;
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) return false;
  return true;
}

function checkAudience(payload: Record<string, unknown>, audience: string): boolean {
  const aud = payload.aud;
  const list = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
  return (list as unknown[]).includes(audience) || payload.azp === audience;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [k: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;
/** An ID token is exchanged right after the login: an older one is refused, whatever its own expiry says. */
export const SSO_TOKEN_MAX_AGE_SEC = 10 * 60;

/** For tests: reset the cached remote JWKS. */
export function resetJwksCache() {
  jwksCache = null;
}

/**
 * Where to download the provider's signing keys: JWT_JWKS_URL when the API reaches the provider at another
 * address than browsers do (inside Docker), else the `jwks_uri` of its discovery document.
 */
async function jwksUrl(): Promise<string> {
  if (process.env.JWT_JWKS_URL) return process.env.JWT_JWKS_URL;
  const res = await fetch(`${ssoIssuer()}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`discovery-failed:${res.status}`);
  const doc = (await res.json()) as { jwks_uri?: unknown };
  if (typeof doc.jwks_uri !== 'string') throw new Error('discovery-without-jwks');
  return doc.jwks_uri;
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(await jwksUrl());
  if (!res.ok) throw new Error(`jwks-fetch-failed:${res.status}`);
  const data = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

/**
 * Verifies an ID token of the instance's identity provider: RS256 signature against its JWKS, issuer, audience
 * (the web client), expiry and age. Null when SSO is off or anything does not hold.
 */
export async function verifySsoIdToken(
  token: string,
  keys?: Jwk[],
  nowSec = Math.floor(Date.now() / 1000),
): Promise<AuthenticatedPrincipal | null> {
  if (!ssoPublicConfig()) return null;
  const parsed = parseToken(token);
  if (!parsed || parsed.header.alg !== 'RS256') return null;
  if (parsed.payload.iss !== ssoIssuer()) return null;
  if (!checkTimeClaims(parsed.payload, nowSec)) return null;
  if (typeof parsed.payload.exp !== 'number') return null;
  if (typeof parsed.payload.iat !== 'number' || parsed.payload.iat < nowSec - SSO_TOKEN_MAX_AGE_SEC || parsed.payload.iat > nowSec + 60) return null;
  if (!checkAudience(parsed.payload, ssoClientId())) return null;
  let jwks = keys ?? null;
  try {
    jwks = jwks ?? (await getJwks());
  } catch {
    return null;
  }
  const candidates = parsed.header.kid ? jwks.filter((k) => k.kid === parsed.header.kid) : jwks;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk as unknown as JsonWebKeyInput['key'], format: 'jwk' });
      const verifier = createVerify('RSA-SHA256');
      verifier.update(parsed.signingInput);
      if (!verifier.verify(key, parsed.signature)) continue;
      if (typeof parsed.payload.sub !== 'string' || !parsed.payload.sub) return null;
      const name = typeof parsed.payload.name === 'string' ? parsed.payload.name
        : typeof parsed.payload.preferred_username === 'string' ? parsed.payload.preferred_username : undefined;
      return {
        kind: 'sso',
        sub: parsed.payload.sub,
        email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined,
        emailVerified: parsed.payload.email_verified === true,
        ...(name ? { name } : {}),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** A local session token; `pv` is the stamp of the password it was issued for (session-state.ts). */
export async function mintLocalToken(userId: string, email: string, expiresInSec = 12 * 3600, scope?: 'two-factor-setup', pv?: string): Promise<string> {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ alg: LOCAL_ALG, typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(
    Buffer.from(JSON.stringify({ iss: LOCAL_ISSUER, sub: userId, email, iat: now, exp: now + expiresInSec, ...(scope ? { scope } : {}), ...(pv ? { pv } : {}) })),
  );
  const sig = createHmac('sha256', localSecret()).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

export async function verifyLocalToken(token: string): Promise<AuthenticatedPrincipal | null> {
  const parsed = parseToken(token);
  if (!parsed || parsed.header.alg !== LOCAL_ALG) return null;
  if (parsed.payload.iss !== LOCAL_ISSUER) return null;
  if (!checkTimeClaims(parsed.payload)) return null;
  const expected = createHmac('sha256', localSecret()).update(parsed.signingInput).digest();
  if (expected.length !== parsed.signature.length || !timingSafeEqual(expected, parsed.signature)) return null;
  if (typeof parsed.payload.sub !== 'string') return null;
  const scope = parsed.payload.scope;
  if (scope !== undefined && scope !== 'two-factor-setup') return null;
  return {
    kind: 'local',
    sub: parsed.payload.sub,
    email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined,
    ...(scope ? { scope } : {}),
    ...(typeof parsed.payload.pv === 'string' ? { pv: parsed.payload.pv } : {}),
  };
}

/** A session token: local only (an SSO login is exchanged for one, `auth/sso/exchange`). */
export async function authenticateToken(token: string): Promise<AuthenticatedPrincipal | null> {
  return verifyLocalToken(token);
}
