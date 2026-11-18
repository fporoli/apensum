import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { teamIdsFromBody } from '../../apps/api/src/projects.controller';
import { projectBookingError } from '../../apps/api/src/access';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

test('teamIdsFromBody: absent leaves teams alone, a list of ids replaces them', () => {
  assert.equal(teamIdsFromBody(undefined), undefined);
  assert.deepEqual(teamIdsFromBody([]), []);
  assert.deepEqual(teamIdsFromBody([A, B, A]), [A, B]);
  assert.equal(teamIdsFromBody('x'), null);
  assert.equal(teamIdsFromBody([A, 'not-a-uuid']), null);
  assert.equal(teamIdsFromBody(null), null);
});

/** A DbService stand-in answering the one query projectBookingError runs. */
function fakeDb(row: { bookable: boolean; sub_ok: boolean } | undefined) {
  let calls = 0;
  const db = { execute: async () => { calls += 1; return { rows: row ? [row] : [] }; } };
  return { db: db as never, calls: () => calls };
}

test('projectBookingError: hours without a project are always allowed', async () => {
  const f = fakeDb(undefined);
  assert.equal(await projectBookingError(f.db, 'org', A, null), null);
  assert.equal(await projectBookingError(f.db, 'org', A, undefined), null);
  assert.equal(f.calls(), 0);
  // A subproject without its project is not.
  assert.equal(await projectBookingError(f.db, 'org', A, null, B), 'unknown-project');
});

test('projectBookingError: malformed ids are refused without a query', async () => {
  const f = fakeDb({ bookable: true, sub_ok: true });
  assert.equal(await projectBookingError(f.db, 'org', A, 'abc'), 'unknown-project');
  assert.equal(await projectBookingError(f.db, 'org', A, A, 'abc'), 'unknown-project');
  assert.equal(f.calls(), 0);
});

test('projectBookingError: unknown project, foreign subproject, team-limited project', async () => {
  assert.equal(await projectBookingError(fakeDb(undefined).db, 'org', A, B), 'unknown-project');
  assert.equal(await projectBookingError(fakeDb({ bookable: true, sub_ok: false }).db, 'org', A, B, A), 'unknown-project');
  assert.equal(await projectBookingError(fakeDb({ bookable: false, sub_ok: true }).db, 'org', A, B), 'project-not-allowed');
  assert.equal(await projectBookingError(fakeDb({ bookable: true, sub_ok: true }).db, 'org', A, B, A), null);
});
