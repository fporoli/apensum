import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_DATASETS, guestRls } from '../../apps/api/src/analytics.controller';

const ORG = '11111111-2222-3333-4444-555555555555';
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

test('guestRls: the organization on every dataset, people per dataset', () => {
  assert.deepEqual(guestRls(ORG, [{ dataset: 1, userIds: [A, B] }, { dataset: 2, userIds: 'all' }, { dataset: 3, userIds: [A] }]), [
    { clause: `organization_id = '${ORG}'` },
    { dataset: 1, clause: `user_id IN ('${A}', '${B}')` },
    { dataset: 3, clause: `user_id IN ('${A}')` },
  ]);
});

test('guestRls: nobody listed shows nothing, never everything', () => {
  assert.deepEqual(guestRls(ORG, [{ dataset: 7, userIds: [] }]).at(-1), { dataset: 7, clause: '1 = 0' });
});

test('guestRls: anything that is not a uuid stays out of the SQL', () => {
  assert.throws(() => guestRls(`${ORG}' OR '1'='1`, []));
  const rules = guestRls(ORG, [{ dataset: 1, userIds: [`${A}') OR ('1'='1`] }]);
  assert.deepEqual(rules.at(-1), { dataset: 1, clause: '1 = 0' });
});

test('every reporting view is tied to the page whose rule it follows', () => {
  assert.deepEqual(ANALYTICS_DATASETS, { project_hours: 'nav.time', attendance_days: 'nav.workTime', absences: 'nav.absences' });
});
