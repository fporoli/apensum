import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WorkSchedulesController } from '../../apps/api/src/work-schedules.controller';
import { WorkTimeModelService, localDate, localDaysOf, minutesByLocalDay, parseWorkTimeSettings } from '../../apps/api/src/work-time-model.service';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

const versions = { record: async () => {} } as unknown as VersionsService;

/**
 * WorkSchedulesController over a fake db: `permissions` are the caller's ids (a member with
 * none if empty); `locked` makes the timesheet lock query find a settled period.
 */
function setup(opts: { permissions?: string[]; locked?: boolean }) {
  const inserted: any[] = [];
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('JOIN membership_roles')) {
        const ids = opts.permissions?.length ? opts.permissions : [null];
        return { rows: ids.map((permission_id) => ({ name: 'member', permission_id })) };
      }
      if (text.includes('FROM timesheet_periods')) return { rows: opts.locked ? [{ '?column?': 1 }] : [] };
      // isActiveMember (an `all` grant covers active members): everyone is one here.
      if (text.includes('FROM organization_memberships WHERE')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    },
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: () => ({ returning: async () => { inserted.push(v); return [{ id: 'ws-1' }]; } }),
      }),
    }),
  };
  const controller = new WorkSchedulesController({ getDb: () => db } as unknown as DbService, new WorkTimeModelService(), versions);
  const req = { user: { kind: 'local', sub: 'caller' } } as unknown as AuthenticatedRequest;
  return { controller, req, inserted };
}

const schedule = { validFrom: '2026-12-01', workloadPercent: 80, dayMinutes: [480, 480, 480, 480, 0, 0, 0] };

test('saveSchedule needs edit on section.workTime.schedule for that person', async () => {
  const { controller, req, inserted } = setup({ permissions: ['nav.users:see:all', 'section.workTime.schedule:see:all'] });
  assert.deepEqual(await controller.saveSchedule('org-1', 'user-2', schedule, req), { ok: false, error: 'forbidden' });
  assert.equal(inserted.length, 0);
});

test('saveSchedule validates and refuses settled months', async () => {
  const grants = ['nav.users:edit:all', 'section.workTime.schedule:edit:all'];
  const editor = setup({ permissions: grants });
  assert.deepEqual(await editor.controller.saveSchedule('org-1', 'user-2', { ...schedule, workloadPercent: 150 }, editor.req), { ok: false, error: 'invalid-workload' });
  const locked = setup({ permissions: grants, locked: true });
  assert.deepEqual(await locked.controller.saveSchedule('org-1', 'user-2', schedule, locked.req), { ok: false, error: 'period-locked' });
  assert.equal(editor.inserted.length + locked.inserted.length, 0);
});

test('saveSchedule stores the schedule for an editor', async () => {
  const { controller, req, inserted } = setup({ permissions: ['nav.users:edit:all', 'section.workTime.schedule:edit:all'] });
  assert.deepEqual(await controller.saveSchedule('org-1', 'user-2', schedule, req), { ok: true, id: 'ws-1' });
  assert.deepEqual(inserted[0], { organization_id: 'org-1', user_id: 'user-2', valid_from: '2026-12-01', workload_percent: '80', day_minutes: [480, 480, 480, 480, 0, 0, 0] });
});

test('organization settings and holidays need Organization settings edit', async () => {
  const { controller, req } = setup({ permissions: ['nav.orgSettings:see:all'] });
  assert.deepEqual(await controller.setOrgSettings('org-1', { holidayRegion: 'ZH' }, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await controller.saveHoliday('org-1', { date: '2026-12-24' }, req), { ok: false, error: 'forbidden' });
  const admin = setup({ permissions: ['nav.orgSettings:edit:all'] });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { holidayRegion: 'XX' }, admin.req), { ok: false, error: 'invalid-region' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { vacationDaysPerYear: 400 }, admin.req), { ok: false, error: 'invalid-vacation-days' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { overtimeAlertMinutes: 1.5 }, admin.req), { ok: false, error: 'invalid-alert' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { balancesStartDate: '2026-13-01' }, admin.req), { ok: false, error: 'invalid-start-date' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { legalMaxWeeklyMinutes: 1000 }, admin.req), { ok: false, error: 'invalid-legal-max' });
  assert.deepEqual(await admin.controller.setOrgSettings('org-1', { legalOvertimeYearLimitMinutes: -5 }, admin.req), { ok: false, error: 'invalid-legal-limit' });
  assert.deepEqual(await admin.controller.saveHoliday('org-1', { date: '2026-02-30' }, admin.req), { ok: false, error: 'invalid-date' });
  assert.deepEqual(await admin.controller.saveHoliday('org-1', { date: '2026-12-24', fraction: 0.3 }, admin.req), { ok: false, error: 'invalid-fraction' });
});

