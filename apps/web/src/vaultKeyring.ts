// The browser's keyring for the vault's end-to-end encryption (docs/VAULT.md, @worktime3/shared/vault). Moved from
// the cases plugin; every module with encrypted objects uses it (plugin contract).
//
// The unlocked private key lives only in this module's memory: never in localStorage, never sent anywhere. It is gone
// on reload, on lock, on logout (`lockKeyring`) and after the organization's idle minutes without use (default 30).
// Object keys are cached in memory too, so an object is unwrapped once per unlock.
import { useSyncExternalStore } from 'react';
import {
  WrongPassphraseError,
  changePassphrase as rewrapPrivateKey,
  createObjectKey,
  createUserKeys,
  unlockPrivateKey,
  unwrapObjectKey,
  wrapObjectKey,
  type UserKeyRecord,
} from '@worktime3/shared/vault';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export type KeyringState = 'unknown' | 'none' | 'locked' | 'unlocked';
type Headers = () => Promise<Record<string, string>>;
export class KeyringError extends Error {}

let state: KeyringState = 'unknown';
let record: UserKeyRecord | null = null;
let privateKey: CryptoKey | null = null;
// The public key of the pair `privateKey` belongs to: when the server's pair is another one (replaced in another
// browser, or a demo reset made new ones), the key in memory opens nothing any more and is dropped.
let unlockedPublicKey: string | null = null;
const objectKeys = new Map<string, CryptoKey>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let idleMs = 30 * 60 * 1000;
// When the keyring locks itself if nothing uses it before (ms since the epoch; null while locked).
let lockAt: number | null = null;
const listeners = new Set<() => void>();

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

function set(next: KeyringState) {
  state = next;
  listeners.forEach((l) => l());
}

function touch() {
  clearTimeout(idleTimer);
  if (privateKey) {
    idleTimer = setTimeout(lockKeyring, idleMs);
    lockAt = Date.now() + idleMs;
    listeners.forEach((l) => l());
  }
}

/** The organization's minutes without use before the keyring locks itself. */
export const idleMinutes = () => Math.round(idleMs / 60_000);

/** Minutes until the keyring locks itself without use (rounded up), or null while it is locked. */
export function minutesUntilAutoLock(): number | null {
  if (!privateKey || lockAt === null) return null;
  return Math.max(1, Math.ceil((lockAt - Date.now()) / 60_000));
}

/** Forget every secret held in memory (lock button, logout, idle). */
export function lockKeyring() {
  clearTimeout(idleTimer);
  lockAt = null;
  privateKey = null;
  unlockedPublicKey = null;
  objectKeys.clear();
  if (state === 'unlocked') set('locked');
}

export function useKeyringState(): KeyringState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

async function call(orgId: string, headers: Headers, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}/organizations/${orgId}/vault/${path}`, {
    method,
    headers: { ...(await headers()), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.ok === false) throw new KeyringError(data.error ?? 'error');
  if (!res.ok) throw new KeyringError(data?.message ?? 'error');
  return data;
}

const objectPath = (kind: string, id: string) => `objects/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;

/** Asks the server whether the user already has a key pair (and the organization's idle minutes). */
export async function loadKeyring(orgId: string, headers: Headers): Promise<KeyringState> {
  const { keys, idleMinutes } = await call(orgId, headers, 'me');
  if (typeof idleMinutes === 'number' && idleMinutes > 0) {
    const next = idleMinutes * 60_000;
    if (next !== idleMs) {
      idleMs = next;
      touch();
    }
  }
  record = keys as UserKeyRecord | null;
  // A key in memory from another key pair than the server's: locked, so the page asks to unlock again
  // instead of showing "unlocked" and opening nothing.
  if (privateKey && record?.publicKey !== unlockedPublicKey) {
    clearTimeout(idleTimer);
    lockAt = null;
    privateKey = null;
    unlockedPublicKey = null;
    objectKeys.clear();
  }
  if (!record) set('none');
  else if (!privateKey) set('locked');
  return state;
}

/** First use: makes the key pair in the browser and stores it sealed under the passphrase. Stays unlocked. */
export async function setUpKeyring(orgId: string, headers: Headers, passphrase: string) {
  const rec = await createUserKeys(passphrase);
  await call(orgId, headers, 'me', 'PUT', rec);
  record = rec;
  privateKey = await unlockPrivateKey(rec, passphrase);
  unlockedPublicKey = rec.publicKey;
  touch();
  set('unlocked');
}

