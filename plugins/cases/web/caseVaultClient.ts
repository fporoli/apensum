// Opening and sealing Cases' rows in the browser, on top of the keyring (caseKeyring.ts) and the vault
// (shared/caseVault.ts). The pages work with plain rows; these functions are the only place that knows
// a row may be encrypted.
import { caseKeyFor, caseKeyFromList, newCaseKey, forgetCaseKey, rememberCaseKey, KeyringError } from './caseKeyring';
import { createCaseKey, createFileKey, decryptBytes, encryptBytes, importFileKey, wrapCaseKey } from '../shared/caseCrypto';
import { openAssessment, openCase, openDocument, openInterview, openRow, sealedBody, sealRow } from '../shared/caseVault';
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
export async function sealFile(kind: 'file' | 'audio', id: string, bytes: ArrayBuffer): Promise<{ blob: Blob; fileKey: string }> {
  const { key, raw } = await createFileKey();
  return { blob: new Blob([await encryptBytes(key, new Uint8Array(bytes), `cases:${kind}:${id}`)], { type: 'application/octet-stream' }), fileKey: raw };
}
export async function openFile(fileKey: string, kind: 'file' | 'audio', id: string, bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return (await decryptBytes(await importFileKey(fileKey), new Uint8Array(bytes), `cases:${kind}:${id}`)).buffer;
}

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

/**
 * Takes a member's access away by replacing the case key: every row is opened with the old key and sealed again with
 * a new one, which is wrapped for everyone who stays; the server swaps it all in one step. Files are not touched
 * (each has its own key, kept sealed in its row). Someone who already read the case keeps what they read.
 */
export async function removeCaseMember(orgId: string, headers: Headers, c: Case, removeUserId: string): Promise<void> {
  const oldKey = await caseKeyFor(orgId, headers, c.id);
  if (!oldKey) throw new KeyringError('not-encrypted');
  const get = async (path: string) => {
    const res = await fetch(`${API}/organizations/${orgId}/${path}`, { headers: await headers() });
    const data = await res.json().catch(() => null);
    if (!data?.ok) throw new KeyringError(data?.error ?? data?.message ?? 'error');
    return data;
  };
  const base = `cases/${c.id}`;
  const [ivs, ass, docs, held] = await Promise.all([get(`${base}/interviews`), get(`${base}/assessments`), get(`${base}/documents`), get(`${base}/keys`)]);
  const newKey = await createCaseKey();
  const stay = (held.members as { userId: string }[]).map((m) => m.userId).filter((id) => id !== removeUserId);
  const keys = await Promise.all(stay.map(async (userId) => ({ userId, wrappedKey: await wrapCaseKey(newKey, (await get(`case-keys/users/${userId}`)).publicKey) })));
  const reseal = async (kind: 'interview' | 'assessment' | 'document', rows: { id: string }[]) =>
    Promise.all(rows.map(async (r) => ({ id: r.id, ...(await sealRow(newKey, kind, r.id, (await openRow(oldKey, kind, r as never)) as unknown as Record<string, unknown>)) })));
  const body = {
    expectedUpdatedAt: c.updated_at,
    keys,
    case: await sealRow(newKey, 'case', c.id, c as unknown as Record<string, unknown>),
    interviews: await reseal('interview', ivs.interviews),
    assessments: await reseal('assessment', ass.assessments),
    documents: await reseal('document', docs.documents),
  };
  const form = new FormData();
  form.set('data', JSON.stringify(body));
  const h = await headers();
  delete h['Content-Type'];
  delete h['content-type'];
  const res = await fetch(`${API}/organizations/${orgId}/${base}/rotate`, { method: 'POST', headers: h, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new KeyringError(data?.error ?? data?.message ?? 'error');
  rememberCaseKey(c.id, newKey);
}

export { sealedBody };
