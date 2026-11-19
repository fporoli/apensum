// Opening and sealing Cases' rows in the browser, on top of the keyring (caseKeyring.ts) and the vault
// (shared/caseVault.ts). The pages work with plain rows; these functions are the only place that knows
// a row may be encrypted.
import { caseKeyFor, caseKeyFromList, newCaseKey, forgetCaseKey } from './caseKeyring';
import { decryptBytes, encryptBytes } from '../shared/caseCrypto';
import { openAssessment, openCase, openDocument, openInterview, sealedBody, sealRow } from '../shared/caseVault';
import type { Assessment, Case, CaseDocument, CaseInterview } from '../shared/cases';

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
export const openDocuments = (key: CryptoKey | null, rows: CaseDocument[]) => Promise.all(rows.map((r) => openDocument(key, r)));
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

/** File contents are sealed with the case key, bound to what they belong to (a document or an interview's audio). */
export const sealBytes = async (key: CryptoKey, kind: 'file' | 'audio', id: string, bytes: ArrayBuffer): Promise<Blob> =>
  new Blob([await encryptBytes(key, new Uint8Array(bytes), `cases:${kind}:${id}`)], { type: 'application/octet-stream' });
export const openBytes = async (key: CryptoKey, kind: 'file' | 'audio', id: string, bytes: ArrayBuffer): Promise<ArrayBuffer> =>
  (await decryptBytes(key, new Uint8Array(bytes), `cases:${kind}:${id}`)).buffer;

/** Hands a Blob to the user as a download (the browser's own save, nothing leaves the page). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A stateless server job for an encrypted case (transcription, summary, AI draft, PDF, text extraction): plaintext in the request, result back. */
export async function compute(orgId: string, headers: Headers, caseId: string, job: string, body: FormData): Promise<Response> {
  const h = await headers();
  delete h['Content-Type'];
  delete h['content-type'];
  return fetch(`${API}/organizations/${orgId}/cases/${caseId}/compute/${job}`, { method: 'POST', headers: h, body });
}

export { sealedBody };
