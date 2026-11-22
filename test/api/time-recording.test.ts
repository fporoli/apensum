import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeYearBalances, type BalanceInputs } from '../../apps/api/src/balances.service';
import { orgOwnedKeys } from '../../apps/api/src/basicdata.controller';
import { keepOrgSection, nestOrgKeys, scopeToOrg } from '../../apps/api/src/basicdata.service';
import { defaultSchedule, type WorkSchedule } from '@worktime3/shared/worktime';

const full = defaultSchedule();
const none: WorkSchedule = { ...full, validFrom: '2026-01-01', timeRecording: 'none', exemptionReason: 'waiver' };

function inputs(schedules: WorkSchedule[], more: Partial<BalanceInputs> = {}): BalanceInputs {
  return {
    year: 2026,
    today: '2027-01-10',
    start: '2026-01-01',
    until: null,
    settings: { fullTimeWeeklyMinutes: 2400, vacationDaysPerYear: 25, legalMaxWeeklyMinutes: 2700, legalOvertimeYearLimitMinutes: 10200 },
    model: { schedules, fallback: full, holidays: new Map(), absences: [{ dateStart: '2026-07-06', dateEnd: '2026-07-10', halfDay: false, type: 'vacation' }] },
    attendance: new Map([['2026-03-02', 900]]),
    closed: [],
    periodStatus: new Map(),
    adjustments: [],
    entitlementOverrides: new Map(),
    ...more,
  };
}

test('no time recording: no target, overtime or open month, vacation still counts', () => {
  const b = computeYearBalances(inputs([none]));
  assert.deepEqual([...new Set(b.months.map((m) => m.status))], ['not-recorded']);
  assert.equal(b.overtime.closing, 0);
  assert.equal(b.overtime.pendingMinutes, 0);
  assert.equal(b.legalOvertime.accrued, 0);
  assert.equal(b.months.reduce((s, m) => s + m.target + m.actual, 0), 0);
  assert.equal(b.vacation.taken, 5);
});

test('a change in the middle of a month leaves that month a timesheet', () => {
  const b = computeYearBalances(inputs([{ ...full, validFrom: '2026-01-01' }, { ...none, validFrom: '2026-04-15' }]));
  assert.equal(b.months[2].status, 'open');
  assert.equal(b.months[3].status, 'open');
  assert.equal(b.months[4].status, 'not-recorded');
  // 1 to 14 April: ten working days without attendance.
  assert.equal(b.months[3].delta, -10 * 480);
});

test('after the employment ended, its months stay without timesheet', () => {
  const b = computeYearBalances(inputs([none], { until: '2026-09-01' }));
  assert.equal(b.months[11].status, 'not-recorded');
});

test('HR sets the entitlement; the calculated days stay visible', () => {
  const vacation = {
    rules: [{ validFrom: '2000-01-01', baseDays: 25, managementDays: 28, ageSteps: [{ age: 60, days: 5 }] }],
    birthDate: '1960-01-01',
    management: [{ validFrom: '2020-01-01', management: true }],
  };
  const plain = computeYearBalances(inputs([none], { vacation }));
  assert.equal(plain.vacation.entitlement, 33);
  assert.equal(plain.vacation.basis?.days, 33);
  const set = computeYearBalances(inputs([none], { vacation, entitlementOverrides: new Map([[2026, 30]]) }));
  assert.equal(set.vacation.entitlement, 30);
  assert.equal(set.vacation.entitlementCalculated, 33);
  assert.equal(set.vacation.remaining, 25);
});

test('the birth date is kept per organization', () => {
  const keys = orgOwnedKeys({ fields: [] } as any);
  const patch = nestOrgKeys({ birthDate: '1964-03-15', street: 'A' }, keys, 'org-1');
  assert.deepEqual(patch, { street: 'A', orgs: { 'org-1': { birthDate: '1964-03-15' } } });
  // Another organization neither approves it nor sees it; one entered before stays readable.
  assert.deepEqual(keepOrgSection(patch, 'org-2'), { street: 'A' });
  assert.equal(scopeToOrg({ birthDate: '1970-01-01', ...patch }, 'org-1').birthDate, '1964-03-15');
  assert.equal(scopeToOrg({ birthDate: '1970-01-01', ...patch }, 'org-2').birthDate, '1970-01-01');
});
