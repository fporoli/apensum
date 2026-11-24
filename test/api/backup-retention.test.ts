import { strict as assert } from 'node:assert';
import { test } from 'node:test';
// @ts-expect-error plain JavaScript module without types
import { filesToDelete, stampsToKeep } from '../../scripts/backup-retention.mjs';

/** One backup a night at 01:30 UTC for `days` days up to 2026-11-23. */
function nightly(days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 10, 23 - i, 1, 30));
    out.push(d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
  }
  return out;
}

test('a year of nightly backups keeps 7 days, 4 weeks and 12 months', () => {
  const kept: string[] = stampsToKeep(nightly(400));
  // Days 23..17 Nov; the weeks' newest (Mon 23 Nov is a week's first day: 23, 22, 15, 8 Nov) add 15 and 8 Nov;
  // the months' newest add the last day of each earlier month back to December 2025.
  assert.deepEqual(kept.slice(0, 10).map((s) => s.slice(0, 8)), [
    '20261123', '20261122', '20261121', '20261120', '20261119', '20261118', '20261117', '20261115', '20261108', '20261031',
  ]);
  assert.equal(kept.at(-1)!.slice(0, 8), '20251231');
  assert.equal(kept.length, 7 + 2 + 11);
});

test('backups that stopped long ago are not all deleted', () => {
  const old = ['20240101T013000Z', '20240102T013000Z'];
  assert.deepEqual(stampsToKeep(old), ['20240102T013000Z', '20240101T013000Z']);
});

test('several backups on a day keep the newest; files go in pairs; other names stay', () => {
  const names = [
    'backups/prod/20261123T013000Z-db.dump.age',
    'backups/prod/20261123T013000Z-documents.tar.age',
    'backups/prod/20261123T090000Z-db.dump.age',
    'backups/prod/20261123T090000Z-documents.tar.age',
    'backups/prod/20261123T100000Z-db.dump.age.part',
    'backups/prod/notes.txt',
  ];
  assert.deepEqual(filesToDelete(names), ['20261123T013000Z-db.dump.age', '20261123T013000Z-documents.tar.age']);
});
