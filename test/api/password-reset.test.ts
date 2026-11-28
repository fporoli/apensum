import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { purposeKey, verifyLocalToken } from '../../apps/api/src/jwt';
import {
  HourlyLimiter,
  mintResetToken,
  passwordStamp,
  readResetToken,
  RESET_TTL_SEC,
  resetLink,
  resetMail,
} from '../../apps/api/src/password-reset';
import { AuthController } from '../../apps/api/src/auth.controller';

const key = purposeKey('password-reset');
const NOW = 1_800_000_000;

test('a reset token carries the user and the stamp of the password it may replace', () => {
  const token = mintResetToken(key, 'user-1', '$2a$10$hash', NOW);
  assert.deepEqual(readResetToken(key, token, NOW + 60), { userId: 'user-1', stamp: passwordStamp('$2a$10$hash') });
  assert.notEqual(passwordStamp('$2a$10$hash'), passwordStamp('$2a$10$other'));
});

test('a reset token expires after 30 minutes', () => {
  const token = mintResetToken(key, 'user-1', 'h', NOW);
  assert.ok(readResetToken(key, token, NOW + RESET_TTL_SEC));
  assert.equal(readResetToken(key, token, NOW + RESET_TTL_SEC + 1), null);
});

test('forged, tampered or foreign tokens are rejected', () => {
  const token = mintResetToken(key, 'user-1', 'h', NOW);
  const [payload, sig] = token.split('.');
  const otherPayload = Buffer.from(JSON.stringify({ u: 'admin', s: passwordStamp('h'), e: NOW + 999 })).toString('base64url');
  assert.equal(readResetToken(key, `${otherPayload}.${sig}`, NOW), null);
  assert.equal(readResetToken(purposeKey('something-else'), token, NOW), null);
  assert.equal(readResetToken(key, `${payload}.${sig}.x`, NOW), null);
  for (const junk of ['', 'abc', '.', undefined, 42, 'a'.repeat(600)]) assert.equal(readResetToken(key, junk, NOW), null);
});

test('a reset token is no session token', async () => {
  assert.equal(await verifyLocalToken(mintResetToken(key, 'user-1', 'h', Math.floor(Date.now() / 1000))), null);
});

test('the link opens the reset page in the person\'s language', () => {
  assert.equal(resetLink('https://app.apensum.ch/', 'abc.def', 'de'), 'https://app.apensum.ch/#/reset/abc.def?lang=de');
});

test('reset mails exist in every language and fall back to English', () => {
  for (const lang of ['en', 'de', 'fr', 'it']) {
    const m = resetMail(lang, 'Anna', 'https://x/#/reset/t');
    assert.match(m.text, /https:\/\/x\/#\/reset\/t/);
    assert.match(m.text, /Anna/);
    assert.match(m.text, /30/);
  }
  assert.equal(resetMail('xx', 'A', 'l').subject, resetMail('en', 'A', 'l').subject);
  assert.doesNotMatch(resetMail('de', 'Evil\r\nBcc: x', 'l').text, /\r|\nBcc/);
});

test('the hourly limiter counts per key and forgets after an hour', () => {
  const limit = new HourlyLimiter(2);
  assert.equal(limit.allow('a', 0), true);
  assert.equal(limit.allow('a', 1000), true);
  assert.equal(limit.allow('a', 2000), false);
  assert.equal(limit.allow('b', 2000), true);
  assert.equal(limit.allow('a', 3600_001), true);
});

/** Minimal drizzle stand-in: select(...).from().innerJoin().where() resolves to `rows`; update records calls. */
function mockDb(identity: { id: string; hash: string | null; email: string } | undefined, updateMatches = true) {
  const updates: unknown[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'set']) c[m] = () => c;
    c.then = (resolve: (v: unknown) => void) => resolve(result);
    c.returning = () => Promise.resolve(updateMatches ? [{ id: identity?.id }] : []);
    return c;
  };
  return {
    updates,
    db: {
      select: () => chain(identity ? [identity] : []),
      update: () => {
        updates.push(true);
        return chain([]);
      },
    },
  };
}

function controller(db: unknown) {
  return new AuthController({ getDb: () => db } as never, { record: async () => {} } as never);
}

test('confirmReset sets the password once with a valid link', async () => {
  const identity = { id: 'ident-1', hash: '$2a$10$old', email: 'anna@example.ch' };
  const { db, updates } = mockDb(identity);
  const token = mintResetToken(key, 'user-1', identity.hash, Math.floor(Date.now() / 1000));
  assert.deepEqual(await controller(db).confirmReset({ token, newPassword: 'new-secret-1' }), { ok: true, email: 'anna@example.ch' });
  // The password, and the address proven (the link came by e-mail).
  assert.equal(updates.length, 2);
});

test('confirmReset refuses a used link, a short password and a bad token', async () => {
  const token = mintResetToken(key, 'user-1', '$2a$10$old', Math.floor(Date.now() / 1000));
  // The password changed since the link was issued (e.g. the link was used already).
  const changed = mockDb({ id: 'ident-1', hash: '$2a$10$new', email: 'a@b.ch' });
  assert.deepEqual(await controller(changed.db).confirmReset({ token, newPassword: 'new-secret-1' }), { ok: false, error: 'reset-link-invalid' });
  assert.equal(changed.updates.length, 0);
  // A second click racing the first: the guarded update matches nothing.
  const raced = mockDb({ id: 'ident-1', hash: '$2a$10$old', email: 'a@b.ch' }, false);
  assert.deepEqual(await controller(raced.db).confirmReset({ token, newPassword: 'new-secret-1' }), { ok: false, error: 'reset-link-invalid' });
  const ok = mockDb({ id: 'ident-1', hash: '$2a$10$old', email: 'a@b.ch' });
  assert.deepEqual(await controller(ok.db).confirmReset({ token, newPassword: 'short' }), { ok: false, error: 'password-too-short' });
  assert.deepEqual(await controller(ok.db).confirmReset({ token: 'nope', newPassword: 'new-secret-1' }), { ok: false, error: 'reset-link-invalid' });
  assert.equal(ok.updates.length, 0);
});

test('requestReset always answers ok and never changes a password', async () => {
  const { db, updates } = mockDb(undefined);
  const req = { headers: {}, socket: { remoteAddress: '1.2.3.4' } } as never;
  const c = controller(db);
  assert.deepEqual(await c.requestReset({ email: 'nobody@example.ch' }, req), { ok: true });
  assert.deepEqual(await c.requestReset({ email: 'not an address' }, req), { ok: true });
  assert.deepEqual(await c.requestReset({}, req), { ok: true });
  assert.equal(updates.length, 0);
});

test('HourlyLimiter.full checks without counting (failed logins count only when they fail)', () => {
  const limit = new HourlyLimiter(2);
  assert.equal(limit.full('k', 0), false);
  assert.equal(limit.full('k', 0), false, 'checking records nothing');
  limit.allow('k', 0);
  limit.allow('k', 1);
  assert.equal(limit.full('k', 2), true);
  assert.equal(limit.full('k', 3600_001), false, 'an hour later');
});
