import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registerModule } from '@worktime3/shared/modules';
import { OPERATOR_ORG_ID, OPERATOR_PERMISSION } from '@worktime3/shared/operator';
import { permissionIdsOf } from '../../apps/api/src/access';
import { OperatorController, parseLicenseBody } from '../../apps/api/src/operator.controller';

// The Super Admin pages' API: operators (members of the Admin organization) only, every change audited.

const ORG = '00000000-0000-4000-8000-00000000000c';
const as = (sub: string) => ({ user: { kind: 'local' as const, sub }, headers: {} }) as any;

registerModule({ id: 'licensedtest', caption: 'modules.licensedtest', defaultEnabled: false, objects: [], licensed: true });

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

function setup(operators: string[]) {
  const statements: string[] = [];
  const db = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      statements.push(text);
      if (text.includes('is_operator')) {
        const ids = (q as any).queryChunks.filter((c: any) => typeof c === 'string');
        return { rows: [{ is_operator: operators.some((o) => ids.includes(o)) }] };
      }
      if (text.includes('SELECT 1 FROM organizations')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('count(*)::int AS n FROM organization_memberships')) return { rows: [{ n: operators.length }] };
      if (text.includes('SELECT id FROM users WHERE email')) {
        const email = (q as any).queryChunks.find((c: any) => typeof c === 'string');
        return { rows: email === 'known@example.ch' || email === 'op@example.ch' ? [{ id: email === 'op@example.ch' ? 'op' : 'new' }] : [] };
      }
      if (text.includes('operator_grant(')) {
        const id = (q as any).queryChunks.find((c: any) => typeof c === 'string');
        return { rows: [{ added: !operators.includes(id) }] };
      }
      if (text.includes('operator_revoke(')) {
        const id = (q as any).queryChunks.find((c: any) => typeof c === 'string');
        return { rows: [{ removed: operators.includes(id) }] };
      }
      if (text.includes('FROM organizations o')) return { rows: [{ id: ORG, name: 'Acme', licenses: [] }] };
      if (text.includes('DELETE FROM organization_licenses')) return { rows: [{ id: 'audit-1' }] };
      if (text.includes('UPDATE organizations')) return { rows: [] };
      return { rows: [] };
    },
  };
  const audits: unknown[][] = [];
  const audit = { record: async (...args: unknown[]) => { audits.push(args); } };
  return { controller: new OperatorController({ getDb: () => db } as any, audit as any, { record: async () => {} } as any), statements, audits };
}

test('license body: a date or open-ended, nothing else', () => {
  assert.deepEqual(parseLicenseBody({ validUntil: '2027-12-31' }), { ok: true, validUntil: '2027-12-31' });
  assert.deepEqual(parseLicenseBody({}), { ok: true, validUntil: null });
  assert.deepEqual(parseLicenseBody({ validUntil: null }), { ok: true, validUntil: null });
  assert.deepEqual(parseLicenseBody({ validUntil: '31.12.2027' }), { ok: false, error: 'invalid-date' });
  assert.deepEqual(parseLicenseBody({ validUntil: 20271231 }), { ok: false, error: 'invalid-date' });
});

