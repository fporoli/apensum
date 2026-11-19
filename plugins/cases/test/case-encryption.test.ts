import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkCustom, checkRotation, checkNewEncryptedCase, checkWrite } from '../api/case-encryption';
import { createCaseKey } from '../shared/caseCrypto';
import { BLANK, openRow, plaintextSecrets, sealedBody, validEnvelope } from '../shared/caseVault';

const ID = '00000000-0000-0000-0000-0000000000c1';
const ID2 = '00000000-0000-0000-0000-0000000000c2';
const env = { v: 1, iv: 'QUJDREVGR0hJSktM', ct: 'c2VhbGVk' };
const code = (fn: () => void) => { try { fn(); } catch (e: any) { return e.message as string; } return 'ok'; };

test('vault: a row is sealed, blanked and opens again only with its own key and id', async () => {
  const key = await createCaseKey();
  const row = { id: ID, reference_number: 'K-1', status: 'open', title: 'Secret', subject_name: 'Max Muster', subject_dob: '1980-01-01', metadata: { a: 1 }, custom: { x: 'y' } };
  const body = await sealedBody(key, 'case', ID, row);
  assert.equal(body.title, undefined);
  assert.equal(body.reference_number, 'K-1');
  assert.ok(!JSON.stringify(body).includes('Secret') && !JSON.stringify(body).includes('Max Muster'));
  const opened = await openRow(key, 'case', { ...BLANK.case, ...body, id: ID } as any) as any;
  assert.equal(opened.title, 'Secret');
  assert.deepEqual(opened.custom, { x: 'y' });
  // moved to another row, another key, or locked: refused
  await assert.rejects(() => openRow(key, 'case', { ...(body as any), id: ID2 }));
  await assert.rejects(() => openRow(null, 'case', { ...(body as any), id: ID }));
  const other = await createCaseKey();
  await assert.rejects(() => openRow(other, 'case', { ...(body as any), id: ID }));
  // a plain row passes through
  const plain = { id: ID, title: 'open' } as any;
  assert.equal(await openRow(null, 'case', plain), plain);
});

test('interview and assessment secrets are not left in the body', async () => {
  const key = await createCaseKey();
  const i = await sealedBody(key, 'interview', ID, { interviewee_name: 'Anna', transcript_text: 'long text', summary: 's', tags: ['t'], interviewee_role: 'witness' });
  assert.deepEqual(Object.keys(i).sort(), ['enc', 'interviewee_role']);
  const a = await sealedBody(key, 'assessment', ID, { title: 'T', sections_content: { a: 'b' }, custom: {}, status: 'draft' });
  assert.deepEqual(Object.keys(a).sort(), ['enc', 'status']);
  assert.deepEqual(plaintextSecrets('interview', { transcript_text: 'x', enc: env }), ['transcript_text']);
});

test('checkWrite: an encrypted case takes envelopes only, a plain one takes none', () => {
  assert.equal(code(() => checkWrite('interview', true, { id: ID, enc: env, interviewee_role: 'witness' }, { requireEnc: true, requireId: true })), 'ok');
  assert.equal(code(() => checkWrite('interview', true, { id: ID, transcript_text: 'leak', enc: env }, { requireEnc: true, requireId: true })), 'case-encrypted');
  assert.equal(code(() => checkWrite('interview', true, { id: ID }, { requireEnc: true, requireId: true })), 'case-encrypted');
  assert.equal(code(() => checkWrite('interview', true, { enc: env }, { requireEnc: true, requireId: true })), 'invalid-id');
  assert.equal(code(() => checkWrite('interview', true, { id: ID, enc: { v: 1, iv: '<', ct: 'x' } }, { requireEnc: true, requireId: true })), 'invalid-envelope');
  assert.equal(code(() => checkWrite('assessment', true, { status: 'final' }, { requireEnc: false })), 'ok');
  assert.equal(code(() => checkWrite('assessment', true, { title: 'leak' }, { requireEnc: false })), 'case-encrypted');
  assert.equal(code(() => checkWrite('case', false, { enc: env }, { requireEnc: false })), 'case-not-encrypted');
  assert.equal(code(() => checkWrite('case', false, { title: 'ok' }, { requireEnc: false })), 'ok');
});

