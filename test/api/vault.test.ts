import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { VaultController, idleMinutesOf } from '../../apps/api/src/vault.controller';
import { registerVaultObjects } from '../../apps/api/src/vault.service';

// The vault's key routes (docs/VAULT.md), moved from the cases plugin's case-keys test: who may hold an object's key is
// the module's rule (here a test kind whose access is a table of people), the rest is the core's.
const ORG = '00000000-0000-0000-0000-0000000000a0';
const OBJ = '00000000-0000-0000-0000-0000000000c1';
const [LEAD, MEMBER, OTHER, NOKEYS, STRANGER] = [1, 2, 3, 4, 5].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
const WRAPPED = 'QUJD';
const KEYREC = { public_key: 'cHVi', wrapped_private_key: 'd3Jh', salt: 'c2FsdA==', iterations: 600000 };

// May see / edit the object: LEAD both, MEMBER and NOKEYS see (and edit), OTHER and STRANGER nothing.
const RIGHTS: Record<string, { see: boolean; edit: boolean }> = {
  [LEAD]: { see: true, edit: true }, [MEMBER]: { see: true, edit: true }, [NOKEYS]: { see: true, edit: true },
  [OTHER]: { see: false, edit: false }, [STRANGER]: { see: false, edit: false },
};
registerVaultObjects({
  kind: 'testmod.thing',
  access: async (_db, q) => (q.objectId === OBJ ? RIGHTS[q.userId]?.[q.action] ?? false : null),
});

/** A tiny in-memory stand-in for the tables the controller touches, answering by the SQL text. */
function setup(opts: { holders?: string[]; withKeys?: string[] } = {}) {
  const dialect = new PgDialect();
  const holders = new Map((opts.holders ?? []).map((u) => [u, WRAPPED]));
  const withKeys = new Set(opts.withKeys ?? [LEAD, MEMBER, OTHER]);
  const people = Object.keys(RIGHTS);
  const writes: string[] = [];
  const escrow = new Map<string, { sealed_key: string; key_id: string }>();
  const db = {
    execute: async (q: any) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      const user = params.find((p) => typeof p === 'string' && people.includes(p)) as string | undefined;
      if (text.includes('AS last_day')) return { rows: people.map((id) => ({ user_id: id, name: id, start_date: null, last_day: null, locale: null })) };
      if (text.includes('AS name FROM users u')) {
        const list = String(params.find((p) => typeof p === 'string' && p.startsWith('{')) ?? '{}').slice(1, -1).split(',').filter(Boolean);
        return { rows: list.map((id) => ({ id, name: id })) };
      }
      if (text.includes('settings ->')) return { rows: [{ value: null }] };
      if (text.includes('FROM vault_user_keys WHERE user_id = ANY')) return { rows: [...withKeys].map((user_id) => ({ user_id })) };
      if (text.includes('INSERT INTO vault_object_keys')) { writes.push(`grant:${params[3]}`); holders.set(params[3] as string, WRAPPED); return { rows: [] }; }
      if (text.includes('FROM vault_object_keys')) return { rows: [...holders].map(([id, w]) => ({ user_id: id, wrapped_key: w })) };
      if (text.includes('INSERT INTO vault_user_keys')) return { rows: [{ user_id: user }] };
      if (text.includes('INSERT INTO vault_object_escrow')) { escrow.set(params[2] as string, { sealed_key: params[3] as string, key_id: params[4] as string }); return { rows: [] }; }
      if (text.includes('FROM vault_object_escrow')) return { rows: [...escrow].map(([object_id, e]) => ({ object_id, ...e })) };
      if (text.includes('FROM vault_user_keys')) return { rows: user && withKeys.has(user) ? [KEYREC] : [] };
      return { rows: user ? [{ name: 'member' }] : [] }; // membership
    },
  };
  const controller = new VaultController({ getDb: () => db } as any);
  const as = (sub: string) => ({ user: { kind: 'local', sub } }) as any;
  return { controller, as, writes, db };
}

const K = 'testmod.thing';

