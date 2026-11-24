import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isPrivileged, membershipRequires, parseTwoFactorPolicy } from '@worktime3/shared/twoFactor';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { mintLocalToken, verifyLocalToken } from '../../apps/api/src/jwt';
import { JwtAuthGuard, TWO_FACTOR_SETUP_KEY } from '../../apps/api/src/jwt.guard';
import { twoFactorOff, twoFactorRequired } from '../../apps/api/src/two-factor';

// Two-step login: who must use it, and what a setup-only token reaches.

test('the rule: off unless set; admins and HR are Admin settings, HR employment or exporting everyone', () => {
  assert.equal(parseTwoFactorPolicy(undefined), 'off');
  assert.equal(parseTwoFactorPolicy('nonsense'), 'off');
  assert.equal(parseTwoFactorPolicy('all'), 'all');
  assert.ok(isPrivileged(['nav.admin:see:all']));
  assert.ok(isPrivileged(['section.people.employment:edit:all']));
  assert.ok(isPrivileged(['nav.importExport:see:all']));
  assert.ok(!isPrivileged(['section.people.employment:see:all', 'nav.time:edit:reports', 'nav.myData:edit:own']), 'a manager is not');
  assert.ok(membershipRequires('all', false));
  assert.ok(membershipRequires('privileged', true));
  assert.ok(!membershipRequires('privileged', false));
  assert.ok(!membershipRequires('off', true));
});

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

/** Memberships with their organization's rule; the permissions each holds there. */
function db(memberships: { id: string; policy: string | null }[], perms: Record<string, string[]> = {}) {
  return {
    execute: async (q: any) => {
      const text = sqlText(q);
      if (text.includes("settings->>'twoFactor'")) return { rows: memberships };
      if (text.includes('JOIN membership_roles')) {
        const org = q.queryChunks.find((c: any) => typeof c === 'string');
        return { rows: (perms[org] ?? []).map((p) => ({ name: 'custom', permission_id: p })) };
      }
      return { rows: [] };
    },
  } as any;
}

test('required at login when any organization asks it of the person; always in the Admin organization', async () => {
  assert.equal(await twoFactorRequired(db([{ id: 'a', policy: null }, { id: 'b', policy: 'off' }]), 'u'), false);
  assert.equal(await twoFactorRequired(db([{ id: 'a', policy: null }, { id: 'b', policy: 'all' }]), 'u'), true);
  assert.equal(await twoFactorRequired(db([{ id: OPERATOR_ORG_ID, policy: null }]), 'u'), true);
  assert.equal(await twoFactorRequired(db([{ id: 'a', policy: 'privileged' }], { a: ['nav.time:edit:own'] }), 'u'), false);
  assert.equal(await twoFactorRequired(db([{ id: 'a', policy: 'privileged' }], { a: ['nav.admin:see:all'] }), 'u'), true);
});

function guardFor(allowed: boolean) {
  const reflector = { getAllAndOverride: (key: string) => (key === TWO_FACTOR_SETUP_KEY ? allowed : false) };
  return new JwtAuthGuard(reflector as any);
}

function context(token: string) {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  return { req, ctx: { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any };
}

test('a setup-only token reaches the two-step setup and nothing else; a normal token everything', async () => {
  const setup = await mintLocalToken('u1', 'u1@example.ch', 1800, 'two-factor-setup');
  assert.equal((await verifyLocalToken(setup))?.scope, 'two-factor-setup');
  await assert.rejects(() => guardFor(false).canActivate(context(setup).ctx), /two-factor-setup-required/);
  const ok = context(setup);
  assert.equal(await guardFor(true).canActivate(ok.ctx), true);
  assert.equal(ok.req.user.scope, 'two-factor-setup');

  const full = await mintLocalToken('u1', 'u1@example.ch');
  assert.equal(await guardFor(false).canActivate(context(full).ctx), true);
  assert.equal((await verifyLocalToken(full))?.scope, undefined);
});

test('TWO_FACTOR=off: nobody is required, not even an operator; unset or anything else = on', async () => {
  const db = { execute: async () => ({ rows: [{ id: OPERATOR_ORG_ID, policy: null }] }) } as any;
  const before = process.env.TWO_FACTOR;
  try {
    delete process.env.TWO_FACTOR;
    assert.equal(twoFactorOff(), false);
    assert.equal(await twoFactorRequired(db, 'u1'), true);
    process.env.TWO_FACTOR = 'no';
    assert.equal(twoFactorOff(), false);
    process.env.TWO_FACTOR = ' OFF ';
    assert.equal(twoFactorOff(), true);
    assert.equal(await twoFactorRequired(db, 'u1'), false);
  } finally {
    if (before === undefined) delete process.env.TWO_FACTOR; else process.env.TWO_FACTOR = before;
  }
});
