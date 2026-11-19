import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import './register';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CaseKeysController } from '../api/case-keys.controller';

const ORG = '00000000-0000-0000-0000-0000000000a0';
const CASE = '00000000-0000-0000-0000-0000000000c1';
const [LEAD, MEMBER, OTHER, NOKEYS] = [1, 2, 3, 4].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
const ALL = ['nav.cases:see:all', 'nav.cases:edit:all'];
const OWN = ['nav.cases:see:own', 'nav.cases:edit:own'];
const WRAPPED = 'QUJD';
const KEYREC = { public_key: 'cHVi', wrapped_private_key: 'd3Jh', salt: 'c2FsdA==', iterations: 600000 };

/** A tiny in-memory stand-in for the tables the controller touches, answering by the SQL text. */
function setup(opts: { holders?: string[]; perms: Record<string, string[]>; withKeys?: string[]; lead?: string | null }) {
  const dialect = new PgDialect();
  const holders = new Map((opts.holders ?? []).map((u) => [u, WRAPPED]));
  const withKeys = new Set(opts.withKeys ?? [LEAD, MEMBER, OTHER]);
  const writes: string[] = [];
  const db = {
    execute: async (q: any) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      const user = params.find((p) => typeof p === 'string' && p in opts.perms) as string | undefined;
      if (text.includes('from cases.cases') || text.includes('FROM cases.cases')) return { rows: [{ lead_user_id: opts.lead === undefined ? LEAD : opts.lead }] };
      if (text.includes('INSERT INTO cases.case_keys')) { writes.push(`grant:${params[1]}`); holders.set(params[1] as string, WRAPPED); return { rows: [] }; }
      if (text.includes('DELETE FROM cases.case_keys')) { writes.push(`revoke:${params[1]}`); holders.delete(params[1] as string); return { rows: [] }; }
      if (text.includes('FROM cases.case_keys k')) return { rows: [...holders].map(([id, w]) => ({ user_id: id, wrapped_key: w, display_name: id })) };
      if (text.includes('FROM cases.case_keys')) return { rows: [...holders.keys()].map((user_id) => ({ user_id })) };
      if (text.includes('FROM cases.user_keys')) return { rows: user && withKeys.has(user) ? [KEYREC] : [] };
      if (text.includes('permission_id')) return { rows: (opts.perms[user ?? ''] ?? []).map((permission_id) => ({ name: 'member', permission_id, modules: { cases: true } })) };
      return { rows: user && opts.perms[user] ? [{ name: 'member' }] : [] }; // membership
    },
  };
  const controller = new CaseKeysController({ getDb: () => db } as any);
  const as = (sub: string) => ({ user: { kind: 'local', sub } }) as any;
  return { controller, as, writes, holders };
}

const perms = { [LEAD]: OWN, [MEMBER]: ALL, [OTHER]: OWN, [NOKEYS]: ALL };

test('the first key of a case is made by someone who may edit it, for themselves only', async (t) => {
  const { controller, as } = setup({ perms });
  assert.deepEqual(await controller.grantKey(ORG, CASE, LEAD, as(LEAD), { wrappedKey: WRAPPED }), { ok: true });
  const s = setup({ perms });
  assert.deepEqual(await s.controller.grantKey(ORG, CASE, MEMBER, s.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
  const o = setup({ perms });
  // OTHER holds only `own` and does not lead the case
  assert.deepEqual(await o.controller.grantKey(ORG, CASE, OTHER, o.as(OTHER), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
});

test('a key holder hands the key to a member who may see the case and has keys', async () => {
  const { controller, as, writes } = setup({ perms, holders: [LEAD] });
  assert.deepEqual(await controller.grantKey(ORG, CASE, MEMBER, as(LEAD), { wrappedKey: WRAPPED }), { ok: true });
  assert.deepEqual(writes, [`grant:${MEMBER}`]);
});

test('no key without holding one, for someone who may not see the case, or without a key pair', async () => {
  const a = setup({ perms, holders: [LEAD] });
  assert.deepEqual(await a.controller.grantKey(ORG, CASE, OTHER, a.as(MEMBER), { wrappedKey: WRAPPED }), { ok: false, error: 'no-case-key' });
  const b = setup({ perms, holders: [LEAD] });
  assert.deepEqual(await b.controller.grantKey(ORG, CASE, OTHER, b.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
  const c = setup({ perms, holders: [LEAD] });
  assert.deepEqual(await c.controller.grantKey(ORG, CASE, NOKEYS, c.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'no-keys' });
  const d = setup({ perms, holders: [LEAD] });
  assert.deepEqual(await d.controller.grantKey(ORG, CASE, MEMBER, d.as(LEAD), { wrappedKey: '<script>' }), { ok: false, error: 'invalid-key' });
  assert.deepEqual(d.writes, []);
});

test('caseKeys returns the caller\'s wrapped key and nothing to people who may not see the case', async () => {
  const { controller, as } = setup({ perms, holders: [LEAD, MEMBER] });
  const mine = await controller.caseKeys(ORG, CASE, as(LEAD));
  assert.equal(mine.encrypted, true);
  assert.equal(mine.mine, WRAPPED);
  assert.equal(mine.members.length, 2);
  const outsider = await controller.caseKeys(ORG, CASE, as(OTHER));
  assert.deepEqual(outsider, { ok: true, encrypted: false, mine: null, members: [] });
});

test('own key pair: created once, public key must stay on a passphrase change', async () => {
  const rec = { publicKey: 'cHVi', wrappedPrivateKey: 'd3Jh', salt: 'c2FsdA==', iterations: 600000 };
  const { controller, as } = setup({ perms });
  assert.deepEqual(await controller.createMyKeys(ORG, as(LEAD), { ...rec, iterations: 5 }), { ok: false, error: 'invalid-keys' });
  assert.deepEqual(await controller.myKeys(ORG, as(LEAD)), { ok: true, keys: { ...rec } });
});
