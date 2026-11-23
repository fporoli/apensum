import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findings, MonitorService } from '../../apps/api/src/monitor.service';

const GB = 1024 ** 3;

test('disk: reported below 10 % or below 2 GB free; mail: when the relay fails', () => {
  assert.deepEqual(findings({ diskFreeBytes: 50 * GB, diskTotalBytes: 100 * GB, smtp: 'ok' }), []);
  assert.deepEqual(findings({ diskFreeBytes: 8 * GB, diskTotalBytes: 100 * GB, smtp: 'ok' }).map((f) => f.id), ['disk'], 'under 10 %');
  assert.deepEqual(findings({ diskFreeBytes: 1.5 * GB, diskTotalBytes: 10 * GB, smtp: 'ok' }).map((f) => f.id), ['disk'], 'under 2 GB');
  assert.deepEqual(findings({ diskFreeBytes: null, diskTotalBytes: null, smtp: 'failed' }).map((f) => f.id), ['mail']);
  assert.match(findings({ diskFreeBytes: 1 * GB, diskTotalBytes: 20 * GB, smtp: 'unknown' })[0].text.de, /1\.0 GB frei von 20\.0 GB \(5 %\)/);
});

test('a finding is told once a day, not every hour', async () => {
  const told: string[] = [];
  const db = { execute: async () => ({ rows: [{ id: 'op', email: 'op@example.ch', locale: 'de' }] }) };
  const service = new MonitorService({ getDb: () => db } as any, { notifyMany: async (p: any) => { told.push(p.type); } } as any);
  const low = { diskFreeBytes: 1 * GB, diskTotalBytes: 20 * GB, smtp: 'ok' as const };
  await service.run(new Date('2026-11-23T10:00:00Z'), low);
  await service.run(new Date('2026-11-23T11:00:00Z'), low);
  assert.deepEqual(told, ['operator.monitor.disk']);
  await service.run(new Date('2026-11-24T10:00:00Z'), low);
  assert.equal(told.length, 2, 'the next day again');
});
