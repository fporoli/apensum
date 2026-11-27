import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registerModule } from '@worktime3/shared/modules';
import { validateTrigger, withinLead, triggerFlowKey, triggerKeyPrefix, PERMIT_EVENT, CORE_TRIGGERS, type TriggerSource } from '../../apps/api/src/triggers';
import { TriggersService } from '../../apps/api/src/triggers.service';
import { FlowTriggersController } from '../../apps/api/src/flow-triggers.controller';
import { permitTriggered } from '../../apps/api/src/workflow-dues.service';
import type { ApiPlugin } from '../../apps/api/src/plugin';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

/** The text of a drizzle SQL object (nested fragments inlined, parameters as `?`). */
function sqlText(q: unknown): string {
  return ((q as { queryChunks?: unknown[] }).queryChunks ?? []).map((c) => {
    const v = (c as { value?: unknown })?.value;
    if (Array.isArray(v)) return v.join('');
    if ((c as { queryChunks?: unknown })?.queryChunks) return sqlText(c);
    return '?';
  }).join('');
}

const DEPT = '11111111-1111-4111-8111-111111111111';

test('a trigger is checked: a known event, lead days 0-365, a flow type key, a target, a department for a Free Flow to one', () => {
  const events = ['permitExpires', 'hr.anniversary'];
  const ok = validateTrigger({ event: 'hr.anniversary', leadDays: 30, target: 'department', departmentId: DEPT, label: ' Jubiläen ' }, events);
  assert.deepEqual(ok, { ok: true, value: { event: 'hr.anniversary', enabled: true, leadDays: 30, flowType: null, target: 'department', departmentId: DEPT, confidential: true, label: 'Jubiläen' } });
  // A flow type's steps decide who does what: no department needed.
  assert.ok(validateTrigger({ event: 'permitExpires', flowType: 'bewilligung', target: 'department' }, events).ok);
  assert.ok(validateTrigger({ event: 'permitExpires', target: 'person', enabled: false, confidential: false }, events).ok);
  assert.deepEqual(validateTrigger({ event: 'birthday' }, events), { ok: false, error: 'unknown-event' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', leadDays: 400, departmentId: DEPT }, events), { ok: false, error: 'invalid-lead-days' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', leadDays: 1.5, departmentId: DEPT }, events), { ok: false, error: 'invalid-lead-days' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', flowType: 'Not A Key' }, events), { ok: false, error: 'invalid-flow-type' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', target: 'everyone', departmentId: DEPT }, events), { ok: false, error: 'invalid-target' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', target: 'department' }, events), { ok: false, error: 'department-required' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', departmentId: 'hr' }, events), { ok: false, error: 'invalid-department' });
  assert.deepEqual(validateTrigger({ event: 'permitExpires', departmentId: DEPT, label: 'x'.repeat(101) }, events), { ok: false, error: 'invalid-label' });
  assert.deepEqual(validateTrigger(null, events), { ok: false, error: 'invalid-trigger' });
});

test('an occurrence opens from lead days before its date until the date; without a lead time always', () => {
  assert.equal(withinLead('2027-01-01', '2026-12-20', 14), true);
  assert.equal(withinLead('2027-01-10', '2026-12-20', 14), false);
  assert.equal(withinLead('2026-12-19', '2026-12-20', 14), false);
  assert.equal(withinLead('2026-12-20', '2026-12-20', 0), true);
  assert.equal(withinLead('2026-01-01', '2026-12-20', false), true);
  assert.equal(triggerFlowKey('t1', 'anniversary:u1:2027-01-01'), 'trigger:t1:anniversary:u1:2027-01-01');
  assert.ok(triggerFlowKey('t1', 'x').startsWith(triggerKeyPrefix('t1')));
});

test('the core offers the permit event, sensitive to who edits personal data for everyone', () => {
  const [permit] = CORE_TRIGGERS.events;
  assert.equal(permit.id, PERMIT_EVENT);
  assert.equal(permit.sensitive, 'section.basicdata.personalien');
  assert.equal(permit.defaultLeadDays, 90);
  for (const l of ['de', 'fr', 'it', 'en'] as const) assert.ok(permit.label[l]);
});

/** A plugin with one event: two occurrences, one within 14 days, one later. */
function demoPlugin(id = 'demo'): ApiPlugin {
  const source: TriggerSource = {
    events: [{ id: `${id}.ev`, label: { de: 'E', fr: 'E', it: 'E', en: 'E' }, placeholders: ['name'], defaultLeadDays: 14 }],
    due: async (_db, _org, _today, horizons) => horizons[`${id}.ev`] === undefined ? [] : [
      { event: `${id}.ev`, key: 'a:u1:2027-01-01', aboutUserId: 'u1', date: '2027-01-01', data: { date: '2027-01-01' }, text: (l) => ({ subject: `S ${l}`, message: 'M' }) },
      { event: `${id}.ev`, key: 'b:u2:2027-03-01', aboutUserId: 'u2', date: '2027-03-01', data: {}, text: () => ({ subject: 'S', message: 'M' }) },
    ],
  };
  return { id, triggers: source };
}

