import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getTableName } from 'drizzle-orm';
import { registerModule } from '@worktime3/shared/modules';
import { canManageRole } from '../../apps/api/src/access';
import { ImportExportController } from '../../apps/api/src/import-export.controller';
import { OrgsController } from '../../apps/api/src/orgs.controller';
import { OrgRolesController } from '../../apps/api/src/roles.controller';
import { StaticDataController } from '../../apps/api/src/static-data.controller';

// An organization is changed and read through its own permissions only, whoever the caller is.

const ORG = '00000000-0000-4000-8000-00000000000c';
const req = { user: { kind: 'local' as const, sub: '00000000-0000-4000-8000-00000000000a' } };
const quiet = { record: async () => {} } as any;
const forbidden = { ok: false, error: 'forbidden' };
const text = (q: any): string => (q.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : c?.queryChunks ? text(c) : '?')).join('');

/** The caller: the permission ids they hold in ORG (none = no member) and whether superdeveloper. */
function setup(caller: { grants?: string[]; superdeveloper?: boolean }, tables: Record<string, unknown[]> = {}) {
  const writes: string[] = [];
  const write = (table: any) => {
    writes.push(getTableName(table));
    const done: any = Object.assign(Promise.resolve([{ id: 'new' }]), { values: () => done, set: () => done, where: () => done, returning: () => done });
    return done;
  };
  const db: any = {
    execute: async (q: unknown) => {
      const s = text(q);
      if (s.includes('JOIN membership_roles')) return { rows: (caller.grants ?? []).map((permission_id) => ({ name: 'some-role', permission_id })) };
      if (s.includes('is_superdeveloper')) return { rows: [{ is_superdeveloper: !!caller.superdeveloper }] };
      return { rows: [] };
    },
    select: () => ({
      from: (table: any) => {
        const query: any = Object.assign(Promise.resolve(tables[getTableName(table)] ?? []), { where: () => query, orderBy: () => query });
        return query;
      },
    }),
    insert: write,
    update: write,
    delete: write,
    transaction: async () => {
      writes.push('transaction');
      throw new Error('no transaction expected');
    },
  };
  return { db, writes, service: { getDb: () => db } as any };
}

test('roles: a superdeveloper who is no member neither reads nor changes them', async () => {
  const { service, writes } = setup({ superdeveloper: true }, { roles: [{ id: 'r', organization_id: ORG, name: 'x', admin_user_ids: [] }] });
  const roles = new OrgRolesController(service, quiet, quiet);
  assert.deepEqual(await roles.list(ORG, req), { ok: true, roles: [] });
  assert.deepEqual(await roles.create(ORG, { name: 'mine' }, req), forbidden);
  assert.deepEqual(await roles.update(ORG, 'r', { permissions: [] }, req), forbidden);
  assert.deepEqual(await roles.reset(ORG, 'r', req), forbidden);
  assert.deepEqual(await roles.remove(ORG, 'r', req), forbidden);
  assert.deepEqual(writes, []);
});

test('roles: only an owner edits them, whatever grants a role carries', async () => {
  const { service, writes } = setup({ grants: ['nav.admin:edit:all', 'section.admin.roles:edit:all'] }, { roles: [{ id: 'r', organization_id: null, name: 'manager' }] });
  const roles = new OrgRolesController(service, quiet, quiet);
  assert.deepEqual(await roles.create(ORG, { name: 'keeper', permissions: ['section.people.documents:see:all'] }, req), forbidden);
  assert.deepEqual(await roles.update(ORG, 'r', { permissions: [] }, req), forbidden);
  assert.deepEqual(await roles.update(ORG, 'r', { scope: 'global', permissions: [] }, req), forbidden);
  assert.deepEqual(writes, []);
});

test('static data: members only', async () => {
  const { service } = setup({ superdeveloper: true }, { static_data: [{ id: 's' }] });
  const data = new StaticDataController(service, quiet);
  assert.deepEqual(await data.listAll(ORG, req), []);
  assert.deepEqual(await data.get(ORG, 'absences', req), []);
});

test('modules: a licensed one needs a license and the admin, whoever asks', async () => {
  registerModule({ id: 'boundarytest', caption: 'x', description: 'x', objects: [], defaultEnabled: false, licensed: true } as any);
  const outsider = setup({ superdeveloper: true }, { organizations: [{ settings: {} }] });
  assert.deepEqual(await new OrgsController(outsider.service, quiet, quiet).setModules(ORG, { boundarytest: true }, req), forbidden);
  const admin = setup({ grants: ['nav.orgSettings:edit:all'] }, { organizations: [{ settings: {} }] });
  const orgs = new OrgsController(admin.service, quiet, quiet);
  assert.deepEqual(await orgs.setModules(ORG, { boundarytest: true }, req), { ok: false, error: 'module-licensed' });
  assert.equal(((await orgs.setModules(ORG, { boundarytest: false }, req)) as any).ok, true);
  assert.deepEqual([...outsider.writes], []);
});

test('import/export: seeing every employee does not export them', async () => {
  const service = { getPayrollData: async () => [], previewEmployeeImport: async () => ({}) };
  const of = (grants: string[]) => new ImportExportController(setup({ grants }).service, service as any);
  const manager = of(['nav.users:see:all', 'nav.users:edit:all']);
  assert.deepEqual(await manager.getPayroll(ORG, '2026-10', req), forbidden);
  assert.deepEqual(await manager.previewEmployees(ORG, { rows: [] }, req), forbidden);
  assert.deepEqual(await manager.commitEmployees(ORG, { rows: [] }, req), forbidden);
  const res: any = { status: (code: number) => ((res.code = code), res), json: (body: unknown) => body, set: () => res, send: () => res };
  assert.deepEqual(await manager.downloadAbacus(ORG, '2026-10', req, res), forbidden);
  assert.equal(res.code, 403);
  assert.equal(((await of(['nav.importExport:edit:all']).getPayroll(ORG, '2026-10', req)) as any).ok, true);
});
