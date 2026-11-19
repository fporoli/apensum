// Opening and sealing Cases' rows in the browser, on top of the keyring (caseKeyring.ts) and the vault
// (shared/caseVault.ts). The pages work with plain rows; these functions are the only place that knows
// a row may be encrypted.
import { caseKeyFor, caseKeyFromList, newCaseKey, forgetCaseKey } from './caseKeyring';
import { openAssessment, openCase, openInterview, sealedBody, sealRow } from '../shared/caseVault';
import type { Assessment, Case, CaseInterview } from '../shared/cases';

type Headers = () => Promise<Record<string, string>>;
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** Cases for the list: encrypted ones opened with their key, or marked `vault_locked` (title = lockedLabel). */
export async function openCaseList(cases: Case[], lockedLabel: string): Promise<Case[]> {
  return Promise.all(
    cases.map(async (c) => {
      if (!c.enc) return c;
      const key = await caseKeyFromList(c.id, c.my_key);
      try {
        if (key) return { ...(await openCase(key, c)), vault_locked: false };
      } catch {
        /* wrong key or tampered: stays closed */
      }
      return { ...c, title: lockedLabel, subject_name: '—', vault_locked: true };
    }),
  );
}

/** Whether `text` is in the case's opened fields (for the search the server cannot do on encrypted cases). */
export function caseMatches(c: Case, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [c.reference_number, c.title, c.subject_name].some((v) => (v ?? '').toLowerCase().includes(q));
}

/** The case's key, or null when it is not encrypted. Throws `KeyringError('locked' | 'no-case-key')`. */
export const keyOf = caseKeyFor;

export const openInterviews = (key: CryptoKey | null, rows: CaseInterview[]) => Promise.all(rows.map((r) => openInterview(key, r)));
export const openAssessments = (key: CryptoKey | null, rows: Assessment[]) => Promise.all(rows.map((r) => openAssessment(key, r)));

/** The body for a new encrypted case: sealed fields, the client's id, and the creator's wrapped key. */
export async function newEncryptedCaseBody(
  fields: { reference_number: string; domain: string; confidentiality: string; title: string; subject_name: string; subject_dob: string | null },
): Promise<{ id: string; body: Record<string, unknown> }> {
  const id = crypto.randomUUID();
  const { key, wrappedKey } = await newCaseKey(id);
  const { reference_number, domain, confidentiality, ...secrets } = fields;
  const sealed = await sealRow(key, 'case', id, { ...secrets, metadata: {}, custom: {} });
  return { id, body: { id, reference_number, domain, confidentiality, wrappedKey, ...sealed } };
}

export const discardNewCaseKey = forgetCaseKey;

export { sealedBody };