test('the first key of an object is made by someone who may edit it, for themselves only', async () => {
  const a = setup();
  assert.deepEqual(await a.controller.grantKey(ORG, K, OBJ, LEAD, a.as(LEAD), { wrappedKey: WRAPPED }), { ok: true });
  const b = setup();
  assert.deepEqual(await b.controller.grantKey(ORG, K, OBJ, MEMBER, b.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
  const c = setup();
  assert.deepEqual(await c.controller.grantKey(ORG, K, OBJ, OTHER, c.as(OTHER), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
});

test('a key holder hands the key to a member who may see the object and has keys', async () => {
  const { controller, as, writes } = setup({ holders: [LEAD] });
  assert.deepEqual(await controller.grantKey(ORG, K, OBJ, MEMBER, as(LEAD), { wrappedKey: WRAPPED }), { ok: true });
  assert.deepEqual(writes, [`grant:${MEMBER}`]);
});

test('no key without holding one, for someone who may not see it, without a key pair, or for an unknown kind', async () => {
  const a = setup({ holders: [LEAD] });
  assert.deepEqual(await a.controller.grantKey(ORG, K, OBJ, OTHER, a.as(MEMBER), { wrappedKey: WRAPPED }), { ok: false, error: 'no-object-key' });
  const b = setup({ holders: [LEAD] });
  assert.deepEqual(await b.controller.grantKey(ORG, K, OBJ, OTHER, b.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'forbidden' });
  const c = setup({ holders: [LEAD] });
  assert.deepEqual(await c.controller.grantKey(ORG, K, OBJ, NOKEYS, c.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'no-keys' });
  const d = setup({ holders: [LEAD] });
  assert.deepEqual(await d.controller.grantKey(ORG, K, OBJ, MEMBER, d.as(LEAD), { wrappedKey: '<script>' }), { ok: false, error: 'invalid-key' });
  assert.deepEqual(await d.controller.grantKey(ORG, 'other.kind', OBJ, MEMBER, d.as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'not-found' });
  assert.deepEqual(d.writes, []);
});

test('the keys of an object: the caller\'s wrapped key, and nothing to people who may not see it', async () => {
  const { controller, as } = setup({ holders: [LEAD, MEMBER] });
  const mine = await controller.objectKeys(ORG, K, OBJ, as(LEAD));
  assert.equal(mine.encrypted, true);
  assert.equal(mine.mine, WRAPPED);
  assert.equal(mine.members.length, 2);
  assert.deepEqual(await controller.objectKeys(ORG, K, OBJ, as(OTHER)), { ok: true, encrypted: false, mine: null, members: [] });
});

test('own key pair: checked on creation, with the organization\'s idle minutes (default 30, 5 to 480)', async () => {
  const rec = { publicKey: 'cHVi', wrappedPrivateKey: 'd3Jh', salt: 'c2FsdA==', iterations: 600000 };
  const { controller, as } = setup();
  assert.deepEqual(await controller.createMyKeys(ORG, as(LEAD), { ...rec, iterations: 5 }), { ok: false, error: 'invalid-keys' });
  assert.deepEqual(await controller.myKeys(ORG, as(LEAD)), { ok: true, keys: rec, idleMinutes: 30 });
  assert.equal(idleMinutesOf({ idleMinutes: 15 }), 15);
  assert.equal(idleMinutesOf({ idleMinutes: 2 }), 30);
  assert.equal(idleMinutesOf({ idleMinutes: 600 }), 30);
  assert.equal(idleMinutesOf(undefined), 30);
});

test('the sharing dialog lists who may open the object and who holds its key; a holder without the right is flagged, nobody else appears', async () => {
  const { controller, as } = setup({ holders: [LEAD, OTHER], withKeys: [LEAD, MEMBER, OTHER] });
  const { candidates } = await controller.candidates(ORG, K, OBJ, as(LEAD));
  const view = Object.fromEntries(candidates.map((c: any) => [c.userId, { holder: c.holder, canAccess: c.canAccess, hasKeys: c.hasKeys }]));
  assert.deepEqual(view, {
    [LEAD]: { holder: true, canAccess: true, hasKeys: true },
    [MEMBER]: { holder: false, canAccess: true, hasKeys: true },
    [OTHER]: { holder: true, canAccess: false, hasKeys: true },
    [NOKEYS]: { holder: false, canAccess: true, hasKeys: false },
  });
  assert.ok(!(STRANGER in view), 'someone who may not open the object and holds no key is not listed');
});

test('level Standard: the server keeps the key sealed and hands it to whoever may see the object, nobody else; no holders', async () => {
  const before = process.env.DOCUMENTS_KEY;
  process.env.DOCUMENTS_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const { VaultService } = await import('../../apps/api/src/vault.service');
    const vault = new VaultService();
    assert.equal(vault.standardAvailable(), true);
    const { controller, as, db } = setup();
    const raw = Buffer.alloc(32, 9).toString('base64');
    await assert.rejects(vault.escrow(db as any, ORG, K, OBJ, 'not-a-key'), /invalid-key/);
    await vault.escrow(db as any, ORG, K, OBJ, raw);
    const mine = await controller.objectKeys(ORG, K, OBJ, as(LEAD));
    assert.deepEqual(mine, { ok: true, encrypted: true, standard: true, key: raw, mine: null, members: [] });
    assert.deepEqual(await controller.objectKeys(ORG, K, OBJ, as(OTHER)), { ok: true, encrypted: false, mine: null, members: [] });
    assert.deepEqual(await controller.grantKey(ORG, K, OBJ, LEAD, as(LEAD), { wrappedKey: WRAPPED }), { ok: false, error: 'standard-object' });
  } finally {
    if (before === undefined) delete process.env.DOCUMENTS_KEY; else process.env.DOCUMENTS_KEY = before;
  }
});
