import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  base32Decode, base32Encode, isRecoveryCodeShape, newRecoveryCodes, newTotpSecret, openSecret, otpauthUri, recoveryHash, sealSecret,
  stepAt, totpCode, verifyTotp,
} from '../../apps/api/src/totp';

// RFC 6238, appendix B (SHA-1): the secret is ASCII "12345678901234567890"; the RFC shows 8 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('TOTP: the RFC 6238 test values', () => {
  for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']] as const) {
    assert.equal(totpCode(RFC_SECRET, Math.floor(seconds / 30), 8), code);
    assert.equal(totpCode(RFC_SECRET, Math.floor(seconds / 30)), code.slice(2), '6 digits are the last six');
  }
});

test('TOTP: base32 round trip, new secrets are 32 characters', () => {
  const bytes = randomBytes(20);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(newTotpSecret().length, 32);
  assert.deepEqual(base32Decode('gezd gnbv-gy3t'), base32Decode('GEZDGNBVGY3T'), 'case, spaces and dashes ignored');
});

test('TOTP: a code works within one step either side, once, and only six digits', () => {
  const secret = newTotpSecret();
  const now = 1_800_000_000_000;
  const step = stepAt(now);
  assert.equal(verifyTotp(secret, totpCode(secret, step), now, 0), step);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), now, 0), step - 1, 'phone 30 s behind');
  assert.equal(verifyTotp(secret, totpCode(secret, step + 1), now, 0), step + 1, 'phone 30 s ahead');
  assert.equal(verifyTotp(secret, totpCode(secret, step - 2), now, 0), null, 'older is refused');
  assert.equal(verifyTotp(secret, totpCode(secret, step), now, step), null, 'a used code is refused (replay)');
  const code = totpCode(secret, step);
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, 0), step, 'spaces ignored');
  assert.equal(verifyTotp(secret, 'abcdef', now, 0), null);
  assert.equal(verifyTotp(secret, '12345', now, 0), null);
});

test('recovery codes: ten distinct, easy to read; stored as a hash bound to the account', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) {
    assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    assert.doesNotMatch(c, /[01ilo]/);
    assert.ok(isRecoveryCodeShape(c));
  }
  assert.equal(recoveryHash('u1', 'ABCDE-FGHJK'), recoveryHash('u1', 'abcdefghjk'), 'case and dash do not matter');
  assert.notEqual(recoveryHash('u1', 'abcde-fghjk'), recoveryHash('u2', 'abcde-fghjk'), 'bound to the account');
  assert.ok(!isRecoveryCodeShape('123456'));
});

test('the secret is sealed at rest and opens only with the same key', () => {
  const key = randomBytes(32);
  const sealed = sealSecret('JBSWY3DPEHPK3PXP', key);
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(openSecret(sealed, key), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => openSecret(sealed, randomBytes(32)));
});

test('otpauth URI for the QR code', () => {
  assert.equal(
    otpauthUri('Apensum', 'ann@example.ch', 'JBSWY3DPEHPK3PXP'),
    'otpauth://totp/Apensum%3Aann%40example.ch?secret=JBSWY3DPEHPK3PXP&issuer=Apensum&algorithm=SHA1&digits=6&period=30',
  );
});