function engine(opts: { triggers: Record<string, unknown>[]; modules?: Record<string, boolean>; plugins?: ApiPlugin[]; flowsOn?: boolean }) {
  const opened: Record<string, unknown>[] = [];
  const closed: { keep: string[]; prefix?: string }[] = [];
  const runs: string[] = [];
  const db = {
    execute: async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes('flow_trigger_runs')) { runs.push(s); return { rows: [] }; }
      if (s.includes('FROM flow_triggers')) return { rows: opts.triggers };
      if (s.includes('organization_licenses')) return { rows: [{ modules: opts.modules ?? {}, licenses: [] }] };
      if (s.includes('leader_user_id FROM departments')) return { rows: [{ leader_user_id: 'lead' }] };
      if (s.includes('SELECT locale FROM users')) return { rows: [{ locale: 'fr' }] };
      return { rows: [] };
    },
  };
  const flows = {
    enabled: async () => opts.flowsOn !== false,
    openTask: async (_db: unknown, input: Record<string, unknown>) => { opened.push(input); return { ok: true, id: 'f', created: true, changed: true }; },
    closeTasks: async (_db: unknown, _org: string, source: string, keep: string[], _today: string, prefix?: string) => { assert.equal(source, 'trigger'); closed.push({ keep, prefix }); return 0; },
  };
  const svc = new TriggersService({ getDb: () => db } as never, flows as never, opts.plugins ?? [demoPlugin()]);
  return { svc, db, opened, closed, runs };
}

const row = (over: Record<string, unknown>) => ({ id: 't1', event: 'demo.ev', enabled: true, lead_days: 14, flow_type: null, target: 'department', department_id: DEPT, confidential: true, label: null, ...over });

test('the engine opens each occurrence within the lead time once, keyed per trigger, and closes the rest of that trigger', async () => {
  const { svc, db, opened, closed, runs } = engine({ triggers: [row({})] });
  const result = await svc.run(db as never, 'org-1', null, new Date('2026-12-20T10:00:00Z'));
  assert.deepEqual(result, { ok: true, opened: 1, updated: 0, closed: 0, errors: 0 });
  // The run is kept (Letzte Läufe) and old ones dropped.
  assert.equal(runs.length, 2);
  assert.match(runs[0], /INSERT INTO flow_trigger_runs/);
  assert.match(runs[1], /DELETE FROM flow_trigger_runs/);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].key, 'trigger:t1:a:u1:2027-01-01');
  assert.equal(opened[0].source, 'trigger');
  assert.equal(opened[0].departmentId, DEPT);
  assert.equal(opened[0].aboutUserId, 'u1');
  assert.equal(opened[0].dueDate, '2027-01-01');
  assert.equal(opened[0].confidential, true);
  // In the department leader's language.
  assert.equal(opened[0].subject, 'S fr');
  assert.deepEqual(closed, [{ keep: ['trigger:t1:a:u1:2027-01-01'], prefix: 'trigger:t1:' }]);
});

test('the engine: a longer lead time opens the later one too; a disabled trigger only closes its flows; flows off does nothing', async () => {
  const longer = engine({ triggers: [row({ lead_days: 90, flow_type: 'jubilaeum', target: 'manager' })] });
  await longer.svc.run(longer.db as never, 'org-2', null, new Date('2026-12-20T10:00:00Z'));
  assert.deepEqual(longer.opened.map((o) => [o.key, o.flowType, o.target]), [
    ['trigger:t1:a:u1:2027-01-01', 'jubilaeum', 'manager'],
    ['trigger:t1:b:u2:2027-03-01', 'jubilaeum', 'manager'],
  ]);
  const off = engine({ triggers: [row({ enabled: false })] });
  await off.svc.run(off.db as never, 'org-3', null, new Date('2026-12-20T10:00:00Z'));
  assert.deepEqual(off.opened, []);
  assert.deepEqual(off.closed, [{ keep: [], prefix: 'trigger:t1:' }]);
  const noFlows = engine({ triggers: [row({})], flowsOn: false });
  assert.deepEqual(await noFlows.svc.run(noFlows.db as never, 'org-4'), { ok: false, error: 'flows-off' });
  assert.deepEqual(noFlows.closed, []);
});

