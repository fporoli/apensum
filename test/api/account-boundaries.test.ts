import { strict as assert } from 'node:assert';
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

test('auth: SSO takes no account from the body, only from a verified e-mail in the token', async () => {
  const { service, writes } = ownerDb();
  const auth = new AuthController(service, quiet as any);
  const req = { user: { kind: 'keycloak' as const, sub: 'kc-1', email: 'me@example.ch', emailVerified: false } };
  assert.deepEqual(await auth.ssoSync(req, { email: 'other@example.ch' } as any), { ok: false, error: 'email-not-verified' });
  assert.deepEqual(writes, []);
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
