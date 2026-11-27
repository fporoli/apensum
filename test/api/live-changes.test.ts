import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationsGateway } from '../../apps/api/src/notifications.gateway';
import { NotificationsService } from '../../apps/api/src/notifications.service';

/** A socket that keeps what it was sent. */
const socket = () => ({ OPEN: 1, readyState: 1, sent: [] as string[], send(p: string) { this.sent.push(p); } });

test('a change goes to the open tabs of whom it concerns, once each, with only which record (nothing stored)', () => {
  const gateway = new NotificationsGateway({ getDb: () => null } as never);
  const g = gateway as unknown as { register: (u: string, ws: unknown) => void };
  const ulla = socket();
  const ullaTab2 = socket();
  const uma = socket();
  g.register('ulla', ulla);
  g.register('ulla', ullaTab2);
  g.register('uma', uma);
  const svc = new NotificationsService({} as never, gateway);
  svc.changed(['ulla', 'ulla', null, undefined, 'nobody'], 'flows', 'f1');
  assert.deepEqual(ulla.sent.map((p) => JSON.parse(p)), [{ type: 'changed', sourceTable: 'flows', sourceId: 'f1' }]);
  assert.equal(ullaTab2.sent.length, 1);
  assert.equal(uma.sent.length, 0);
});
