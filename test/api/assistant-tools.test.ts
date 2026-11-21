import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantZone, findOrgMember, toolPayload, zonedInstant, zonedLocal, type AssistantToolContext } from '../../apps/api/src/assistant-tools';
import { CORE_ASSISTANT_TOOLS } from '../../apps/api/src/assistant-core-tools';
import { assistantSystemPrompt, offeredTools } from '../../apps/api/src/assistant.service';
import { WorkTimeController } from '../../apps/api/src/work-time.controller';
import { ProjectTimeController } from '../../apps/api/src/project-time.controller';
import { AbsencesController } from '../../apps/api/src/absences.controller';
import { namespaceViolations } from '../../packages/shared/src/pluginApi';

const ZONE = 'Europe/Zurich';
const tool = (name: string) => {
  const t = CORE_ASSISTANT_TOOLS.find((x) => x.name === name);
  assert.ok(t, name);
  return t;
};

/** A context whose controllers are the given fakes; times in Zurich, today 2026-11-20. */
function context(controllers: Map<unknown, unknown>, people: Record<string, { id: string; name: string }> = {}): AssistantToolContext {
  return {
    db: {} as AssistantToolContext['db'],
    orgId: 'org-1',
    callerId: 'me',
    req: { user: { kind: 'local', sub: 'me' } },
    timeZone: ZONE,
    today: '2026-11-20',
    get: <T>(type: unknown) => controllers.get(type) as T,
    findPerson: async (text) => people[String(text).toLowerCase()] ?? { error: `no colleague matches "${text}"` },
    findProject: async (text) => (String(text).toLowerCase() === 'website' ? { id: 'p-1', name: 'Website' } : { error: `no project matches "${text}"` }),
    instant: (date, time) => zonedInstant(date, time, ZONE),
    local: (instant) => zonedLocal(instant, ZONE),
  };
}

test('wall-clock times in Zurich become instants, winter and summer', () => {
  assert.equal(zonedInstant('2026-11-20', '08:00', ZONE), '2026-11-20T07:00:00.000Z');
  assert.equal(zonedInstant('2026-07-01', '08:30', ZONE), '2026-07-01T06:30:00.000Z');
  assert.equal(zonedInstant('2026-11-20', '24:00', ZONE), '2026-11-20T23:00:00.000Z');
  assert.equal(zonedInstant('2026-11-20', '8:5', ZONE), null);
  assert.equal(zonedInstant('2026-11-20', '25:00', ZONE), null);
  assert.equal(zonedInstant('20.11.2026', '08:00', ZONE), null);
  assert.deepEqual(zonedLocal('2026-11-20T07:00:00.000Z', ZONE), { date: '2026-11-20', time: '08:00' });
  assert.deepEqual(zonedLocal('2026-03-29T01:30:00.000Z', ZONE), { date: '2026-03-29', time: '03:30' });
});

test('an unknown or missing time zone falls back to Zurich', () => {
  assert.equal(assistantZone(null), 'Europe/Zurich');
  assert.equal(assistantZone('Not/AZone'), 'Europe/Zurich');
  assert.equal(assistantZone('America/New_York'), 'America/New_York');
});

test('tool names are unique and valid', () => {
  const names = CORE_ASSISTANT_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-zA-Z0-9_-]{1,64}$/);
  // A plugin's tools must start with its id, like everything it adds.
  assert.deepEqual(namespaceViolations('expenses', [{ kind: 'assistant tool', name: 'expenses_add' }]), []);
  assert.equal(namespaceViolations('cases', [{ kind: 'assistant tool', name: 'work_time_add' }]).length, 1);
});

test('only the tools of pages the caller may see are offered', async () => {
  const allowed = new Set(['nav.workTime', 'nav.absences']);
  const asked: string[] = [];
  const offered = await offeredTools(CORE_ASSISTANT_TOOLS, async (object) => {
    asked.push(object);
    return allowed.has(object);
  });
  const names = offered.map((t) => t.name);
  assert.ok(names.includes('work_time_add'));
  assert.ok(names.includes('absences_request'));
  assert.ok(names.includes('balances_get'), 'own balances are always visible');
  assert.ok(!names.includes('project_time_add'));
  assert.ok(!names.includes('requests_create'));
  assert.equal(asked.length, new Set(asked).size, 'each permission object is checked once');
});

