import { BadRequestException } from '@nestjs/common';
import { isWrappedKey } from '../shared/caseCrypto';
import { plaintextSecrets, validEnvelope, type VaultKind } from '../shared/caseVault';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * The rules that keep an encrypted case encrypted (CasesService, CasesController). The server cannot read
 * `enc`; it makes sure no plaintext sneaks into a case that is encrypted, and that an envelope is not
 * attached to one that is not (the browser has no key for it).
 */
export function checkWrite(kind: VaultKind, encrypted: boolean, body: Record<string, unknown> | null | undefined, opts: { requireEnc: boolean; requireId?: boolean }): void {
  const b = body ?? {};
  if (!encrypted) {
    if (b.enc !== undefined) throw new BadRequestException('case-not-encrypted');
    return;
  }
  if (plaintextSecrets(kind, b).length) throw new BadRequestException('case-encrypted');
  if (b.enc === undefined) {
    if (opts.requireEnc) throw new BadRequestException('case-encrypted');
  } else if (!validEnvelope(b.enc)) throw new BadRequestException('invalid-envelope');
  if (opts.requireId && !(typeof b.id === 'string' && UUID.test(b.id))) throw new BadRequestException('invalid-id');
}

/** Creating an encrypted case: its id (part of the sealing), the envelope and the creator's key. */
export function checkNewEncryptedCase(body: Record<string, unknown>): void {
  if (!validEnvelope(body.enc)) throw new BadRequestException('invalid-envelope');
  if (!(typeof body.id === 'string' && UUID.test(body.id))) throw new BadRequestException('invalid-id');
  if (!isWrappedKey(body.wrappedKey)) throw new BadRequestException('invalid-key');
  if (plaintextSecrets('case', body).length) throw new BadRequestException('case-encrypted');
}

export function checkCustom(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 200_000) throw new BadRequestException('invalid-custom');
  return value as Record<string, unknown>;
}
