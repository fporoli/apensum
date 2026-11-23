import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { StaticDataController, resolveEffectiveStaticData } from '../../apps/api/src/static-data.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/types';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

function setupStaticData(opts: {
  roles?: string[];
  operator?: boolean;
  existingRow?: { id: string; organization_id: string | null } | null;
  insertError?: unknown;
}) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const deleted: number[] = [];

  const selectResult = opts.existingRow ? [opts.existingRow] : [];
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => Promise.resolve(selectResult),
    then: (resolve: (v: any) => void, reject?: (e: unknown) => void) => Promise.resolve(selectResult).then(resolve, reject),
  };

  const db = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      // Role names (isOrgMember) and their permissions (can()): admin holds Admin settings.
      if (text.includes('JOIN membership_roles')) {
        return { rows: (opts.roles ?? []).map((name) => ({ name, permission_id: name === 'admin' ? 'nav.admin:edit:all' : null })) };
      }
      if (text.includes('is_operator')) return { rows: [{ is_operator: !!opts.operator }] };
      return { rows: [] };
    },
    select: () => selectChain,
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          if (opts.insertError) throw opts.insertError;
          inserted.push(v);
          return [{ id: 'sd-new' }];
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          updated.push(patch);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deleted.push(1);
      },
    }),
  };

  const dbService = { getDb: () => db } as unknown as DbService;
  const versions = { record: async () => {} } as unknown as VersionsService;
  const controller = new StaticDataController(dbService, versions);
  const req = { user: { kind: 'local', sub: 'user-1' } } as unknown as AuthenticatedRequest;
  return { controller, req, inserted, updated, deleted };
}

test('resolveEffectiveStaticData inherits global rows and overrides them with org rows', () => {
  const globalLocales = { id: 'g1', organization_id: null, entity: 'users', enum_name: 'locales' };
  const globalCountries = { id: 'g2', organization_id: null, entity: 'users', enum_name: 'countries' };
  const orgLocales = { id: 'o1', organization_id: 'org-1', entity: 'users', enum_name: 'locales' };
  const orgCustom = { id: 'o2', organization_id: 'org-1', entity: 'projects', enum_name: 'project_type' };

  // Test both orders (org before global, global before org)
  for (const input of [
    [globalLocales, globalCountries, orgLocales, orgCustom],
    [orgLocales, orgCustom, globalLocales, globalCountries],
  ]) {
    const effective = resolveEffectiveStaticData(input, 'org-1');
    assert.deepEqual(
      effective.map((r) => r.id).sort(),
      ['g2', 'o1', 'o2'],
    );
  }
});

test('StaticDataController.create always makes an org row and handles duplicates', async () => {
  const orgAdmin = setupStaticData({ roles: ['admin'], operator: false });
  assert.deepEqual(
    await orgAdmin.controller.create('org-1', { entity: 'projects', enumName: 'project_type', values: { a: 'A' } }, orgAdmin.req),
    { ok: true, id: 'sd-new' },
  );
  assert.equal(orgAdmin.inserted[0].organization_id, 'org-1');

  // A scope in the body is ignored: no one creates rows for all organizations through the API.
  const operatorAdmin = setupStaticData({ roles: ['admin'], operator: true });
  await operatorAdmin.controller.create('org-1', { scope: 'global', entity: 'users', enumName: 'locales', values: {} } as never, operatorAdmin.req);
  assert.equal(operatorAdmin.inserted[0].organization_id, 'org-1');

  // An operator without org admin rights may not create org rows either.
  const operatorOnly = setupStaticData({ roles: [], operator: true });
  assert.deepEqual(
    await operatorOnly.controller.create('org-1', { entity: 'users', enumName: 'locales', values: {} }, operatorOnly.req),
    { ok: false, error: 'forbidden' },
  );
  assert.equal(operatorOnly.inserted.length, 0);

  const dup = setupStaticData({ roles: ['admin'], insertError: { code: '23505' } });
  assert.deepEqual(
    await dup.controller.create('org-1', { entity: 'projects', enumName: 'project_type', values: {} }, dup.req),
    { ok: false, error: 'duplicate-enum' },
  );
});

test('StaticDataController.update and remove enforce org vs global ownership', async () => {
  // No one edits or deletes rows for all organizations, operators included
  for (const operator of [false, true]) {
    const global = setupStaticData({ roles: ['admin'], operator, existingRow: { id: 'g1', organization_id: null } });
    assert.deepEqual(await global.controller.update('org-1', 'g1', { values: { en: 'English' } }, global.req), {
      ok: false,
      error: 'global-read-only',
    });
    assert.deepEqual(await global.controller.remove('org-1', 'g1', global.req), { ok: false, error: 'global-read-only' });
    assert.equal(global.updated.length + global.deleted.length, 0);
  }

  // An org admin edits and deletes the org's own rows, not another org's
  const own = setupStaticData({ roles: ['admin'], existingRow: { id: 'o1', organization_id: 'org-1' } });
  assert.deepEqual(await own.controller.update('org-1', 'o1', { values: { a: 'A' } }, own.req), { ok: true });
  assert.deepEqual(await own.controller.remove('org-1', 'o1', own.req), { ok: true });

  const adminOtherOrg = setupStaticData({ roles: ['admin'], operator: false, existingRow: { id: 'o9', organization_id: 'org-9' } });
  assert.deepEqual(await adminOtherOrg.controller.update('org-1', 'o9', { values: {} }, adminOtherOrg.req), {
    ok: false,
    error: 'forbidden',
  });
  assert.deepEqual(await adminOtherOrg.controller.remove('org-1', 'o9', adminOtherOrg.req), { ok: false, error: 'forbidden' });

  // Missing row returns not-found
  const missing = setupStaticData({ roles: ['admin'], existingRow: null });
  assert.deepEqual(await missing.controller.update('org-1', 'missing', { values: {} }, missing.req), {
    ok: false,
    error: 'not-found',
  });
});
