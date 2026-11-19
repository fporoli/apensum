import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absenceRows, attendanceRows } from '../../apps/api/src/reports.controller';
import type { MonthBalance } from '../../apps/api/src/balances.service';

function month(m: string, over: Partial<MonthBalance> = {}): MonthBalance {
  return {
    month: m, status: 'closed', closedAt: null, scheduled: 0, holiday: 0, absenceByType: {}, target: 0, actual: 0, delta: 0, vacationDays: 0,
    monthTarget: 0, plannedVacationDays: 0, adjustmentMinutes: 0, overtimeOpening: 0, overtimeBalance: 0, vacationOpening: 0, vacationCredited: 0,
    vacationAdjustmentDays: 0, vacationBalance: 0, legalOvertimeMinutes: 0, legalOvertimeAdjustments: 0, legalOvertimeBalance: 0,
    ...over,
  };
}

test('attendanceRows: hours from minutes, balances as they stand, months before the start or ahead left out', () => {
  const rows = attendanceRows('u1', 'Anna', [
    month('2026-01', { status: 'before-start' }),
    month('2026-02', { target: 9600, actual: 9930, delta: 330, overtimeBalance: 330, legalOvertimeMinutes: 30, vacationDays: 2 }),
    month('2026-03', { status: 'current', target: 480, actual: 450, delta: -30, overtimeBalance: 300 }),
    month('2026-04', { status: 'future' }),
  ]);
  assert.deepEqual(rows, [
    { person: 'u1', personName: 'Anna', month: '2026-02', target: 160, worked: 165.5, difference: 5.5, overtimeBalance: 5.5, legalOvertime: 0.5, vacationDays: 2 },
    { person: 'u1', personName: 'Anna', month: '2026-03', target: 8, worked: 7.5, difference: -0.5, overtimeBalance: 5, legalOvertime: 0, vacationDays: 0 },
  ]);
});

test('absenceRows: one row per type and month; vacation in the balances\' days, others over a full-time day', () => {
  const rows = absenceRows('u1', 'Anna', [
    month('2026-02', { absenceByType: { vacation: 960, sickness: 504, accident: 0 }, vacationDays: 2.5 }),
  ], 504);
  assert.deepEqual(rows, [
    { person: 'u1', personName: 'Anna', month: '2026-02', type: 'vacation', days: 2.5, hours: 16 },
    { person: 'u1', personName: 'Anna', month: '2026-02', type: 'sickness', days: 1, hours: 8.4 },
  ]);
});

test("a plugin's report: rows from its source, only of the people the core checked, with the project filter it offers", async () => {
  const { ReportsService } = await import('../../apps/api/src/reports.service');
  const { registerApiReport } = await import('../../apps/api/src/report-sources');
  const definition = {
    id: 'testPlugin', object: 'nav.time', dimensions: ['person', 'month'], defaultGroupBy: ['person'],
    measures: [{ key: 'count', kind: 'count' as const, aggregate: 'sum' as const }], chart: ['count'], projectFilter: true,
  };
  const calls: Array<{ people: string[]; first: string; last: string; projectId?: string }> = [];
  registerApiReport({
    definition,
    rows: async (ctx) => {
      calls.push({ people: ctx.people.map((p) => p.id), first: ctx.first, last: ctx.last, projectId: ctx.projectId });
      return [
        { person: 'u1', personName: 'Anna', month: '2026-01', count: 2 },
        { person: 'intruder', personName: 'X', month: '2026-01', count: 5 },
      ];
    },
  });
  const svc = new ReportsService({} as never, {} as never);
  svc.scope = async () => ({ callerId: 'me', def: definition, people: [{ id: 'u1', name: 'Anna' }] });
  const project = '11111111-2222-3333-4444-555555555555';
  const out = await svc.run({} as never, 'org', 'me', 'testPlugin', { from: '2026-01', to: '2026-02', projectId: project });
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows, [{ person: 'u1', personName: 'Anna', count: 2 }]);
  assert.deepEqual(calls, [{ people: ['u1'], first: '2026-01', last: '2026-02', projectId: project }]);
  const bad = await svc.run({} as never, 'org', 'me', 'testPlugin', { from: '2026-01', to: '2026-02', projectId: 'nope' });
  assert.equal(bad.error, 'unknown-project');
});