test('parseWorkTimeSettings applies defaults and ignores bad values', () => {
  assert.deepEqual(parseWorkTimeSettings({}), {
    fullTimeWeeklyMinutes: 2400,
    holidayRegion: null,
    projectTimeToleranceMinutes: 15,
    vacationDaysPerYear: 25,
    overtimeAlertMinutes: 3000,
    undertimeAlertMinutes: 1200,
    balancesStartDate: null,
    legalMaxWeeklyMinutes: 2700,
    legalOvertimeYearLimitMinutes: 10200,
    homeOffice: false,
  });
  assert.deepEqual(
    parseWorkTimeSettings({
      fullTimeWeeklyMinutes: 2520,
      holidayRegion: 'ZH',
      projectTimeToleranceMinutes: 0,
      vacationDaysPerYear: 20,
      overtimeAlertMinutes: 600,
      undertimeAlertMinutes: 0,
      balancesStartDate: '2026-01-01',
      legalMaxWeeklyMinutes: 3000,
    }),
    {
      fullTimeWeeklyMinutes: 2520,
      holidayRegion: 'ZH',
      projectTimeToleranceMinutes: 0,
      vacationDaysPerYear: 20,
      overtimeAlertMinutes: 600,
      undertimeAlertMinutes: 0,
      balancesStartDate: '2026-01-01',
      legalMaxWeeklyMinutes: 3000,
      legalOvertimeYearLimitMinutes: 8400,
      homeOffice: false,
    },
  );
  assert.equal(parseWorkTimeSettings({ holidayRegion: 'XX' }).holidayRegion, null);
  assert.equal(parseWorkTimeSettings({ vacationDaysPerYear: -1 }).vacationDaysPerYear, 25);
  assert.equal(parseWorkTimeSettings({ balancesStartDate: '2026-02-30' }).balancesStartDate, null);
});

test('localDate uses the time zone', () => {
  assert.equal(localDate('2026-11-10T23:30:00Z', 'Europe/Zurich'), '2026-11-11');
  assert.equal(localDate('2026-11-10T23:30:00Z', 'UTC'), '2026-11-10');
  assert.equal(localDate('2026-11-10T23:30:00Z', 'Not/AZone'), '2026-11-10');
});

test('checkProjectTime compares the day\'s project time with its attendance', async () => {
  const service = new WorkTimeModelService();
  const stub = service as any;
  stub.timeZone = async () => 'Europe/Zurich';
  stub.settings = async () => ({ fullTimeWeeklyMinutes: 2400, holidayRegion: null, projectTimeToleranceMinutes: 15 });
  stub.projectMinutesByDay = async () => new Map([['2026-11-10', 120]]); // already booked that day
  stub.attendanceByDay = async () => new Map([['2026-11-10', 240]]);
  const db = {} as any;
  // 120 booked + 2h new = 240 <= 240 + 15.
  assert.deepEqual(await service.checkProjectTime(db, 'org', 'u', '2026-11-10T08:00:00Z', '2026-11-10T10:00:00Z'), { ok: true });
  // 120 booked + 3h new = 300 > 255.
  assert.deepEqual(await service.checkProjectTime(db, 'org', 'u', '2026-11-10T08:00:00Z', '2026-11-10T11:00:00Z'), {
    ok: false,
    error: 'project-exceeds-attendance',
    date: '2026-11-10',
    projectMinutes: 300,
    attendanceMinutes: 240,
    toleranceMinutes: 15,
  });
});

