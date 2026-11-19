// The browser's keyring for Cases' end-to-end encryption (shared/caseCrypto.ts).
//
// The unlocked private key lives only in this module's memory: never in localStorage, never sent anywhere.
// It is gone on reload, on lock, on logout (`lockKeyring`) and after IDLE_LOCK_MS without use. Case keys are
// cached in memory too, so a case is unwrapped once per unlock.
import { useSyncExternalStore } from 'react';
import {
  WrongPassphraseError,
  changePassphrase as rewrapPrivateKey,
  createCaseKey,
  createUserKeys,
  unlockPrivateKey,
  unwrapCaseKey,
  wrapCaseKey,
  type UserKeyRecord,
} from '../shared/caseCrypto';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const IDLE_LOCK_MS = 30 * 60 * 1000;

export type KeyringState = 'unknown' | 'none' | 'locked' | 'unlocked';
type Headers = () => Promise<Record<string, string>>;
export class KeyringError extends Error {}

let state: KeyringState = 'unknown';
let record: UserKeyRecord | null = null;
let privateKey: CryptoKey | null = null;
const caseKeys = new Map<string, CryptoKey>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: KeyringState) {
  state = next;
  listeners.forEach((l) => l());
}

function touch() {
  clearTimeout(idleTimer);
  if (privateKey) idleTimer = setTimeout(lockKeyring, IDLE_LOCK_MS);
}

/** Forget every secret held in memory (lock button, logout, idle). */
export function lockKeyring() {
  clearTimeout(idleTimer);
  privateKey = null;
  caseKeys.clear();
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
  const res = await fetch(`${API}/organizations/${orgId}/${path}`, {
    method,
    headers: { ...(await headers()), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.ok === false) throw new KeyringError(data.error ?? 'error');
  if (!res.ok) throw new KeyringError(data?.message ?? 'error');
  return data;
}

/** Asks the server whether the user already has a key pair. Call when Cases opens. */
export async function loadKeyring(orgId: string, headers: Headers): Promise<KeyringState> {
  const { keys } = await call(orgId, headers, 'case-keys/me');
  record = keys as UserKeyRecord | null;
  if (!record) {
    privateKey = null;
    set('none');
  } else if (!privateKey) set('locked');
  return state;
}

/** First use: makes the key pair in the browser and stores it sealed under the passphrase. Stays unlocked. */
export async function setUpKeyring(orgId: string, headers: Headers, passphrase: string) {
  const rec = await createUserKeys(passphrase);
  await call(orgId, headers, 'case-keys/me', 'PUT', rec);
  record = rec;
  privateKey = await unlockPrivateKey(rec, passphrase);
  touch();
  set('unlocked');
}

/** Throws `WrongPassphraseError` for a wrong passphrase. */
export async function unlockKeyring(passphrase: string) {
  if (!record) throw new KeyringError('no-keys');
  privateKey = await unlockPrivateKey(record, passphrase);
  touch();
  set('unlocked');
}

export async function changeKeyringPassphrase(orgId: string, headers: Headers, oldPassphrase: string, newPassphrase: string) {
  if (!record) throw new KeyringError('no-keys');
  const next = await rewrapPrivateKey(record, oldPassphrase, newPassphrase);
  await call(orgId, headers, 'case-keys/me/passphrase', 'POST', next);
  record = next;
  privateKey = await unlockPrivateKey(next, newPassphrase);
  touch();
}

/** The case's key for this user, or null when the case is not encrypted. Needs an unlocked keyring. */
export async function caseKeyFor(orgId: string, headers: Headers, caseId: string): Promise<CryptoKey | null> {
  if (!privateKey) throw new KeyringError('locked');
  touch();
  const cached = caseKeys.get(caseId);
  if (cached) return cached;
  const info = await call(orgId, headers, `cases/${caseId}/keys`);
  if (!info.encrypted) return null;
  if (!info.mine) throw new KeyringError('no-case-key');
  const key = await unwrapCaseKey(info.mine, privateKey);
  caseKeys.set(caseId, key);
  return key;
}

export const isUnlocked = () => state === 'unlocked';

/** A fresh key for a case about to be created or converted, with its wrapping for the caller; remembered in memory. */
export async function newCaseKey(caseId: string): Promise<{ key: CryptoKey; wrappedKey: string }> {
  if (!privateKey || !record) throw new KeyringError('locked');
  touch();
  const key = await createCaseKey();
  caseKeys.set(caseId, key);
  return { key, wrappedKey: await wrapCaseKey(key, record.publicKey) };
}

/** Forgets a key whose case was not created after all. */
export const forgetCaseKey = (caseId: string) => void caseKeys.delete(caseId);

/** The case key from the wrapped copy a list returns, or null when locked / not ours (the case then stays closed). */
export async function caseKeyFromList(caseId: string, wrapped: string | null | undefined): Promise<CryptoKey | null> {
  if (!privateKey || !wrapped) return null;
  const cached = caseKeys.get(caseId);
  if (cached) return cached;
  try {
    const key = await unwrapCaseKey(wrapped, privateKey);
    caseKeys.set(caseId, key);
    touch();
    return key;
  } catch {
    return null;
  }
}

/** Encrypts a case for the first time: a fresh case key, wrapped for the caller. Returns the key. */
export async function createCaseKeyFor(orgId: string, headers: Headers, caseId: string, myUserId: string): Promise<CryptoKey> {
  if (!privateKey || !record) throw new KeyringError('locked');
  const key = await createCaseKey();
  await call(orgId, headers, `cases/${caseId}/keys/${myUserId}`, 'PUT', { wrappedKey: await wrapCaseKey(key, record.publicKey) });
  caseKeys.set(caseId, key);
  touch();
  return key;
}

/** Hands a case key to a colleague who has set up their keys (their public key is fetched here). */
export async function shareCaseKey(orgId: string, headers: Headers, caseId: string, userId: string) {
  const key = await caseKeyFor(orgId, headers, caseId);
  if (!key) throw new KeyringError('not-encrypted');
  const { publicKey } = await call(orgId, headers, `case-keys/users/${userId}`);
  await call(orgId, headers, `cases/${caseId}/keys/${userId}`, 'PUT', { wrappedKey: await wrapCaseKey(key, publicKey) });
}

/** Remembers a case's new key after a rotation, so the page keeps reading it without another unwrap. */
export const rememberCaseKey = (caseId: string, key: CryptoKey) => void caseKeys.set(caseId, key);

export { WrongPassphraseError };