test('the system prompt tells working time and project time apart, with the weekday', () => {
  const prompt = assistantSystemPrompt({ today: '2026-11-20', timeZone: ZONE, role: 'member', name: 'Ueli', tools: ['work_time_add', 'project_time_add'] });
  assert.match(prompt, /Friday 2026-11-20/);
  assert.match(prompt, /WORKING TIME/);
  assert.match(prompt, /PROJECT TIME/);
  assert.match(prompt, /work_time_add, then project_time_add/);
  const onlyWork = assistantSystemPrompt({ today: '2026-11-20', timeZone: ZONE, role: 'member', name: null, tools: ['work_time_add'] });
  assert.doesNotMatch(onlyWork, /PROJECT TIME/);
});

test('work_time_add records each slot through the Work time endpoint as the caller', async () => {
  const calls: unknown[][] = [];
  const workTime = {
    addEntry: async (...args: unknown[]) => {
      calls.push(args);
      return calls.length === 2 ? { ok: false, error: 'period-locked' } : { ok: true, id: `w-${calls.length}` };
    },
  };
  const ctx = context(new Map([[WorkTimeController, workTime]]));
  const result = await tool('work_time_add').run({
    entries: [
      { date: '2026-11-19', startTime: '08:00', endTime: '12:00', comment: 'morning' },
      { date: '2026-10-30', startTime: '13:00', endTime: '17:00' },
      { date: '2026-11-18', startTime: '22:00', endTime: '02:00' },
      { date: '2026-11-18', startTime: '22:00', endTime: '02:00', endDate: '2026-11-19' },
    ],
  }, ctx);
  assert.equal(calls.length, 3, 'the slot ending before it starts is refused without a call');
  assert.deepEqual(calls[0], ['org-1', 'me', { checkIn: '2026-11-19T07:00:00.000Z', checkOut: '2026-11-19T11:00:00.000Z', comment: 'morning', homeOffice: false, acknowledgeLongSession: false }, ctx.req]);
  assert.deepEqual((calls[2][2] as { checkOut: string }).checkOut, '2026-11-19T01:00:00.000Z');
  const results = (result.data as { results: { ok: boolean; error?: string }[] }).results;
  assert.deepEqual(results.map((r) => r.ok), [true, false, false, true]);
  assert.equal(results[1].error, 'period-locked');
  assert.match(results[2].error ?? '', /endDate/);
  assert.equal(result.action, 'Working time: 2 of 4 recorded.');
});

test("work_time_add for a colleague passes their id; the endpoint decides whether that's allowed", async () => {
  const calls: unknown[][] = [];
  const ctx = context(new Map([[WorkTimeController, { addEntry: async (...a: unknown[]) => { calls.push(a); return { ok: false, error: 'forbidden' }; } }]]), {
    marta: { id: 'u-marta', name: 'Marta A' },
  });
  const result = await tool('work_time_add').run({ person: 'Marta', entries: [{ date: '2026-11-19', startTime: '08:00', endTime: '09:00' }] }, ctx);
  assert.equal(calls[0][1], 'u-marta');
  assert.equal(result.action, undefined);
  const unknown = await tool('work_time_add').run({ person: 'Nobody', entries: [{ date: '2026-11-19', startTime: '08:00', endTime: '09:00' }] }, ctx);
  assert.match(String((unknown.data as { error: string }).error), /no colleague/);
  assert.equal(calls.length, 1);
});