/** Throws `WrongPassphraseError` for a wrong passphrase. */
export async function unlockKeyring(passphrase: string) {
  if (!record) throw new KeyringError('no-keys');
  privateKey = await unlockPrivateKey(record, passphrase);
  unlockedPublicKey = record.publicKey;
  objectKeys.clear();
  touch();
  set('unlocked');
}

export async function changeKeyringPassphrase(orgId: string, headers: Headers, oldPassphrase: string, newPassphrase: string) {
  if (!record) throw new KeyringError('no-keys');
  const next = await rewrapPrivateKey(record, oldPassphrase, newPassphrase);
  await call(orgId, headers, 'me/passphrase', 'POST', next);
  record = next;
  privateKey = await unlockPrivateKey(next, newPassphrase);
  unlockedPublicKey = next.publicKey;
  touch();
}

export const isUnlocked = () => state === 'unlocked';

/** The object's key for this user, or null when the object is not encrypted. Needs an unlocked keyring. */
export async function objectKeyFor(orgId: string, headers: Headers, kind: string, id: string): Promise<CryptoKey | null> {
  if (!privateKey) throw new KeyringError('locked');
  touch();
  const cached = objectKeys.get(keyOf(kind, id));
  if (cached) return cached;
  const info = await call(orgId, headers, `${objectPath(kind, id)}/keys`);
  if (!info.encrypted) return null;
  if (!info.mine) throw new KeyringError('no-object-key');
  const key = await unwrapObjectKey(info.mine, privateKey);
  objectKeys.set(keyOf(kind, id), key);
  return key;
}

/** A fresh key for an object about to be created or converted, with its wrapping for the caller; remembered in memory. */
export async function newObjectKey(kind: string, id: string): Promise<{ key: CryptoKey; wrappedKey: string }> {
  if (!privateKey || !record) throw new KeyringError('locked');
  touch();
  const key = await createObjectKey();
  objectKeys.set(keyOf(kind, id), key);
  return { key, wrappedKey: await wrapObjectKey(key, record.publicKey) };
}

/** Forgets a key whose object was not created after all. */
export const forgetObjectKey = (kind: string, id: string) => void objectKeys.delete(keyOf(kind, id));

/** The object key from the wrapped copy a list returns, or null when locked / not ours (the object then stays closed). */
export async function objectKeyFromList(kind: string, id: string, wrapped: string | null | undefined): Promise<CryptoKey | null> {
  if (!privateKey || !wrapped) return null;
  const cached = objectKeys.get(keyOf(kind, id));
  if (cached) return cached;
  try {
    const key = await unwrapObjectKey(wrapped, privateKey);
    objectKeys.set(keyOf(kind, id), key);
    touch();
    return key;
  } catch {
    return null;
  }
}

/** Encrypts an object for the first time: a fresh key, wrapped for the caller. Returns the key. */
export async function createObjectKeyFor(orgId: string, headers: Headers, kind: string, id: string, myUserId: string): Promise<CryptoKey> {
  if (!privateKey || !record) throw new KeyringError('locked');
  const key = await createObjectKey();
  await call(orgId, headers, `${objectPath(kind, id)}/keys/${myUserId}`, 'PUT', { wrappedKey: await wrapObjectKey(key, record.publicKey) });
  objectKeys.set(keyOf(kind, id), key);
  touch();
  return key;
}

/** Hands an object's key to a colleague who has set up their keys (their public key is fetched here). */
export async function shareObjectKey(orgId: string, headers: Headers, kind: string, id: string, userId: string) {
  const key = await objectKeyFor(orgId, headers, kind, id);
  if (!key) throw new KeyringError('not-encrypted');
  const { publicKey } = await call(orgId, headers, `users/${userId}`);
  await call(orgId, headers, `${objectPath(kind, id)}/keys/${userId}`, 'PUT', { wrappedKey: await wrapObjectKey(key, publicKey) });
}

/** Who may be given an object's key, for a sharing dialog (names, holder, has keys, may open it). */
export async function objectKeyCandidates(orgId: string, headers: Headers, kind: string, id: string) {
  const { candidates } = await call(orgId, headers, `${objectPath(kind, id)}/candidates`);
  return candidates as { userId: string; name: string; holder: boolean; hasKeys: boolean; canAccess: boolean; me: boolean }[];
}

/** Remembers an object's new key after a rotation, so the page keeps reading it without another unwrap. */
export const rememberObjectKey = (kind: string, id: string, key: CryptoKey) => void objectKeys.set(keyOf(kind, id), key);

export { WrongPassphraseError };
