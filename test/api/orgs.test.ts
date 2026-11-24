import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildInviteEmail } from '../../apps/api/src/orgs.controller';
import {
  callerUserId,
  canManageRole,
  directReportUserIds,
  invitationNeedsOwner,
  isManagerOf,
  isOrgAdmin,
  isOrgMember,
  isPeriodLocked,
  pickPrimaryRole,
  type Executor,
} from '../../apps/api/src/access';

function fakeDb(rows: Array<Record<string, unknown>>): Executor {
  return {
    execute: (async () => ({ rows })) as unknown as Executor['execute'],
  };
}

/** A fake whose `execute` returns a different canned result on each successive call, in order. */
function sequencedDb(responses: Array<Array<Record<string, unknown>>>): Executor {
  let call = 0;
  return {
    execute: (async () => ({ rows: responses[Math.min(call++, responses.length - 1)] ?? [] })) as unknown as Executor['execute'],
  };
}

test('invite email carries org, link and token', () => {
  const mail = buildInviteEmail('Acme Corp', 'tok-123');
  assert.match(mail.subject, /Acme Corp/);
  assert.match(mail.text, /Acme Corp/);
  assert.match(mail.text, /http:\/\/localhost:3001\/\?invite=tok-123/);
  assert.match(mail.text, /tok-123/);
});

test('callerUserId: a local session is the user; an SSO principal is never a session', async () => {
  assert.equal(await callerUserId(fakeDb([]), { kind: 'local', sub: 'user-1' }), 'user-1');
  assert.equal(await callerUserId(fakeDb([{ user_id: 'user-2' }]), { kind: 'sso', sub: 'kc-sub' }), null);
});

test('isOrgAdmin only allows active owner/admin', async () => {
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'owner' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'admin' }]), 'org', 'u'), true);
  assert.equal(await isOrgAdmin(fakeDb([{ name: 'member' }]), 'org', 'u'), false);
  assert.equal(await isOrgAdmin(fakeDb([]), 'org', 'u'), false);
});

test('isOrgMember is true for any active role, false with no membership at all', async () => {
  assert.equal(await isOrgMember(fakeDb([{ name: 'member' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([{ name: 'guest' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([{ name: 'admin' }]), 'org', 'u'), true);
  assert.equal(await isOrgMember(fakeDb([]), 'org', 'u'), false);
});

test('pickPrimaryRole collapses a multi-role set to the highest privilege one', () => {
  assert.equal(pickPrimaryRole(['member', 'admin']), 'admin');
  assert.equal(pickPrimaryRole(['manager', 'owner']), 'owner');
  assert.equal(pickPrimaryRole(['member', 'manager']), 'manager');
  assert.equal(pickPrimaryRole(['billing_admin']), 'billing_admin');
  assert.equal(pickPrimaryRole([]), null);
});

test('canManageRole: owner, admin and HR, and every role of one\'s own, are the owners\' to give and take', async () => {
  for (const role of ['owner', 'admin', 'hr', 'billing_admin', 'project-office']) {
    assert.equal(await canManageRole(sequencedDb([[{ name: role }], [{ name: 'admin' }]]), 'org', 'u1', 'r'), false, role);
    assert.equal(await canManageRole(sequencedDb([[{ name: role }], [{ name: 'owner' }]]), 'org', 'u1', 'r'), true, role);
  }
});

test('canManageRole: the other roles are also an admin\'s', async () => {
  for (const role of ['manager', 'member', 'guest', 'developer']) {
    assert.equal(await canManageRole(sequencedDb([[{ name: role }], [{ name: 'admin', permission_id: 'nav.users:edit:all' }]]), 'org', 'u1', 'r'), true, role);
    assert.equal(await canManageRole(sequencedDb([[{ name: role }], [{ name: 'hr', permission_id: 'nav.users:see:all' }], [{ name: 'hr' }]]), 'org', 'u1', 'r'), false, role);
    assert.equal(await canManageRole(sequencedDb([[{ name: role }], [{ name: 'owner' }], [{ name: 'owner' }]]), 'org', 'u1', 'r'), true, role);
  }
});

test('invitationNeedsOwner: for a role owners appoint, and where accepting would take such an account over', async () => {
  const needs = (held: Record<string, unknown>, setsPassword: boolean) =>
    invitationNeedsOwner(sequencedDb([[{ name: 'member' }], [held]]), 'org', 'member-role', { id: 'u2', setsPassword });
  assert.equal(await invitationNeedsOwner(fakeDb([{ name: 'admin' }]), 'org', 'admin-role', null), true);
  assert.equal(await needs({ status: 'active', name: 'owner' }, true), true, 'no login yet');
  assert.equal(await needs({ status: 'active', name: 'hr' }, true), true, 'HR without login');
  assert.equal(await needs({ status: 'suspended', name: 'hr' }, false), true, 'would come back with it');
  assert.equal(await needs({ status: 'active', name: 'hr' }, false), false, 'their own password, nothing new');
  assert.equal(await needs({ status: 'active', name: 'member' }, true), false);
});

test('isPeriodLocked reflects whether a matching submitted/approved period row was found', async () => {
  assert.equal(await isPeriodLocked(fakeDb([{ '?column?': 1 }]), 'org', 'u', '2026-09-07'), true);
  assert.equal(await isPeriodLocked(fakeDb([]), 'org', 'u', '2026-09-07'), false);
});

test('isManagerOf checks designated manager on organization membership', async () => {
  assert.equal(await isManagerOf(fakeDb([{ manager_user_id: 'mgr-1' }]), 'org', 'mgr-1', 'emp-1'), true);
  assert.equal(await isManagerOf(fakeDb([{ manager_user_id: 'other-mgr' }]), 'org', 'mgr-1', 'emp-1'), false);
  assert.equal(await isManagerOf(fakeDb([]), 'org', 'mgr-1', 'emp-1'), false);
});

test('directReportUserIds returns list of employee user ids', async () => {
  assert.deepEqual(await directReportUserIds(fakeDb([{ user_id: 'u-1' }, { user_id: 'u-2' }]), 'org', 'mgr-1'), ['u-1', 'u-2']);
  assert.deepEqual(await directReportUserIds(fakeDb([]), 'org', 'mgr-1'), []);
});
