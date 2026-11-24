import { strict as assert } from 'node:assert';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { getTableName } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { AuthController } from '../../apps/api/src/auth.controller';
import { ImportExportController } from '../../apps/api/src/import-export.controller';
import { UsersController } from '../../apps/api/src/users.controller';

// An account spans organizations: no organization's rights may change it, act as it or attach it.

const quiet = { record: async () => {} };
const ME = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const ORG = '00000000-0000-4000-8000-00000000000c';
const as = (sub: string) => ({ user: { kind: 'local' as const, sub } });

/** An owner of ORG who is no operator; writes are counted. */
function ownerDb(tables: Record<string, unknown[]> = {}) {
  const writes: string[] = [];
  const db: any = {
    execute: async () => ({ rows: [{ name: 'owner', permission_id: null, is_operator: false }] }),
    select: () => ({
      from: (table: any) => {
        const rows = tables[getTableName(table)] ?? [];
        const query: any = Object.assign(Promise.resolve(rows), { where: () => query, limit: () => query, innerJoin: () => query });
        return query;
      },
    }),
    update: (table: any) => {
      writes.push(getTableName(table));
      return { set: () => ({ where: async () => [] }) };
    },
    insert: (table: any) => {
      writes.push(getTableName(table));
      throw new Error('no insert expected');
    },
    transaction: async () => {
      writes.push('transaction');
      throw new Error('no transaction expected');
    },
  };
  return { db, writes, service: { getDb: () => db } as any };
}

test("users: an owner changes nobody else's account", async () => {
  const { service, writes } = ownerDb();
  const users = new UsersController(service, quiet as any);
  assert.deepEqual(await users.update(OTHER, { is_active: false, display_name: 'x' }, as(ME)), { ok: false, error: 'forbidden' });
  assert.deepEqual(await users.update(ME, { is_active: false }, as(ME)), { ok: true, noop: true });
  assert.deepEqual(writes, []);
});

test('users: nobody can act as someone else', () => {
  for (const name of ['impersonate', 'search']) assert.equal(name in UsersController.prototype, false, name);
});

test('auth: there is no endpoint that links or unlinks an identity of a given user', () => {
  for (const name of ['linkAzure', 'unlinkAzure', 'setAzure']) assert.equal(name in AuthController.prototype, false, name);
});

/** An ID token of a test identity provider whose keys the API reads from a data: URL. */
function ssoProviderForTest() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1' };
  process.env.SSO_PROVIDER = 'dex';
  process.env.JWT_ISSUER = 'https://auth.example.ch';
  process.env.JWT_AUDIENCE = 'worktime-web';
  process.env.JWT_JWKS_URL = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [jwk] }))}`;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ iss: 'https://auth.example.ch', aud: 'worktime-web', iat: now, exp: now + 300, ...claims })}`;
    return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
  };
}

test('auth: SSO takes no account from the body, only from a verified e-mail in the ID token', async () => {
  const { service, writes } = ownerDb();
  const auth = new AuthController(service, quiet as any);
  const saved = { ...process.env };
  try {
    delete process.env.SSO_PROVIDER;
    assert.deepEqual(await auth.ssoExchange({ idToken: 'x' }), { ok: false, error: 'sso-off' });
    const sign = ssoProviderForTest();
    assert.deepEqual(await auth.ssoExchange({ idToken: 'not-a-token', email: 'other@example.ch' } as any), { ok: false, error: 'sso-invalid' });
    assert.deepEqual(await auth.ssoExchange({ idToken: sign({ sub: 's1', email: 'me@example.ch', aud: 'other' }) }), { ok: false, error: 'sso-invalid' });
    assert.deepEqual(await auth.ssoExchange({ idToken: sign({ sub: 's1', email: 'me@example.ch', iat: Math.floor(Date.now() / 1000) - 3600 }) }), { ok: false, error: 'sso-invalid' });
    assert.deepEqual(await auth.ssoExchange({ idToken: sign({ sub: 's1', email: 'me@example.ch', email_verified: false }) }), { ok: false, error: 'email-not-verified' });
    assert.deepEqual(writes, []);
  } finally {
    for (const k of ['SSO_PROVIDER', 'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_JWKS_URL']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

const invitation = { id: 'i', organization_id: ORG, email: 'other@example.ch', role_id: 'r', status: 'pending', expires_at: '2999-01-01T00:00:00Z' };
const account = { id: OTHER, status: 'active', display_name: 'Other', is_operator: false };
const accept = { token: 't', displayName: 'X', password: 'chosen-by-inviter' };

test("auth: accepting an invitation never replaces an existing account's password", async () => {
  const { service, writes } = ownerDb({
    organization_invitations: [invitation],
    users: [account],
    user_identities: [{ provider: 'password', password_hash: await bcrypt.hash('the-real-password', 4) }],
  });
  assert.deepEqual(await new AuthController(service, quiet as any).acceptInvitation(accept), { ok: false, error: 'invitation-password-mismatch' });
  assert.deepEqual(writes, []);
});

test('auth: an invitation sets no password on an SSO account, nor on one of another organization', async () => {
  const cases = [
    { user_identities: [{ provider: 'oidc', password_hash: null }], organization_memberships: [{ organization_id: ORG }] },
    { user_identities: [], organization_memberships: [{ organization_id: ORG }, { organization_id: OTHER }] },
    { user_identities: [], organization_memberships: [] },
  ];
  for (const rows of cases) {
    const { service, writes } = ownerDb({ organization_invitations: [invitation], users: [account], ...rows });
    assert.deepEqual(await new AuthController(service, quiet as any).acceptInvitation(accept), { ok: false, error: 'invitation-account-exists' });
    assert.deepEqual(writes, []);
  }
});

test('import: there is no restore', () => {
  for (const name of ['commitBackup', 'previewBackup']) assert.equal(name in ImportExportController.prototype, false, name);
});
