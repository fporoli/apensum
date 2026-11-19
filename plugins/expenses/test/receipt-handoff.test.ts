import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDOFF_TTL_MS, MAX_OPEN_HANDOFFS_PER_USER, ReceiptHandoffService, safeName } from '../api/receipt-handoff.service';
import { ReceiptHandoffController } from '../api/receipt-handoff.controller';
import type { AuthenticatedRequest } from '@worktime3/api/plugin';

const photo = (name = 'image.jpg', mimeType = 'image/jpeg') => ({ name, mimeType, buffer: Buffer.from('jpeg bytes') });

function service(start = 1_000_000) {
  const s = new ReceiptHandoffService();
  let now = start;
  s.now = () => now;
  return { s, advance: (ms: number) => { now += ms; } };
}

test('the phone sends one file; only its creator takes it, once', () => {
  const { s } = service();
  const { token } = s.create('u1', 'org1');
  assert.match(token, /^[\w-]{32}$/);
  assert.equal(s.phoneStatus(token), 'open');
  assert.deepEqual(s.ownerStatus(token, 'u1'), { status: 'waiting' });

  assert.deepEqual(s.deposit(token, photo('IMG_0042.JPG')), { ok: true });
  assert.equal(s.phoneStatus(token), 'used');
  assert.deepEqual(s.deposit(token, photo()), { ok: false, error: 'handoff-used' });

  assert.deepEqual(s.ownerStatus(token, 'u2'), { status: 'expired' });
  assert.equal(s.take(token, 'u2'), null);
  assert.deepEqual(s.ownerStatus(token, 'u1'), { status: 'ready', fileName: 'IMG_0042.JPG' });
  assert.equal(s.take(token, 'u1')?.buffer.toString(), 'jpeg bytes');
  assert.equal(s.take(token, 'u1'), null);
  assert.equal(s.phoneStatus(token), 'used');
  assert.deepEqual(s.deposit(token, photo()), { ok: false, error: 'handoff-used' });
  assert.deepEqual(s.ownerStatus(token, 'u1'), { status: 'expired' });
});

test('a hand-off expires, refuses other file types and unknown tokens', () => {
  const { s, advance } = service();
  const { token } = s.create('u1', 'org1');
  assert.deepEqual(s.deposit(token, photo('x.exe', 'application/octet-stream')), { ok: false, error: 'unsupported-type' });
  assert.deepEqual(s.deposit(token, photo('scan.pdf', 'application/pdf')), { ok: true });
  const second = s.create('u1', 'org1').token;
  advance(HANDOFF_TTL_MS);
  assert.equal(s.phoneStatus(second), 'expired');
  assert.deepEqual(s.deposit(second, photo()), { ok: false, error: 'handoff-expired' });
  assert.equal(s.phoneStatus('nope'), 'expired');
  assert.deepEqual(s.deposit('nope', photo()), { ok: false, error: 'handoff-expired' });
});

test('a person keeps a few open hand-offs; a new one replaces the oldest', () => {
  const { s, advance } = service();
  const tokens: string[] = [];
  for (let i = 0; i <= MAX_OPEN_HANDOFFS_PER_USER; i++) {
    tokens.push(s.create('u1', 'org1').token);
    advance(1000);
  }
  assert.equal(s.phoneStatus(tokens[0]), 'expired');
  for (const t of tokens.slice(1)) assert.equal(s.phoneStatus(t), 'open');
  const other = s.create('u2', 'org1').token;
  assert.equal(s.phoneStatus(other), 'open');
  s.cancel(other, 'u1');
  assert.equal(s.phoneStatus(other), 'open');
  s.cancel(other, 'u2');
  assert.equal(s.phoneStatus(other), 'expired');
});

test('generic camera names get a dated receipt name', () => {
  assert.match(safeName('image.jpg', 'image/jpeg'), /^receipt-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.jpg$/);
  assert.match(safeName(undefined, 'application/pdf'), /^receipt-.*\.pdf$/);
  assert.equal(safeName('Quittung Taxi.pdf', 'application/pdf'), 'Quittung Taxi.pdf');
  assert.equal(safeName('../../etc/passwd', 'image/png'), '....etcpasswd');
});

test('creating a hand-off needs a member of the organization; status is per caller', async () => {
  const handoffs = new ReceiptHandoffService();
  // A local principal is its own user id; isOrgMember reads the active role names.
  let roles: { name: string }[] = [];
  const db = { execute: async () => ({ rows: roles }) };
  const controller = new ReceiptHandoffController({ getDb: () => db } as never, handoffs);
  const req = { user: { kind: 'local', sub: 'u1' } } as unknown as AuthenticatedRequest;

  assert.deepEqual(await new ReceiptHandoffController({ getDb: () => null } as never, handoffs).create('org1', req), { ok: false, error: 'offline' });

  assert.deepEqual(await controller.create('org1', req), { ok: false, error: 'forbidden' });

  roles = [{ name: 'member' }];
  const created = await controller.create('org1', req);
  assert.equal(created.ok, true);
  const token = (created as { token: string }).token;
  assert.deepEqual(controller.phoneStatus(token), { ok: true, status: 'open' });
  assert.deepEqual(controller.deposit(token, undefined), { ok: false, error: 'file-required' });
  assert.deepEqual(await controller.status(token, req), { ok: true, status: 'waiting' });
});
