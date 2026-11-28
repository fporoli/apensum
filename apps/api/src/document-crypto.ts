import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for stored documents (envelope encryption).
 * - Every file gets its own random 256-bit data key and is encrypted with AES-256-GCM. The stored
 *   file is `WTENC1 | iv (12) | tag (16) | ciphertext`.
 * - The data key is wrapped (AES-256-GCM too) with the master key and kept in
 *   `documents.encrypted_key` (base64 `iv | tag | wrapped key`), with `documents.key_id` naming the
 *   master key.
 * - The master key comes from DOCUMENTS_KEY (32 bytes, base64). Older master keys stay readable
 *   through DOCUMENTS_KEY_PREVIOUS (comma-separated), so the key can be rotated: set the new key,
 *   move the old one to DOCUMENTS_KEY_PREVIOUS, run `npm run db:encrypt-documents -- --rewrap`.
 * Losing every copy of the master key loses the documents: keep it in the secret store
 * (GitHub Environment / Azure Key Vault), never only on the server.
 */

const MAGIC = Buffer.from('WTENC1');
const ALGO = 'aes-256-gcm';

export interface MasterKey {
  id: string;
  key: Buffer;
}

export function parseMasterKey(value: string): MasterKey {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32) throw new Error('a documents key must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)');
  // A fingerprint, not the key: identifies which key wrapped a document.
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 16), key };
}

/** The key new documents are encrypted with; null when DOCUMENTS_KEY is not set (files stay plain). */
export function currentMasterKey(env: NodeJS.ProcessEnv = process.env): MasterKey | null {
  return env.DOCUMENTS_KEY ? parseMasterKey(env.DOCUMENTS_KEY) : null;
}

/** Every key that may have wrapped a stored document: the current one and DOCUMENTS_KEY_PREVIOUS. */
export function masterKeys(env: NodeJS.ProcessEnv = process.env): MasterKey[] {
  const values = [env.DOCUMENTS_KEY, ...(env.DOCUMENTS_KEY_PREVIOUS ?? '').split(',')].filter((v): v is string => !!v && !!v.trim());
  return values.map(parseMasterKey);
}

function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/** Encrypts a file: what to write to disk, and the wrapped data key for the database row. */
export function encryptDocument(plain: Buffer, master: MasterKey): { file: Buffer; encryptedKey: string; keyId: string } {
  const dataKey = randomBytes(32);
  return {
    file: Buffer.concat([MAGIC, seal(dataKey, plain)]),
    encryptedKey: seal(master.key, dataKey).toString('base64'),
    keyId: master.id,
  };
}

/** Decrypts a stored file; throws when the key is unknown or the file was altered. */
export function decryptDocument(file: Buffer, encryptedKey: string, keyId: string, keys: readonly MasterKey[]): Buffer {
  const master = keys.find((k) => k.id === keyId);
  if (!master) throw new Error(`document key ${keyId} is not configured (DOCUMENTS_KEY / DOCUMENTS_KEY_PREVIOUS)`);
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an encrypted document');
  const dataKey = open(master.key, Buffer.from(encryptedKey, 'base64'));
  return open(dataKey, file.subarray(MAGIC.length));
}

/** Wraps a document's data key with another master key (rotation); the file itself is unchanged. */
export function rewrapKey(encryptedKey: string, keyId: string, keys: readonly MasterKey[], to: MasterKey): { encryptedKey: string; keyId: string } {
  const from = keys.find((k) => k.id === keyId);
  if (!from) throw new Error(`document key ${keyId} is not configured`);
  const dataKey = open(from.key, Buffer.from(encryptedKey, 'base64'));
  return { encryptedKey: seal(to.key, dataKey).toString('base64'), keyId: to.id };
}

/**
 * A short secret (an organization's own Azure key, organization_ai_keys) sealed with the master key: base64
 * `iv | tag | ciphertext`, and the master key's id. Not a document: no data key of its own.
 */
export function sealSecret(plain: string, master: MasterKey): { sealed: string; keyId: string } {
  return { sealed: seal(master.key, Buffer.from(plain, 'utf8')).toString('base64'), keyId: master.id };
}

/** Opens a sealed secret; throws when its key is not configured or it was altered. */
export function openSecret(sealed: string, keyId: string, keys: readonly MasterKey[]): string {
  const master = keys.find((k) => k.id === keyId);
  if (!master) throw new Error(`secret key ${keyId} is not configured (DOCUMENTS_KEY / DOCUMENTS_KEY_PREVIOUS)`);
  return open(master.key, Buffer.from(sealed, 'base64')).toString('utf8');
}