test('project_time_add books on the named project and confirms warnings only when asked', async () => {
  const bodies: Record<string, unknown>[] = [];
  const projectTime = {
    create: async (_org: string, body: Record<string, unknown>) => {
      bodies.push(body);
      return body.acknowledgeAttendance ? { ok: true, id: 'pt' } : { ok: false, error: 'project-exceeds-attendance-confirm', projectMinutes: 240, attendanceMinutes: 0 };
    },
  };
  const ctx = context(new Map([[ProjectTimeController, projectTime]]));
  const first = await tool('project_time_add').run({ entries: [{ date: '2026-11-19', startTime: '08:00', endTime: '12:00', project: 'website' }, { date: '2026-11-19', startTime: '13:00', endTime: '14:00', project: 'Moon' }] }, ctx);
  assert.equal(bodies.length, 1, 'an unknown project is refused before the endpoint');
  assert.deepEqual(bodies[0], { projectId: 'p-1', startTime: '2026-11-19T07:00:00.000Z', endTime: '2026-11-19T11:00:00.000Z', comment: undefined, userId: 'me', acknowledgeOverlap: false, acknowledgeAttendance: false });
  const r = (first.data as { results: Record<string, unknown>[] }).results;
  assert.equal(r[0].error, 'project-exceeds-attendance-confirm');
  assert.equal(r[0].workingMinutesThatDay, 0);
  assert.match(String(r[1].error), /no project/);
  const second = await tool('project_time_add').run({ confirmWarnings: true, entries: [{ date: '2026-11-19', startTime: '08:00', endTime: '12:00', project: 'Website' }] }, ctx);
  assert.equal(second.action, 'Project time: 1 of 1 booked.');
});

test('absences_request goes through the Absences endpoint', async () => {
  const calls: unknown[][] = [];
  const ctx = context(new Map([[AbsencesController, { submit: async (...a: unknown[]) => { calls.push(a); return { ok: true, id: 'a', autoApproved: false }; } }]]));
  const result = await tool('absences_request').run({ dateStart: '2026-12-21', dateEnd: '2026-12-24', type: 'vacation' }, ctx);
  assert.deepEqual(calls[0], ['org-1', { dateStart: '2026-12-21', dateEnd: '2026-12-24', absenceType: 'vacation', halfDay: false, note: undefined }, ctx.req]);
  assert.equal(result.action, 'Absence 2026-12-21 – 2026-12-24 (vacation) sent for approval.');
});

test('work_time_list shows local times and the total', async () => {
  const ctx = context(new Map([[WorkTimeController, {
    list: async (_o: string, _r: unknown, userId: string, from: string, to: string) => {
      assert.equal(userId, 'me');
      assert.equal(from, '2026-11-15T23:00:00.000Z');
      assert.equal(to, '2026-11-20T23:00:00.000Z');
      return { entries: [
        { id: 'w1', check_in: '2026-11-19T07:00:00.000Z', check_out: '2026-11-19T11:30:00.000Z', comment: null },
        { id: 'w2', check_in: '2026-11-20T07:00:00.000Z', check_out: null, comment: null },
      ] };
    },
  }]]));
  const result = await tool('work_time_list').run({ from: '2026-11-16', to: '2026-11-20' }, ctx);
  const data = result.data as { entries: Record<string, unknown>[]; totalHours: number };
  assert.deepEqual(data.entries[0], { id: 'w1', date: '2026-11-19', start: '08:00', end: '12:30', minutes: 270, comment: null });
  assert.equal(data.entries[1].end, null);
  assert.equal(data.totalHours, 4.5);
});

test('a long tool answer is cut', () => {
  assert.equal(toolPayload({ a: 1 }), '{"a":1}');
  const long = toolPayload({ text: 'x'.repeat(20_000) }, 100);
  assert.ok(long.length < 200);
  assert.match(long, /cut/);
});

test('findOrgMember: an exact name wins, several partial matches are named', async () => {
  const rowsDb = (rows: unknown[]) => ({
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }) }) }),
  }) as unknown as AssistantToolContext['db'];
  const both = [{ id: '1', name: 'Marco B', email: 'marco@acme.com' }, { id: '2', name: 'Marta A', email: 'marta@acme.com' }];
  assert.deepEqual(await findOrgMember(rowsDb(both), 'o', 'marta a'), { id: '2', name: 'Marta A' });
  assert.match(String(((await findOrgMember(rowsDb(both), 'o', 'mar')) as { error: string }).error), /several.*Marco B, Marta A/);
  assert.deepEqual(await findOrgMember(rowsDb([both[0]]), 'o', 'marco'), { id: '1', name: 'Marco B' });
  assert.match(String(((await findOrgMember(rowsDb([]), 'o', 'zed')) as { error: string }).error), /no colleague/);
});