test('checkProjectTime checks both days of an entry past midnight', async () => {
  const service = new WorkTimeModelService();
  const stub = service as any;
  stub.timeZone = async () => 'UTC';
  stub.settings = async () => ({ fullTimeWeeklyMinutes: 2400, holidayRegion: null, projectTimeToleranceMinutes: 0 });
  stub.projectMinutesByDay = async () => new Map();
  // A night shift: 2h attended on the 10th, 6h on the 11th.
  stub.attendanceByDay = async () => new Map([['2026-11-10', 120], ['2026-11-11', 360]]);
  const db = {} as any;
  assert.deepEqual(await service.checkProjectTime(db, 'org', 'u', '2026-11-10T22:00:00Z', '2026-11-11T06:00:00Z'), { ok: true });
  // 3h before midnight is more than the 2h attended that day.
  const late = await service.checkProjectTime(db, 'org', 'u', '2026-11-10T21:00:00Z', '2026-11-11T02:00:00Z');
  assert.equal(late.ok, false);
  assert.equal((late as any).date, '2026-11-10');
  assert.equal((late as any).projectMinutes, 180);
});

test('minutesByLocalDay splits a session at local midnight', () => {
  // 22:00-06:00 Zurich time (winter, UTC+1).
  const night = minutesByLocalDay([{ start: '2026-11-10T21:00:00Z', end: '2026-11-11T05:00:00Z' }], '2026-11-01', '2026-12-01', 'Europe/Zurich');
  assert.deepEqual([...night], [['2026-11-10', 120], ['2026-11-11', 360]]);
  // Only the days asked for: the month ends at midnight.
  const monthEnd = minutesByLocalDay([{ start: '2026-11-30T21:00:00Z', end: '2026-12-01T05:00:00Z' }], '2026-11-01', '2026-12-01', 'Europe/Zurich');
  assert.deepEqual([...monthEnd], [['2026-11-30', 120]]);
  // Ending exactly at midnight adds nothing to the next day; several sessions add up.
  const two = minutesByLocalDay(
    [{ start: '2026-11-10T17:00:00Z', end: '2026-11-10T23:00:00Z' }, { start: '2026-11-10T07:00:00Z', end: '2026-11-10T11:00:00Z' }],
    '2026-11-01', '2026-12-01', 'Europe/Zurich',
  );
  assert.deepEqual([...two], [['2026-11-10', 600]]);
});

test('minutesByLocalDay follows daylight saving: the night of the switch is one hour shorter', () => {
  // Zurich, 29 March 2026: clocks jump from 02:00 to 03:00. 22:00 (UTC+1) to 06:00 (UTC+2) is 7h.
  const m = minutesByLocalDay([{ start: '2026-03-28T21:00:00Z', end: '2026-03-29T04:00:00Z' }], '2026-03-01', '2026-04-01', 'Europe/Zurich');
  assert.deepEqual([...m], [['2026-03-28', 120], ['2026-03-29', 300]]);
  // An unknown zone falls back to UTC instead of failing.
  assert.deepEqual([...minutesByLocalDay([{ start: '2026-11-10T22:00:00Z', end: '2026-11-11T02:00:00Z' }], '2026-11-01', '2026-12-01', 'Not/AZone')], [
    ['2026-11-10', 120],
    ['2026-11-11', 120],
  ]);
});

test('localDaysOf: the days a span touches; ending at 00:00 does not touch the next', () => {
  assert.deepEqual(localDaysOf({ start: '2026-11-10T21:00:00Z', end: '2026-11-11T05:00:00Z' }, 'Europe/Zurich'), ['2026-11-10', '2026-11-11']);
  assert.deepEqual(localDaysOf({ start: '2026-11-10T17:00:00Z', end: '2026-11-10T23:00:00Z' }, 'Europe/Zurich'), ['2026-11-10']);
});
