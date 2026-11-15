import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canChangeStatus, cleanRequestText } from '../../apps/api/src/requests.controller';
import { permissionIdsOf } from '../../apps/api/src/access';

test('handlers move a request freely; the requester only resolves or reopens it', () => {
  const handler = { handler: true, requester: false };
  const requester = { handler: false, requester: true };
  assert.equal(canChangeStatus('open', 'in_progress', handler, false), true);
  assert.equal(canChangeStatus('resolved', 'open', handler, false), true);
  assert.equal(canChangeStatus('open', 'resolved', requester, false), true);
  assert.equal(canChangeStatus('resolved', 'open', requester, false), true);
  assert.equal(canChangeStatus('open', 'in_progress', requester, false), false);
  assert.equal(canChangeStatus('in_progress', 'open', requester, false), false);
  assert.equal(canChangeStatus('open', 'open', handler, false), false);
  assert.equal(canChangeStatus('open', 'resolved', { handler: false, requester: false }, false), false);
});

test('archived requests are read-only', () => {
  assert.equal(canChangeStatus('resolved', 'open', { handler: true, requester: true }, true), false);
});

test('request text is trimmed and bounded', () => {
  assert.equal(cleanRequestText('  hi  ', 10), 'hi');
  assert.equal(cleanRequestText('   ', 10), null);
  assert.equal(cleanRequestText('x'.repeat(11), 10), null);
  assert.equal(cleanRequestText(42, 10), null);
});

test('permissionIdsOf drops the permissions of a module the organization switched off', async () => {
  const rows = (modules: unknown) => [
    { name: 'member', permission_id: 'nav.requests:edit:own', modules },
    { name: 'member', permission_id: 'nav.time:edit:own', modules },
  ];
  const db = (modules: unknown) => ({ execute: async () => ({ rows: rows(modules) }) }) as any;
  assert.deepEqual([...(await permissionIdsOf(db({ requests: false }), 'o', 'u'))].sort(), ['nav.time:edit:own']);
  assert.deepEqual([...(await permissionIdsOf(db(null), 'o', 'u'))].sort(), ['nav.requests:edit:own', 'nav.time:edit:own']);
});

test('a notification previews the text, else the attached file names', async () => {
  const { messagePreview } = await import('../../apps/api/src/requests.controller');
  assert.equal(messagePreview('Hello', ['a.pdf']), 'Hello');
  assert.equal(messagePreview(null, ['a.pdf', 'b.png']), '📎 a.pdf, b.png');
});
