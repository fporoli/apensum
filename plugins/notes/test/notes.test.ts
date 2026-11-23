import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { registerModule } from '@worktime3/shared/modules';
import { registerPermissionObjects } from '@worktime3/shared/permissions';
import { cleanNoteText, MAX_NOTE_CHARS, NotesController } from '../api/notes.controller';

// As the API's plugin loader does at startup: the manifest's permission objects and module.
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).apensum;
registerPermissionObjects(manifest.permissions);
registerModule(manifest.module);

const ORG = '00000000-0000-4000-8000-0000000000a0';
const ME = '00000000-0000-4000-8000-000000000001';
const NOTE = '00000000-0000-4000-8000-0000000000b1';

/** The caller holds `grants` in ORG; statements are recorded with their parameters. */
function setup(grants: string[]) {
  const dialect = new PgDialect();
  const statements: { text: string; params: unknown[] }[] = [];
  const db = {
    execute: async (q: any) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      if (text.includes('permission_id')) return { rows: grants.map((permission_id) => ({ name: 'member', permission_id, modules: { notes: true } })) };
      statements.push({ text, params });
      if (text.includes('INSERT INTO notes.notes')) return { rows: [{ id: NOTE, text: params[2], created_at: '2026-11-23 10:00:00+01' }] };
      if (text.includes('DELETE FROM notes.notes')) return { rows: params[0] === NOTE ? [{ id: NOTE }] : [] };
      return { rows: [] };
    },
  };
  const controller = new NotesController({ getDb: () => db } as any, { record: async () => {} } as any);
  const req = { user: { kind: 'local' as const, sub: ME } } as any;
  return { controller, req, statements };
}

test('a note is trimmed text of at most 2000 characters', () => {
  assert.equal(cleanNoteText('  Hallo  '), 'Hallo');
  assert.equal(cleanNoteText('   '), null);
  assert.equal(cleanNoteText(42), null);
  assert.equal(cleanNoteText('x'.repeat(MAX_NOTE_CHARS + 1)), null);
});

test('without nav.notes (or with the module off) nothing is read or written', async () => {
  const { controller, req, statements } = setup([]);
  assert.deepEqual(await controller.list(ORG, req), { ok: true, notes: [] });
  assert.deepEqual(await controller.create(ORG, { text: 'x' }, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.remove(ORG, NOTE, req), { ok: false, error: 'forbidden' });
  assert.ok(!statements.some((s) => s.text.includes('notes.notes')));
});

test('the caller reads, writes and deletes only their own notes', async () => {
  const { controller, req, statements } = setup(['nav.notes:edit:own']);
  await controller.list(ORG, req);
  assert.deepEqual(statements.at(-1)?.params, [ORG, ME], 'listed for this organization and the caller only');
  assert.deepEqual(await controller.create(ORG, { text: ' Idee ' }, req), { ok: true, note: { id: NOTE, text: 'Idee', created_at: '2026-11-23 10:00:00+01' } });
  assert.deepEqual(await controller.create(ORG, { text: '' }, req), { ok: false, error: 'invalid-note' });
  assert.deepEqual(await controller.remove(ORG, NOTE, req), { ok: true });
  assert.deepEqual(statements.at(-1)?.params, [NOTE, ORG, ME], 'deleted only when it is the caller\'s in this organization');
  assert.deepEqual(await controller.remove(ORG, '00000000-0000-4000-8000-0000000000b2', req), { ok: false, error: 'not-found' });
});
