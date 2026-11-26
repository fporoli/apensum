import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { registerModule } from '@worktime3/shared/modules';
import { registerPermissionObjects } from '@worktime3/shared/permissions';
import { cleanNoteText, MAX_NOTE_CHARS, NotesController } from '../api/notes.controller';
import { HourlyLimit, MAX_MAIL_ADDRESSES, noteMail, parseAddresses } from '../api/sharing';

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
      if (text.includes('UPDATE notes.notes SET text')) return { rows: params[1] === NOTE && params[3] === ME ? [{ id: NOTE, text: params[0], created_at: '2026-11-23 10:00:00+01' }] : [] };
      // The caller's own note (ownNote): only NOTE, only theirs.
      if (text.startsWith('SELECT id, text FROM notes.notes')) return { rows: params[0] === NOTE && params[2] === ME ? [{ id: NOTE, text: 'Idee' }] : [] };
      // The recipients: the active members among those named.
      if (text.includes('FROM organization_memberships m') && text.includes('leader_user_id')) return { rows: [{ user_id: OTHER }, { user_id: ME }] };
      if (text.includes('UPDATE notes.notes SET shared_with = shared_with ||')) return { rows: [{ added: [OTHER] }] };
      if (text.includes('array_remove')) return { rows: [{ id: params[1] }] };
      if (text.includes('FROM users WHERE id')) return { rows: [{ name: 'Ueli', email: 'ueli@acme.com', locale: 'de' }] };
      return { rows: [] };
    },
  };
  const notified: { recipientUserIds: string[]; text?: { key: string } }[] = [];
  const controller = new NotesController({ getDb: () => db } as any, { record: async () => {} } as any,
    { notifyMany: async (n: any) => { notified.push(n); } } as any, { record: async () => {} } as any);
  const req = { user: { kind: 'local' as const, sub: ME } } as any;
  return { controller, req, statements, notified };
}

const OTHER = '00000000-0000-4000-8000-000000000002';

test('a note is trimmed text of at most 2000 characters', () => {
  assert.equal(cleanNoteText('  Hallo  '), 'Hallo');
  assert.equal(cleanNoteText('   '), null);
  assert.equal(cleanNoteText(42), null);
  assert.equal(cleanNoteText('x'.repeat(MAX_NOTE_CHARS + 1)), null);
});

test('without nav.notes (or with the module off) nothing is read or written', async () => {
  const { controller, req, statements } = setup([]);
  assert.deepEqual(await controller.list(ORG, req), { ok: true, notes: [], shared: [] });
  assert.deepEqual(await controller.share(ORG, NOTE, { userIds: [OTHER] }, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.mail(ORG, NOTE, { addresses: ['a@b.ch'] }, req), { ok: false, error: 'forbidden' });
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
  assert.deepEqual(await controller.update(ORG, NOTE, { text: ' Neu ' }, req), { ok: true, note: { id: NOTE, text: 'Neu', created_at: '2026-11-23 10:00:00+01' } });
  assert.deepEqual(await controller.update(ORG, '00000000-0000-4000-8000-0000000000b2', { text: 'x' }, req), { ok: false, error: 'not-found' });
  assert.deepEqual(await controller.update(ORG, NOTE, { text: '  ' }, req), { ok: false, error: 'invalid-note' });
  assert.deepEqual(await controller.remove(ORG, NOTE, req), { ok: true });
  assert.deepEqual(statements.at(-1)?.params, [NOTE, ORG, ME], 'deleted only when it is the caller\'s in this organization');
  assert.deepEqual(await controller.remove(ORG, '00000000-0000-4000-8000-0000000000b2', req), { ok: false, error: 'not-found' });
});

test('sharing one\'s own note: with the active members named, each told once; someone else\'s note is not shared', async () => {
  const { controller, req, notified } = setup(['nav.notes:edit:own']);
  assert.deepEqual(await controller.share(ORG, NOTE, { userIds: [OTHER, 'not-an-id'] }, req), { ok: true, added: 1 });
  assert.deepEqual(notified.map((n) => [n.recipientUserIds, n.text?.key]), [[[OTHER], 'notes.notice.shared']]);
  assert.deepEqual(await controller.share(ORG, '00000000-0000-4000-8000-0000000000b2', { userIds: [OTHER] }, req), { ok: false, error: 'not-found' });
  assert.deepEqual(await controller.share(ORG, NOTE, {}, req), { ok: false, error: 'no-recipients' });
  // A recipient hides it for themselves; only the author takes it back from someone else.
  assert.deepEqual(await controller.unshare(ORG, NOTE, 'me', req), { ok: true });
  assert.deepEqual(await controller.unshare(ORG, '00000000-0000-4000-8000-0000000000b2', OTHER, req), { ok: false, error: 'forbidden' });
});

test('forwarding by mail: valid addresses only, at most ten, a limit per hour, the link for colleagues only', () => {
  assert.deepEqual(parseAddresses('A@Example.ch; b@example.ch, a@example.ch'), { ok: true, addresses: ['a@example.ch', 'b@example.ch'] });
  assert.deepEqual(parseAddresses(['nope']), { ok: false, error: 'invalid-address' });
  assert.deepEqual(parseAddresses(''), { ok: false, error: 'no-addresses' });
  assert.deepEqual(parseAddresses(Array.from({ length: MAX_MAIL_ADDRESSES + 1 }, (_, i) => `p${i}@example.ch`)), { ok: false, error: 'too-many-addresses' });
  const limit = new HourlyLimit(3);
  assert.equal(limit.take('u', 2, 0), true);
  assert.equal(limit.take('u', 2, 1000), false);
  assert.equal(limit.take('u', 2, 3_600_001), true);
  const inside = noteMail('de', { sender: 'Ueli', senderEmail: 'ueli@acme.com', text: 'Idee', message: 'Schau mal', link: 'https://app/#/notes?id=1' });
  assert.equal(inside.subject, 'Notiz von Ueli');
  assert.ok(inside.text.includes('Idee') && inside.text.includes('Schau mal') && inside.text.includes('https://app/#/notes?id=1'));
  const outside = noteMail('fr', { sender: 'Ueli', senderEmail: 'ueli@acme.com', text: 'Idee', link: null });
  assert.ok(!outside.text.includes('Ouvrir dans Apensum') && outside.text.includes('ueli@acme.com'));
});
