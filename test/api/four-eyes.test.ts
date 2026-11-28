import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canEditBeyondOwn } from '../../apps/api/src/access';

// An override on someone's data never covers the caller (docs/dev/ACCESS.md): nobody books their own balances, approves
// their own month or sets their own manager, whatever their grant. Decided before any permission is read.
test('canEditBeyondOwn never covers the caller themselves', async () => {
  const db = { execute: async () => assert.fail('no permission lookup for oneself') } as never;
  assert.equal(await canEditBeyondOwn(db, 'org', 'me', 'nav.balances', 'me'), false);
});
