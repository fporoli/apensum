import { BadRequestException } from '@nestjs/common';
import type { Case, CaseDocument, CaseInterview } from '../shared/cases';
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

/** What the browser sends of a decrypted case for one stateless call (AI draft, PDF): checked and size-bounded. */
export interface ComputeContent {
  case: Case;
  documents: CaseDocument[];
  interviews: CaseInterview[];
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

export function checkComputeContent(raw: unknown): ComputeContent {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : null;
  if (!o || !o.case || typeof o.case !== 'object' || !Array.isArray(o.documents) || !Array.isArray(o.interviews)) throw new BadRequestException('invalid-content');
  if (o.documents.length > 300 || o.interviews.length > 200) throw new BadRequestException('invalid-content');
  const c = o.case;
  return {
    case: {
      reference_number: str(c.reference_number, 200) ?? '', title: str(c.title, 500) ?? '', subject_name: str(c.subject_name, 500) ?? '',
      subject_dob: str(c.subject_dob, 20), domain: str(c.domain, 40) ?? 'custom', lead_user_name: str(c.lead_user_name, 200),
      confidentiality: str(c.confidentiality, 40) ?? 'standard',
    },
    documents: o.documents.map((d: any) => ({
      title: str(d?.title, 500) ?? '', category: str(d?.category, 40) ?? 'other', file_name: str(d?.file_name, 300), extracted_text: str(d?.extracted_text, 1_000_000),
    })),
    interviews: o.interviews.map((i: any) => ({
      interviewee_name: str(i?.interviewee_name, 300) ?? '', interviewee_role: str(i?.interviewee_role, 40) ?? 'other', interview_date: str(i?.interview_date, 20) ?? '',
      duration_minutes: Number.isFinite(i?.duration_minutes) ? Number(i.duration_minutes) : 0, summary: str(i?.summary, 100_000), summary_stale: false,
      transcript_text: str(i?.transcript_text, 100_000) ?? '', transcript_stale: false,
    })),
  } as unknown as ComputeContent;
}