test('a new encrypted case needs id, envelope, key and no plaintext secrets', () => {
  const ok = { id: ID, enc: env, wrappedKey: 'QUJD', reference_number: 'K-1' };
  assert.equal(code(() => checkNewEncryptedCase(ok)), 'ok');
  assert.equal(code(() => checkNewEncryptedCase({ ...ok, wrappedKey: '' })), 'invalid-key');
  assert.equal(code(() => checkNewEncryptedCase({ ...ok, id: 'x' })), 'invalid-id');
  assert.equal(code(() => checkNewEncryptedCase({ ...ok, subject_name: 'Max' })), 'case-encrypted');
});

test('custom fields: an object of limited size', () => {
  assert.equal(checkCustom(undefined), undefined);
  assert.deepEqual(checkCustom({ a: 1 }), { a: 1 });
  assert.equal(code(() => checkCustom([1])), 'invalid-custom');
  assert.equal(code(() => checkCustom('x')), 'invalid-custom');
  assert.ok(validEnvelope(env));
});

test('compute content: shapes are coerced and bounded', async () => {
  const { checkComputeContent } = await import('../api/case-encryption');
  const c = checkComputeContent({
    case: { reference_number: 'K-1', title: 'T', subject_name: 'S', domain: 'kesb', evil: 'x' },
    documents: [{ title: 'D', category: 'medical', extracted_text: 'text', extra: 1 }],
    interviews: [{ interviewee_name: 'A', transcript_text: 't', duration_minutes: 'NaN' }],
  });
  assert.equal((c.case as any).evil, undefined);
  assert.equal(c.interviews[0].duration_minutes, 0);
  assert.equal(c.interviews[0].transcript_stale, false);
  assert.equal(code(() => checkComputeContent(null)), 'invalid-content');
  assert.equal(code(() => checkComputeContent({ case: {}, documents: new Array(301).fill({}), interviews: [] })), 'invalid-content');
});

test('rotation must re-seal every row once and keep the caller\'s key', () => {
  const ME = '00000000-0000-0000-0000-000000000001', B = '00000000-0000-0000-0000-000000000002';
  const body = (over: Record<string, unknown> = {}) => ({
    expectedUpdatedAt: '2026-01-01', case: { enc: env }, keys: [{ userId: ME, wrappedKey: 'QUJD' }, { userId: B, wrappedKey: 'QUJD' }],
    interviews: [{ id: 'i1', enc: env }], assessments: [], documents: [{ id: 'd1', enc: env }, { id: 'd2', enc: env }], ...over,
  });
  const have = { interviews: ['i1'], assessments: [], documents: ['d2', 'd1'] };
  assert.doesNotThrow(() => checkRotation(body(), ME, have));
  assert.equal(code(() => checkRotation(body({ documents: [{ id: 'd1', enc: env }] }), ME, have)), 'rotation-incomplete');
  assert.equal(code(() => checkRotation(body(), ME, { ...have, assessments: ['a1'] })), 'rotation-incomplete');
  assert.equal(code(() => checkRotation(body({ keys: [{ userId: B, wrappedKey: 'QUJD' }] }), ME, have)), 'rotation-incomplete');
  assert.equal(code(() => checkRotation(body({ keys: [{ userId: ME, wrappedKey: 'QUJD' }, { userId: ME, wrappedKey: 'QUJD' }] }), ME, have)), 'rotation-incomplete');
  assert.equal(code(() => checkRotation(body({ keys: [{ userId: 'x', wrappedKey: 'QUJD' }] }), ME, have)), 'invalid-key');
  assert.equal(code(() => checkRotation(body({ interviews: [{ id: 'i1', enc: { v: 1, iv: '<', ct: 'x' } }] }), ME, have)), 'invalid-envelope');
  assert.equal(code(() => checkRotation({ ...body(), expectedUpdatedAt: undefined }, ME, have)), 'rotation-incomplete');
});