test('the engine leaves the triggers of a module that is off alone (neither opened nor closed)', async () => {
  registerModule({ id: 'demooff', caption: 'modules.demooff', defaultEnabled: true, objects: [] });
  const e = engine({ triggers: [row({ event: 'demooff.ev' })], plugins: [demoPlugin('demooff')], modules: { demooff: false } });
  await e.svc.run(e.db as never, 'org-5', null, new Date('2026-12-20T10:00:00Z'));
  assert.deepEqual(e.opened, []);
  assert.deepEqual(e.closed, []);
});

/** The controller over a fake db: the caller's permission ids, the organization's triggers. */
function controller(permissions: string[], triggers: Record<string, unknown>[]) {
  const db = {
    execute: async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes('JOIN membership_roles')) return { rows: permissions.map((permission_id) => ({ name: 'member', permission_id })) };
      if (s.includes('FROM flow_triggers')) return { rows: triggers };
      if (s.includes('organization_licenses')) return { rows: [{ modules: {}, licenses: [] }] };
      return { rows: [] };
    },
  };
  const flows = { enabled: async () => true, openTask: async () => ({ ok: true }), closeTasks: async () => 0 };
  const svc = new TriggersService({ getDb: () => db } as never, flows as never, [demoPlugin()]);
  const workflows = { kinds: () => new Map(), ownConfig: async () => null };
  const ignore = { record: async () => {} };
  return new FlowTriggersController({ getDb: () => db } as never, svc, flows as never, workflows as never, ignore as never, ignore as never);
}

const req = (sub: string) => ({ user: { kind: 'local', sub } }) as unknown as AuthenticatedRequest;

test('a sensitive event (the permit) and its triggers belong to who edits personal data for everyone, not to the Flow-Designer', async () => {
  const rows = [row({ id: 't1', event: 'demo.ev' }), row({ id: 't2', event: PERMIT_EVENT })];
  // The owner (Flow-Designer, no HR rights): the other events' triggers only.
  const designer = controller(['nav.admin:see:all', 'section.admin.workflows:edit:all'], rows);
  const a = await designer.list('org-6', req('designer'));
  assert.deepEqual(a.events.map((e: { id: string }) => e.id), ['demo.ev']);
  assert.deepEqual(a.triggers.map((t: { id: string }) => t.id), ['t1']);
  assert.equal(a.editable, true);
  assert.equal(a.designer, true);
  // Not seen, so not changed either.
  assert.deepEqual(await designer.remove('org-6', 't2', req('designer')), { ok: false, error: 'not-found' });
  assert.deepEqual(await designer.create('org-6', { event: PERMIT_EVENT, departmentId: DEPT }, req('designer')), { ok: false, error: 'unknown-event' });

  // HR without the Flow-Designer: the permit's triggers only, and changes them; runs them (after an exit date).
  const hr = controller(['section.basicdata.personalien:edit:all'], rows);
  const b = await hr.list('org-7', req('hr'));
  assert.deepEqual(b.events.map((e: { id: string }) => e.id), [PERMIT_EVENT]);
  assert.deepEqual(b.triggers.map((t: { id: string }) => t.id), ['t2']);
  assert.equal(b.designer, false);
  assert.deepEqual(await hr.create('org-7', { event: 'demo.ev', departmentId: DEPT }, req('hr')), { ok: false, error: 'unknown-event' });
  assert.deepEqual(await hr.update('org-7', 't1', { event: 'demo.ev', departmentId: DEPT }, req('hr')), { ok: false, error: 'not-found' });
  assert.equal((await hr.runNow('org-7', req('hr'))).ok, true);

  // An admin who only reads: sees the other events' triggers, changes nothing.
  const admin = controller(['nav.admin:see:all'], rows);
  const c = await admin.list('org-8', req('admin'));
  assert.deepEqual(c.triggers.map((t: { id: string }) => t.id), ['t1']);
  assert.equal(c.editable, false);
  assert.deepEqual(await admin.remove('org-8', 't1', req('admin')), { ok: false, error: 'forbidden' });

  const member = controller([], rows);
  assert.deepEqual(await member.runNow('org-9', req('member')), { ok: false, error: 'forbidden' });
  assert.deepEqual((await member.list('org-9', req('member'))).triggers, []);
});

test('the core permit reminder stays silent where an enabled permit trigger exists', async () => {
  const db = (enabled: boolean) => ({
    execute: async (q: unknown) => ({ rows: sqlText(q).includes('FROM flow_triggers') && sqlText(q).includes('enabled') && enabled ? [{ '?column?': 1 }] : [] }),
  });
  assert.equal(await permitTriggered(db(true) as never, 'org'), true);
  assert.equal(await permitTriggered(db(false) as never, 'org'), false);
});
