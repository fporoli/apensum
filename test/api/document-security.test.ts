import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { currentMasterKey, decryptDocument, encryptDocument, masterKeys, parseMasterKey, rewrapKey } from '../../apps/api/src/document-crypto';
import { forwardMailText, parseForward, MAX_FORWARD_RECIPIENTS } from '../../apps/api/src/forward-mail.service';
import { parsePersonnelFields } from '../../apps/api/src/personnel-documents.controller';

const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');
const ID = '11111111-1111-1111-1111-111111111111';

test('a document round-trips, and the stored file does not contain the plain text', () => {
  const plain = Buffer.from('Bonus 2026: CHF 5000 for Marta');
  const master = parseMasterKey(keyA);
  const sealed = encryptDocument(plain, master);
  assert.ok(!sealed.file.includes(plain));
  assert.equal(sealed.keyId, master.id);
  assert.deepEqual(decryptDocument(sealed.file, sealed.encryptedKey, sealed.keyId, [master]), plain);
});

test('every file gets its own data key', () => {
  const master = parseMasterKey(keyA);
  const a = encryptDocument(Buffer.from('same'), master);
  const b = encryptDocument(Buffer.from('same'), master);
  assert.notDeepEqual(a.file, b.file);
  assert.notEqual(a.encryptedKey, b.encryptedKey);
});

test('a wrong key or a changed file is refused, not decrypted to garbage', () => {
  const sealed = encryptDocument(Buffer.from('secret'), parseMasterKey(keyA));
  assert.throws(() => decryptDocument(sealed.file, sealed.encryptedKey, sealed.keyId, [parseMasterKey(keyB)]), /not configured/);
  const tampered = Buffer.from(sealed.file);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptDocument(tampered, sealed.encryptedKey, sealed.keyId, [parseMasterKey(keyA)]));
});

test('rotation: a document wrapped with the old key is re-wrapped and readable with the new one only', () => {
  const plain = Buffer.from('review');
  const sealed = encryptDocument(plain, parseMasterKey(keyA));
  const env = { DOCUMENTS_KEY: keyB, DOCUMENTS_KEY_PREVIOUS: keyA } as NodeJS.ProcessEnv;
  const next = rewrapKey(sealed.encryptedKey, sealed.keyId, masterKeys(env), currentMasterKey(env)!);
  assert.equal(next.keyId, parseMasterKey(keyB).id);
  assert.deepEqual(decryptDocument(sealed.file, next.encryptedKey, next.keyId, [parseMasterKey(keyB)]), plain);
});

test('master keys must be 32 bytes', () => {
  assert.throws(() => parseMasterKey(Buffer.from('short').toString('base64')), /32 bytes/);
  assert.equal(currentMasterKey({} as NodeJS.ProcessEnv), null);
});

test('forwarding needs recipients, a subject and a message, within limits', () => {
  assert.deepEqual(parseForward({ userIds: [], subject: 's', message: 'm' }), { ok: false, error: 'no-recipients' });
  const many = Array.from({ length: MAX_FORWARD_RECIPIENTS + 1 }, (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`);
  assert.deepEqual(parseForward({ userIds: many, subject: 's', message: 'm' }), { ok: false, error: 'too-many-recipients' });
  assert.deepEqual(parseForward({ userIds: [ID], subject: ' ', message: 'm' }), { ok: false, error: 'subject-required' });
  const ok = parseForward({ userIds: [ID, ID, 'not-an-id'], subject: 'Line\r\nBcc: x@evil', message: ' hi ' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.userIds, [ID]);
    assert.equal(ok.subject, 'Line Bcc: x@evil'); // no header injection through the subject
    assert.equal(ok.message, 'hi');
  }
});

test('the forwarded mail carries the link and who sent it, in the recipient language', () => {
  const text = forwardMailText('Bitte anschauen', 'https://app/#/approvals', 'Marta A', 'de-CH');
  assert.match(text, /Bitte anschauen/);
  assert.match(text, /In Apensum öffnen: https:\/\/app\/#\/approvals/);
  assert.match(text, /Gesendet von Marta A/);
  assert.match(forwardMailText('x', 'l', 'M', 'es'), /Sent by M/);
});

test('personnel document fields are validated', () => {
  const cats = ['evaluation', 'salary', 'bonus'];
  assert.deepEqual(parsePersonnelFields({ title: '', category: 'bonus' }, false, cats), { ok: false, error: 'title-required' });
  assert.deepEqual(parsePersonnelFields({ title: 'x', category: 'gossip' }, false, cats), { ok: false, error: 'invalid-category' });
  assert.deepEqual(parsePersonnelFields({ documentDate: '15.11.2026' }, true, cats), { ok: false, error: 'invalid-date' });
  assert.deepEqual(parsePersonnelFields({ effectiveDate: '2027-13' }, true, cats), { ok: false, error: 'invalid-date' });
  assert.deepEqual(parsePersonnelFields({ title: ' Review 2026 ', category: 'evaluation', visibleToEmployee: 'true' }, false, cats), {
    ok: true,
    values: { title: 'Review 2026', category: 'evaluation', visible_to_employee: true },
  });
  assert.deepEqual(
    parsePersonnelFields({ effectiveDate: '2027-01-01', followUpDate: '', visibleToManager: 'true', requireAck: true }, true, cats),
    { ok: true, values: { effective_date: '2027-01-01', follow_up_date: null, visible_to_manager: true, require_ack: true } },
  );
});
