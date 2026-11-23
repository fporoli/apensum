import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Two-step login: time-based one-time codes (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 s steps), as every
 * authenticator app makes them, and one-time recovery codes. Pure; the database side is two-factor.ts.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted before and after the current one: a phone clock off by up to 30 s still works. */
const WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, base32 (what the QR code carries and people may type). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code of one time step. */
export function totpCode(secret: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/**
 * The step a code belongs to, when it is valid now and newer than `lastStep` (a code works once), else
 * null. Spaces in the code are ignored.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = stepAt(nowMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** What the QR code says: authenticator apps read issuer, account and secret from it. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten recovery codes like `k7m2q-9xw4d`: no 0/o, 1/l to mix up. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** How a recovery code is stored: a hash bound to the account, never the code. */
export function recoveryHash(userId: string, code: string): string {
  const clean = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return createHash('sha256').update(`${userId}:${clean}`).digest('base64url');
}

/** Looks like a recovery code (else it is taken for an app code). */
export function isRecoveryCodeShape(code: string): boolean {
  return /^[a-z0-9]{5}-?[a-z0-9]{5}$/i.test(code.trim());
}

/** The secret encrypted at rest (AES-256-GCM): `iv.tag.data`, base64url. */
export function sealSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function openSecret(sealed: string, key: Buffer): string {
  const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
