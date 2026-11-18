import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setupSteps, type SetupFacts } from '../../apps/api/src/setup.controller';

const fresh: SetupFacts = {
  orgName: "Anna Muster's workspace",
  settings: {},
  members: [{ id: 'anna', name: 'Anna Muster', hasAssignment: false, managerId: null }],
  pendingInvitations: 0,
  departments: 0,
  departmentsWithoutLeader: 0,
  schedules: 0,
  projects: 0,
};
const done = (facts: SetupFacts) => Object.fromEntries(setupSteps(facts).map((s) => [s.id, s.done]));

test('a fresh registration has every required step open', () => {
  const steps = setupSteps(fresh);
  assert.deepEqual(
    steps.filter((s) => !s.optional && !s.done).map((s) => s.id),
    ['name', 'holidays', 'workTime', 'departments', 'people', 'employment'],
  );
  assert.deepEqual(steps.find((s) => s.id === 'employment')?.people, ['Anna Muster']);
});

test('a set-up organization has every required step done', () => {
  const facts: SetupFacts = {
    orgName: 'Muster AG',
    settings: { holidayRegion: 'ZH', fullTimeWeeklyMinutes: 2520 },
    members: [
      { id: 'anna', name: 'Anna', hasAssignment: true, managerId: null },
      { id: 'beat', name: 'Beat', hasAssignment: true, managerId: 'anna' },
    ],
    pendingInvitations: 0,
    departments: 2,
    departmentsWithoutLeader: 0,
    schedules: 0,
    projects: 0,
  };
  assert.ok(setupSteps(facts).every((s) => s.optional || s.done));
});

test('employment: one person at the top is fine, a second without a manager is not', () => {
  const two = {
    ...fresh,
    members: [
      { id: 'anna', name: 'Anna', hasAssignment: true, managerId: null },
      { id: 'beat', name: 'Beat', hasAssignment: true, managerId: null },
    ],
  };
  const step = setupSteps(two).find((s) => s.id === 'employment')!;
  assert.equal(step.done, false);
  assert.deepEqual(step.people, ['Anna', 'Beat']);
});

test('details: an invitation counts as people; a department without a leader keeps it open; an unknown canton is not set', () => {
  assert.equal(done({ ...fresh, pendingInvitations: 1 }).people, true);
  assert.equal(done({ ...fresh, departments: 2, departmentsWithoutLeader: 1 }).departments, false);
  assert.equal(done({ ...fresh, settings: { holidayRegion: 'XX' } }).holidays, false);
  assert.equal(done({ ...fresh, orgName: 'Anna’s workspace' }).name, false);
  assert.equal(done({ ...fresh, settings: { branding: {} } }).look, true);
});
