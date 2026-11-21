import test from 'node:test';
import assert from 'node:assert/strict';
import { locationHolidays, locationSpans, type LocationRow, type OrgHolidayRowWithLocation } from '../../apps/api/src/work-time-model.service';
import { checkLocation } from '../../apps/api/src/locations.controller';

const zurich: LocationRow = { id: 'zh', name: 'Zürich', canton: 'ZH', municipality: 'Zürich' };
const geneva: LocationRow = { id: 'ge', name: 'Genève', canton: 'GE', municipality: null };
const byId = new Map([zurich, geneva].map((l) => [l.id, l]));

test('a person works at the location of the assignment in force; none = the organization', () => {
  const assignments = [
    { validFrom: '2025-03-01', locationId: 'zh' },
    { validFrom: '2026-07-01', locationId: 'ge' },
    { validFrom: '2026-09-01', locationId: 'ge' },
  ];
  assert.deepEqual(locationSpans(assignments, '2026-01-01', '2027-01-01'), [
    { from: '2026-01-01', toExclusive: '2026-07-01', locationId: 'zh' },
    { from: '2026-07-01', toExclusive: '2027-01-01', locationId: 'ge' },
  ]);
  // Before the first assignment: no location.
  assert.deepEqual(locationSpans(assignments, '2025-01-01', '2025-06-01'), [
    { from: '2025-01-01', toExclusive: '2025-03-01', locationId: null },
    { from: '2025-03-01', toExclusive: '2025-06-01', locationId: 'zh' },
  ]);
  assert.deepEqual(locationSpans([], '2026-01-01', '2026-02-01'), [{ from: '2026-01-01', toExclusive: '2026-02-01', locationId: null }]);
});

test("a location's holidays follow its canton; its own rows win over the rows for everyone", () => {
  const rows: OrgHolidayRowWithLocation[] = [
    // Christmas Eve afternoon off for everyone.
    { id: 'r1', date: '2026-12-24', name: null, fraction: 0.5, observed: true, locationId: null },
    // Knabenschiessen Monday afternoon, Zurich only.
    { id: 'r2', date: '2026-09-14', name: 'Knabenschiessen', fraction: 0.5, observed: true, locationId: 'zh' },
    // Geneva works the whole of Christmas Eve.
    { id: 'r3', date: '2026-12-24', name: null, fraction: 1, observed: false, locationId: 'ge' },
  ];
  const zh = locationHolidays('2026-01-01', '2027-01-01', 'zh', byId, 'ZH', rows);
  const ge = locationHolidays('2026-01-01', '2027-01-01', 'ge', byId, 'ZH', rows);
  const org = locationHolidays('2026-01-01', '2027-01-01', null, byId, 'ZH', rows);
  // Jeûne genevois (Thursday after the first Sunday in September) only in Geneva; Berchtoldstag not there.
  assert.equal(ge.has('2026-09-10'), true);
  assert.equal(zh.has('2026-09-10'), false);
  assert.equal(zh.has('2026-01-02'), true);
  assert.equal(ge.has('2026-01-02'), false);
  // Restauration de la République (31 Dec) is Geneva's.
  assert.equal(ge.has('2026-12-31'), true);
  // The Zurich row applies to Zurich only.
  assert.equal(zh.get('2026-09-14')?.name, 'Knabenschiessen');
  assert.equal(org.has('2026-09-14'), false);
  assert.equal(ge.has('2026-09-14'), false);
  // The row for everyone, and Geneva's own row on the same day winning.
  assert.equal(zh.get('2026-12-24')?.fraction, 0.5);
  assert.equal(ge.has('2026-12-24'), false);
});

test('a location needs a name and a canton', () => {
  assert.deepEqual(checkLocation({ name: ' Basel ', canton: 'BS', municipality: ' ' }), { name: 'Basel', canton: 'BS', municipality: null });
  assert.deepEqual(checkLocation({ name: '', canton: 'BS' }), { error: 'invalid-name' });
  assert.deepEqual(checkLocation({ name: 'Basel', canton: 'XX' }), { error: 'invalid-canton' });
});
