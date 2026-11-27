import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { forgetAccess, isOrgMember, permissionIdsOf } from '../../apps/api/src/access';

/** A database handle that answers the role query and counts how often it is asked. */
function fakeDb(rows: { name: string; permission_id: string | null }[]) {
  const db = { calls: 0, execute: async () => { db.calls++; return { rows }; } };
  return db;
}
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

test('roles and permissions are read once for repeated checks, per database handle', async () => {
  const db = fakeDb([{ name: 'member', permission_id: 'nav.workTime:edit:own' }]);
  assert.equal(await isOrgMember(db as never, ORG, USER), true);
  assert.equal(await isOrgMember(db as never, ORG, USER), true);
  await permissionIdsOf(db as never, ORG, USER);
  await permissionIdsOf(db as never, ORG, USER);
  assert.equal(db.calls, 2, 'one query for the roles, one for the permissions');
  const other = fakeDb([]);
  assert.equal(await isOrgMember(other as never, ORG, USER), false, 'another handle (a test, a transaction) asks itself');
});

test('a change of roles is seen at once (forgetAccess), and a caller cannot change the cached set', async () => {
  const db = fakeDb([{ name: 'member', permission_id: 'nav.workTime:edit:own' }]);
  const first = await permissionIdsOf(db as never, ORG, USER);
  first.add('nav.admin:edit:all');
  assert.equal((await permissionIdsOf(db as never, ORG, USER)).has('nav.admin:edit:all'), false);
  forgetAccess();
  await permissionIdsOf(db as never, ORG, USER);
  assert.equal(db.calls, 2);
});

test('not being a member is not kept: who joins counts at once', async () => {
  let rows: { name: string; permission_id: string | null }[] = [];
  const db = { execute: async () => ({ rows }) };
  assert.equal(await isOrgMember(db as never, ORG, USER), false);
  rows = [{ name: 'member', permission_id: null }];
  assert.equal(await isOrgMember(db as never, ORG, USER), true);
});
