// Cases: end-to-end encryption, WebCrypto only (browser and Node >= 20), no dependencies.
//
// The server stores ciphertext and wrapped keys and never sees a passphrase, a private key or a case key.
//
//   passphrase --PBKDF2--> KEK (AES-GCM) --wraps--> the user's RSA-OAEP private key   (stored wrapped)
//   case key (random AES-256-GCM) --wrapped with each member's RSA public key--> one row per member
//   case data / files --AES-GCM with the case key--> {v, iv, ct} envelopes
//
// A lost passphrase cannot be recovered: that is the point. Keep this file erasable TypeScript (no enums,
// no imports) so Node tests can load it directly.

export const CRYPTO_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
const RSA_BITS = 3072;

/** What the server stores per user (all base64). */
export interface UserKeyRecord {
  publicKey: string; // SPKI
  wrappedPrivateKey: string; // iv (12 bytes) + AES-GCM(PKCS8 private key)
  salt: string; // PBKDF2 salt
  iterations: number;
}

/** An encrypted value as stored in a JSON column or sent to the server. */
export interface Envelope {
  v: number;
  iv: string;
  ct: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('wrong-passphrase');
    this.name = 'WrongPassphraseError';
  }
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('webcrypto-unavailable');
  return s;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>, aad?: string): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12);
  const params: AesGcmParams = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  return { iv, ct: new Uint8Array(await subtle().encrypt(params, key, data)) };
}

async function open(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const params: AesGcmParams = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  return new Uint8Array(await subtle().decrypt(params, key, ct));
}

/** A new key pair for a user, the private half sealed under the passphrase. Returns the record to store. */
export async function createUserKeys(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<UserKeyRecord> {
  if (!passphrase) throw new Error('passphrase-required');
  const pair = await subtle().generateKey(
    { name: 'RSA-OAEP', modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['wrapKey', 'unwrapKey'],
  );
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await subtle().exportKey('spki', pair.publicKey));
  return sealPrivateKey(pkcs8, toBase64(spki), passphrase, iterations);
}

async function sealPrivateKey(pkcs8: Uint8Array<ArrayBuffer>, publicKey: string, passphrase: string, iterations: number): Promise<UserKeyRecord> {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, iterations);
  const { iv, ct } = await seal(kek, pkcs8, 'cases-private-key');
  const wrapped = new Uint8Array(iv.length + ct.length);
  wrapped.set(iv);
  wrapped.set(ct, iv.length);
  return { publicKey, wrappedPrivateKey: toBase64(wrapped), salt: toBase64(salt), iterations };
}

/** Opens the user's private key with the passphrase, as raw PKCS8 bytes. Throws `WrongPassphraseError`. */
async function openPrivateKey(record: UserKeyRecord, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await deriveKek(passphrase, fromBase64(record.salt), record.iterations);
  const wrapped = fromBase64(record.wrappedPrivateKey);
  try {
    return await open(kek, wrapped.slice(0, 12), wrapped.slice(12), 'cases-private-key');
  } catch {
    throw new WrongPassphraseError();
  }
}

/** The private key as a usable, non-extractable key, for unwrapping case keys. Keep it in memory only. */
export async function unlockPrivateKey(record: UserKeyRecord, passphrase: string): Promise<CryptoKey> {
  const pkcs8 = await openPrivateKey(record, passphrase);
  return subtle().importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['unwrapKey']);
}

/** Re-seals the same private key under a new passphrase (the case keys stay valid). */
export async function changePassphrase(record: UserKeyRecord, oldPassphrase: string, newPassphrase: string): Promise<UserKeyRecord> {
  if (!newPassphrase) throw new Error('passphrase-required');
  const pkcs8 = await openPrivateKey(record, oldPassphrase);
  return sealPrivateKey(pkcs8, record.publicKey, newPassphrase, record.iterations);
}

/** A fresh random case key. Extractable so a member can wrap it for the next one. */
export function createCaseKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** The case key sealed for one member's public key (base64). */
export async function wrapCaseKey(caseKey: CryptoKey, publicKey: string): Promise<string> {
  const pub = await subtle().importKey('spki', fromBase64(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
  return toBase64(new Uint8Array(await subtle().wrapKey('raw', caseKey, pub, { name: 'RSA-OAEP' })));
}

export function unwrapCaseKey(wrapped: string, privateKey: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey('raw', fromBase64(wrapped), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export const isEnvelope = (value: unknown): value is Envelope =>
  !!value && typeof value === 'object' && typeof (value as Envelope).v === 'number' && typeof (value as Envelope).iv === 'string' && typeof (value as Envelope).ct === 'string';

/** Encrypts any JSON value. `aad` binds it to where it lives (e.g. `case:<id>:subject`), so it cannot be moved. */
export async function encryptJson(caseKey: CryptoKey, value: unknown, aad?: string): Promise<Envelope> {
  const { iv, ct } = await seal(caseKey, enc.encode(JSON.stringify(value ?? null)), aad);
  return { v: CRYPTO_VERSION, iv: toBase64(iv), ct: toBase64(ct) };
}

export async function decryptJson<T = unknown>(caseKey: CryptoKey, envelope: Envelope, aad?: string): Promise<T> {
  if (!isEnvelope(envelope) || envelope.v !== CRYPTO_VERSION) throw new Error('unsupported-envelope');
  return JSON.parse(dec.decode(await open(caseKey, fromBase64(envelope.iv), fromBase64(envelope.ct), aad))) as T;
}

/** Files: iv (12 bytes) + ciphertext in one buffer, what the server stores as the document. */
export async function encryptBytes(caseKey: CryptoKey, data: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const { iv, ct } = await seal(caseKey, data, aad);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(caseKey: CryptoKey, data: Uint8Array<ArrayBuffer>, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  return open(caseKey, data.slice(0, 12), data.slice(12), aad);
}

/** Cheap shape check of what a client sends as its key record (the server cannot check more). */
export function validateUserKeyRecord(value: unknown): UserKeyRecord | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const b64 = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
  if (!b64(r.publicKey, 1024) || !b64(r.wrappedPrivateKey, 8192) || !b64(r.salt, 64)) return null;
  if (typeof r.iterations !== 'number' || !Number.isInteger(r.iterations) || r.iterations < 100_000 || r.iterations > 10_000_000) return null;
  return { publicKey: r.publicKey as string, wrappedPrivateKey: r.wrappedPrivateKey as string, salt: r.salt as string, iterations: r.iterations };
}

export const isWrappedKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
