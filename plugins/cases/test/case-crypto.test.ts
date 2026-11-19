import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  WrongPassphraseError,
  changePassphrase,
  createCaseKey,
  createUserKeys,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  isEnvelope,
  unlockPrivateKey,
  unwrapCaseKey,
  validateUserKeyRecord,
  wrapCaseKey,
} from '../shared/caseCrypto';

const ITER = 100_000; // fast for tests; the default is 600 000

test('user keys: the right passphrase unlocks, a wrong one is rejected', async () => {
  const rec = await createUserKeys('correct horse', ITER);
  assert.ok(validateUserKeyRecord(rec));
  await unlockPrivateKey(rec, 'correct horse');
  await assert.rejects(() => unlockPrivateKey(rec, 'wrong'), WrongPassphraseError);
});

test('a case key wrapped for a member opens only with that member\'s private key', async () => {
  const alice = await createUserKeys('alice-pass', ITER);
  const bob = await createUserKeys('bob-pass', ITER);
  const caseKey = await createCaseKey();
  const env = await encryptJson(caseKey, { subject: 'Max Muster', dob: '1980-01-02' }, 'case:1');

  const forAlice = await wrapCaseKey(caseKey, alice.publicKey);
  const aliceKey = await unwrapCaseKey(forAlice, await unlockPrivateKey(alice, 'alice-pass'));
  assert.deepEqual(await decryptJson(aliceKey, env, 'case:1'), { subject: 'Max Muster', dob: '1980-01-02' });

  // Alice re-wraps it for Bob; Bob reads it too.
  const forBob = await wrapCaseKey(aliceKey, bob.publicKey);
  const bobKey = await unwrapCaseKey(forBob, await unlockPrivateKey(bob, 'bob-pass'));
  assert.deepEqual(await decryptJson(bobKey, env, 'case:1'), { subject: 'Max Muster', dob: '1980-01-02' });

  // Bob cannot open what was wrapped for Alice.
  const bobPrivate = await unlockPrivateKey(bob, 'bob-pass');
  await assert.rejects(() => unwrapCaseKey(forAlice, bobPrivate));
});

test('envelopes are bound to their place and tamper-evident', async () => {
  const key = await createCaseKey();
  const env = await encryptJson(key, 'secret', 'case:1:title');
  assert.ok(isEnvelope(env));
  assert.ok(!JSON.stringify(env).includes('secret'));
  await assert.rejects(() => decryptJson(key, env, 'case:2:title'));
  const other = await createCaseKey();
  await assert.rejects(() => decryptJson(other, env, 'case:1:title'));
  const flipped = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(() => decryptJson(key, flipped, 'case:1:title'));
});

test('files round-trip as bytes and are not stored in the clear', async () => {
  const key = await createCaseKey();
  const data = new TextEncoder().encode('%PDF-1.7 confidential');
  const sealed = await encryptBytes(key, data, 'doc:1');
  assert.ok(!Buffer.from(sealed).includes('confidential'));
  assert.deepEqual(await decryptBytes(key, sealed, 'doc:1'), data);
});

test('changing the passphrase keeps the same keys: old case keys still open', async () => {
  const rec = await createUserKeys('old-pass', ITER);
  const caseKey = await createCaseKey();
  const wrapped = await wrapCaseKey(caseKey, rec.publicKey);
  const env = await encryptJson(caseKey, [1, 2, 3]);

  const next = await changePassphrase(rec, 'old-pass', 'new-pass');
  assert.equal(next.publicKey, rec.publicKey);
  await assert.rejects(() => unlockPrivateKey(next, 'old-pass'), WrongPassphraseError);
  const key = await unwrapCaseKey(wrapped, await unlockPrivateKey(next, 'new-pass'));
  assert.deepEqual(await decryptJson(key, env), [1, 2, 3]);
  await assert.rejects(() => changePassphrase(rec, 'bad', 'x'), WrongPassphraseError);
});

test('validateUserKeyRecord rejects malformed records', () => {
  assert.equal(validateUserKeyRecord(null), null);
  assert.equal(validateUserKeyRecord({ publicKey: 'a', wrappedPrivateKey: 'b', salt: 'c', iterations: 5 }), null);
  assert.equal(validateUserKeyRecord({ publicKey: '<x>', wrappedPrivateKey: 'b', salt: 'c', iterations: 600000 }), null);
});
