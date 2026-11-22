import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, parseVacationSettings, probationEnd, unpaidLeaveCut, unpaidLeaveDays, vacationDaysOn, validateVacationSettings } from './vacation.ts';
import { vacationEntitlement, defaultSchedule, validateSchedule } from './worktime.ts';

const rules = [{ validFrom: '2000-01-01', baseDays: 25, managementDays: 28, ageSteps: [{ age: 50, days: 2 }, { age: 60, days: 5 }] }];
const person = (birthDate, management = false) => ({ birthDate, management: [{ validFrom: '2020-01-01', management }] });
const days = (date, who, r = rules) => vacationDaysOn(date, r, who).days;

test('management replaces the base, the highest age step reached adds to it', () => {
  assert.equal(days('2026-06-01', person(null)), 25);
  assert.equal(days('2026-06-01', person(null, true)), 28);
  assert.equal(days('2026-06-01', person('1964-03-15', true)), 33);
  assert.equal(days('2026-06-01', person('1964-03-15')), 30);
  assert.equal(days('2026-06-01', person('1975-03-15')), 27);
});

test('a step applies from the birthday, management from its date', () => {
  assert.equal(days('2026-03-14', person('1966-03-15')), 27);
  assert.equal(days('2026-03-15', person('1966-03-15')), 30);
  const later = { birthDate: null, management: [{ validFrom: '2026-07-01', management: true }, { validFrom: '2020-01-01', management: false }] };
  assert.equal(days('2026-06-30', later), 25);
  assert.equal(days('2026-07-01', later), 28);
  assert.equal(ageOn('2004-02-29', '2025-02-28'), 20);
  assert.equal(ageOn('2004-02-29', '2025-03-01'), 21);
});

test('a rule applies from its date, the earliest also before it', () => {
  const two = [{ validFrom: '2027-01-01', baseDays: 27, managementDays: null, ageSteps: [] }, { validFrom: '2025-01-01', baseDays: 22, managementDays: null, ageSteps: [] }];
  assert.equal(days('2020-05-01', person(null), two), 22);
  assert.equal(days('2026-12-31', person(null), two), 22);
  assert.equal(days('2027-01-01', person(null), two), 27);
});

test('the legal minimum: 20 days, 25 until the 20th birthday', () => {
  const low = [{ validFrom: '2000-01-01', baseDays: 20, managementDays: null, ageSteps: [] }];
  assert.equal(days('2026-05-31', person('2006-06-01'), low), 25);
  assert.equal(days('2026-06-01', person('2006-06-01'), low), 20);
  assert.equal(days('2026-06-01', person(null), [{ ...low[0], baseDays: 10 }]), 20);
});

test('62, management, 80%: 26.4 days', () => {
  const schedules = [{ ...defaultSchedule(), validFrom: '2020-01-01', workloadPercent: 80 }];
  const who = person('1964-01-01', true);
  assert.equal(vacationEntitlement(2026, (d) => days(d, who), schedules, defaultSchedule()), 26.4);
});

test('without saved rules the old single number stays the base', () => {
  assert.equal(parseVacationSettings({ vacationDaysPerYear: 27 }).rules[0].baseDays, 27);
  assert.equal(parseVacationSettings(null).rules[0].baseDays, 25);
  assert.equal(parseVacationSettings({ vacation: { probationMonths: 3 }, vacationDaysPerYear: 22 }).probationMonths, 3);
});

test('rules are checked', () => {
  const rule = rules[0];
  const check = (patch, months = 1) => validateVacationSettings({ rules: [{ ...rule, ...patch }], probationMonths: months });
  assert.equal(check({}).ok, true);
  assert.equal(check({ baseDays: 19 }).error, 'invalid-days');
  assert.equal(check({ managementDays: 24 }).error, 'invalid-days');
  assert.equal(check({ validFrom: '2026-02-30' }).error, 'invalid-date');
  assert.equal(check({ ageSteps: [{ age: 60, days: 5 }, { age: 60, days: 2 }] }).error, 'invalid-age-step');
  assert.equal(check({}, 4).error, 'invalid-probation');
  assert.equal(validateVacationSettings({ rules: [rule, rule], probationMonths: 1 }).error, 'invalid-date');
});

test('probation ends the day before the month is over, or on the date HR set', () => {
  assert.equal(probationEnd('2026-11-01', 1), '2026-11-30');
  assert.equal(probationEnd('2026-12-15', 3), '2027-03-14');
  assert.equal(probationEnd('2026-01-31', 1), '2026-02-27');
  assert.equal(probationEnd('2026-11-01', 0), null);
  assert.equal(probationEnd('2026-11-01', 1, '2027-01-12'), '2027-01-12');
  assert.equal(probationEnd('2026-11-01', 1, '2026-10-31'), null);
});

test('no time recording needs a reason; hours per day is not offered yet', () => {
  const base = { validFrom: '2026-01-01', workloadPercent: 100, dayMinutes: defaultSchedule().dayMinutes };
  assert.equal(validateSchedule({ ...base, timeRecording: 'none', exemptionReason: 'waiver' }).ok, true);
  assert.equal(validateSchedule({ ...base, timeRecording: 'none' }).error, 'invalid-time-recording');
  assert.equal(validateSchedule({ ...base, timeRecording: 'daily' }).error, 'invalid-time-recording');
  assert.equal(validateSchedule({ ...base, exemptionReason: 'waiver' }).error, 'invalid-time-recording');
});

test('unpaid leave: calendar days of the year, a half day half, each day once', () => {
  assert.equal(unpaidLeaveDays(2026, [{ dateStart: '2026-03-02', dateEnd: '2026-03-31', halfDay: false }]), 30);
  assert.equal(unpaidLeaveDays(2026, [{ dateStart: '2025-12-20', dateEnd: '2026-01-10', halfDay: false }]), 10);
  assert.equal(unpaidLeaveDays(2026, [
    { dateStart: '2026-05-04', dateEnd: '2026-05-08', halfDay: false },
    { dateStart: '2026-05-08', dateEnd: '2026-05-08', halfDay: true },
    { dateStart: '2026-06-01', dateEnd: '2026-06-01', halfDay: true },
  ]), 5.5);
});

test('unpaid leave cuts a twelfth per full month, never before one (Art. 329b para. 1 CO)', () => {
  assert.equal(unpaidLeaveCut(25, 29.5), 0);
  assert.equal(unpaidLeaveCut(25, 30), 2.08);
  assert.equal(unpaidLeaveCut(25, 75), 4.17);
  assert.equal(unpaidLeaveCut(25, 400), 25);
});