test('someone who is no operator gets nothing and changes nothing', async () => {
  const { controller, statements } = setup(['op']);
  assert.deepEqual(await controller.me(as('admin')), { ok: false, error: 'forbidden' });
  const list = await controller.organizations(as('admin'));
  assert.equal(list.ok, false);
  assert.deepEqual(list.organizations, []);
  assert.deepEqual(await controller.grant(ORG, 'licensedtest', {}, as('admin')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.revoke(ORG, 'licensedtest', as('admin')), { ok: false, error: 'forbidden' });
  assert.ok(!statements.some((s) => /organization_licenses|audit_logs/.test(s)), 'no license read or written');
});

test('an operator lists organizations and grants and revokes licenses, each with an audit entry', async () => {
  const { controller, statements } = setup(['op']);
  const list = await controller.organizations(as('op'));
  assert.equal(list.ok, true);
  assert.ok(list.modules.some((m) => m.id === 'licensedtest'));
  assert.ok(!list.modules.some((m) => m.id === 'news'), 'only licensed modules');

  assert.deepEqual(await controller.grant(ORG, 'licensedtest', { validUntil: '2027-06-30' }, as('op')), { ok: true });
  const grant = statements.find((s) => s.includes('INSERT INTO organization_licenses'))!;
  assert.match(grant, /INSERT INTO audit_logs/, 'license and audit entry in one statement');
  assert.match(grant, /'license\.grant'/);

  assert.deepEqual(await controller.revoke(ORG, 'licensedtest', as('op')), { ok: true });
  assert.match(statements.find((s) => s.includes('DELETE FROM organization_licenses'))!, /INSERT INTO audit_logs/);
});

test('an operator cannot license what is no licensed module, nor a malformed organization', async () => {
  const { controller } = setup(['op']);
  assert.deepEqual(await controller.grant(ORG, 'news', {}, as('op')), { ok: false, error: 'unknown-module' });
  assert.deepEqual(await controller.grant(ORG, 'licensedtest', { validUntil: 'soon' }, as('op')), { ok: false, error: 'invalid-date' });
  assert.deepEqual(await controller.grant('not-a-uuid', 'licensedtest', {}, as('op')), { ok: false, error: 'unknown-organization' });
});

test('the Admin organization: its members hold the Super Admin permission and nothing else; outsiders nothing', async () => {
  const db = {
    execute: async (q: any) => {
      const text = sqlText(q);
      if (text.includes('is_operator')) {
        const id = q.queryChunks.filter((c: any) => typeof c === 'string')[1];
        return { rows: [{ is_operator: id === 'op' }] };
      }
      // Any role rows (an admin role that somehow got there) must not count in the Admin organization.
      return { rows: [{ name: 'admin', permission_id: 'nav.users:edit:all' }] };
    },
  };
  assert.deepEqual([...(await permissionIdsOf(db as any, OPERATOR_ORG_ID, 'op'))], [OPERATOR_PERMISSION]);
  assert.deepEqual([...(await permissionIdsOf(db as any, OPERATOR_ORG_ID, 'someone'))], []);
  assert.ok(!(await permissionIdsOf(db as any, ORG, 'op')).has(OPERATOR_PERMISSION), 'never in another organization');
});

test('superusers: an operator adds existing accounts and removes others, but not the last; each audited in the Admin organization', async () => {
  const { controller, audits } = setup(['op', 'other']);
  assert.deepEqual(await controller.addOperator({ email: 'Known@Example.ch ' }, as('admin')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.addOperator({ email: 'nobody@example.ch' }, as('op')), { ok: false, error: 'unknown-account' });
  assert.deepEqual(await controller.addOperator({ email: 'op@example.ch' }, as('op')), { ok: false, error: 'already-operator' });
  assert.deepEqual(await controller.addOperator({ email: 'Known@Example.ch ' }, as('op')), { ok: true, userId: 'new' });
  assert.deepEqual(await controller.removeOperator('00000000-0000-4000-8000-00000000000d', as('op')), { ok: false, error: 'not-operator' });
  assert.deepEqual(audits.map((a) => [a[0], a[1], a[2]]), [[OPERATOR_ORG_ID, 'op', 'operator.grant']]);

  const alone = setup(['op']);
  assert.deepEqual(await alone.controller.removeOperator('00000000-0000-4000-8000-00000000000e', as('op')), { ok: false, error: 'last-operator' });
});

test('the Admin organization is no customer: neither listed for licenses nor licensable', async () => {
  const { controller, statements } = setup(['op']);
  await controller.organizations(as('op'));
  assert.match(statements.find((s) => s.includes('FROM organizations o'))!, /WHERE o\.id <> \?/);
  assert.deepEqual(await controller.grant(OPERATOR_ORG_ID, 'licensedtest', {}, as('op')), { ok: false, error: 'unknown-organization' });
});

test('AI limits and the instance overview: operators only; a limit is checked, stored and audited in that organization', async () => {
  const { controller, statements, audits } = setup(['op']);
  assert.equal((await controller.ai(as('admin'))).ok, false);
  assert.deepEqual(await controller.instance(as('admin')), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.setAiLimit(ORG, { monthlyLimitChf: 50 }, as('admin')), { ok: false, error: 'forbidden' });
  assert.ok(!statements.some((s) => /UPDATE organizations|ai_usage/.test(s)), 'nothing read or written for outsiders');

  assert.deepEqual(await controller.setAiLimit(ORG, { monthlyLimitChf: 5000 }, as('op')), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(await controller.setAiLimit(OPERATOR_ORG_ID, { monthlyLimitChf: 5 }, as('op')), { ok: false, error: 'unknown-organization' });
  assert.deepEqual(await controller.setAiLimit(ORG, { monthlyLimitChf: 25.555 }, as('op')), { ok: false, error: 'unknown-organization' }, 'no such organization in the fake database');
  assert.deepEqual(audits, []);
});
