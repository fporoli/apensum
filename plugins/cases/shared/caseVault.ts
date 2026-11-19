// Cases: what goes into an encrypted row, and how it is sealed and opened (the browser does both; the server
// only checks shapes). Pure functions over caseCrypto.ts. Erasable TypeScript, no enums.
//
// Each row's `enc` envelope holds that row's sensitive fields and is bound (AAD) to its table and id, so the
// server cannot swap one row's secrets into another.

import { decryptJson, encryptJson, isEnvelope, type Envelope } from './caseCrypto';
import type { Assessment, Case, CaseInterview } from './cases';

export const CASE_FIELDS = ['title', 'subject_name', 'subject_dob', 'metadata', 'custom'] as const;
export const INTERVIEW_FIELDS = ['interviewee_name', 'transcript_text', 'summary', 'tags'] as const;
export const ASSESSMENT_FIELDS = ['title', 'sections_content', 'custom'] as const;

export type VaultKind = 'case' | 'interview' | 'assessment';
const FIELDS: Record<VaultKind, readonly string[]> = { case: CASE_FIELDS, interview: INTERVIEW_FIELDS, assessment: ASSESSMENT_FIELDS };

export const vaultAad = (kind: VaultKind, id: string) => `cases:${kind}:${id}`;

/** What a row looks like when its secrets are removed: sent to the server next to `enc`. */
export const BLANK: Record<VaultKind, Record<string, unknown>> = {
  case: { title: '', subject_name: '', subject_dob: null, metadata: {}, custom: {} },
  interview: { interviewee_name: '', transcript_text: '', summary: null, tags: [] },
  assessment: { title: '', sections_content: {}, custom: {} },
};

/** The sensitive fields of `row` (only the keys present), the plaintext that gets sealed. */
export function pickSecrets(kind: VaultKind, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[kind]) if (f in row && row[f] !== undefined) out[f] = row[f];
  return out;
}

/** A row's secrets sealed for one row, `{ enc }` for the request body. Only fields present are sealed. */
export async function sealRow(key: CryptoKey, kind: VaultKind, id: string, row: Record<string, unknown>): Promise<{ enc: Envelope }> {
  return { enc: await encryptJson(key, pickSecrets(kind, row), vaultAad(kind, id)) };
}

/**
 * The row with its secrets put back (what the UI works with). A row without `enc` is returned as it is.
 * A row that cannot be opened (wrong key, tampered) throws: never show a half-filled row.
 */
export async function openRow<T extends { id: string; enc?: Envelope | null }>(key: CryptoKey | null, kind: VaultKind, row: T): Promise<T> {
  if (!isEnvelope(row.enc)) return row;
  if (!key) throw new Error('locked');
  const secrets = await decryptJson<Record<string, unknown>>(key, row.enc, vaultAad(kind, row.id));
  return { ...row, ...secrets };
}

export const openCase = (key: CryptoKey | null, c: Case) => openRow(key, 'case', c);
export const openInterview = (key: CryptoKey | null, i: CaseInterview) => openRow(key, 'interview', i);
export const openAssessment = (key: CryptoKey | null, a: Assessment) => openRow(key, 'assessment', a);

/** The same row as the server stores it: secrets blanked, sealed copy attached. */
export async function sealedBody(key: CryptoKey, kind: VaultKind, id: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blanked: Record<string, unknown> = { ...row };
  for (const f of FIELDS[kind]) delete blanked[f];
  return { ...blanked, ...(await sealRow(key, kind, id, row)) };
}

/** Rejects a plaintext field in a body for an encrypted row (server side): the names that must not travel. */
export function plaintextSecrets(kind: VaultKind, body: Record<string, unknown> | null | undefined): string[] {
  if (!body) return [];
  return FIELDS[kind].filter((f) => body[f] !== undefined);
}

/** An envelope that is small enough and well formed to store (the server cannot check more). */
export function validEnvelope(value: unknown, maxChars = 4_000_000): value is Envelope {
  return isEnvelope(value) && value.v === 1 && typeof value.iv === 'string' && value.iv.length <= 32 && value.ct.length <= maxChars && /^[A-Za-z0-9+/]+={0,2}$/.test(value.ct) && /^[A-Za-z0-9+/]+={0,2}$/.test(value.iv);
}
