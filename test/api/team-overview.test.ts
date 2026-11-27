import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TeamOverviewController, monthRange } from '../../apps/api/src/team-overview.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { WorkTimeModelService } from '../../apps/api/src/work-time-model.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

// Team tables list the people the caller may see (direct reports, or everyone for a grant on
// all); a plain member has no team, so the pages show no Team tab. Every team table shows the
// caller first next to their team.

const MEMBER = [{ name: 'member', permission_id: 'nav.absences:edit:own' }];
const HR = [{ name: 'hr', permission_id: 'nav.absences:see:all' }, { name: 'hr', permission_id: 'nav.projectTimesheet:see:all' }];
const ROLES: Record<string, { name: string; permission_id: string }[]> = { emp: MEMBER, boss: MEMBER, hr: HR };
const REPORTS: Record<string, string[]> = { boss: ['emp'] };
const MEMBERS = [
  { id: 'boss', name: 'Boss', email: 'boss@x' },
  { id: 'emp', name: 'Emp', email: 'emp@x' },
  { id: 'hr', name: 'Hr', email: 'hr@x' },
];

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}
function sqlParams(query: any): any[] {
  return (query.queryChunks ?? []).filter((c: any) => !Array.isArray(c?.value) && !c?.queryChunks); // a nested fragment (the business clock's date) is not a parameter of its own
}

function controller(caller = '') {
  const db: any = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      const params = sqlParams(q);
      if (text.includes('LEFT JOIN role_permissions')) return { rows: ROLES[params[1]] ?? [] };
      if (text.includes('JOIN membership_roles')) return { rows: (ROLES[params[1]] ?? []).slice(0, 1) };
      if (text.includes('SELECT 1 FROM organization_memberships')) return { rows: ROLES[params[1]] ? [{ '?column?': 1 }] : [] };
      if (text.includes('manager_user_id =')) return { rows: (REPORTS[params[1]] ?? []).map((user_id) => ({ user_id })) };
      return { rows: [] };
    },
    select: () => db,
    from: () => db,
    innerJoin: () => db,
    where: () => db,
    // Membership filtering happens in SQL; the fake returns everyone and the controller drops the caller.
    orderBy: async () => MEMBERS,
    limit: async () => MEMBERS.filter((m) => m.id === caller),
  };
  const holidays = { holidays: async () => new Map(), locations: async () => [] } as unknown as WorkTimeModelService;
  return new TeamOverviewController({ getDb: () => db } as unknown as DbService, holidays);
}
const as = (sub: string) => ({ user: { kind: 'local', sub } }) as unknown as AuthenticatedRequest;

test('monthRange: a month and the first day of the next one', () => {
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', toExclusive: '2027-01-01' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', toExclusive: '2026-03-01' });
  assert.equal(monthRange('2026-13'), null);
  assert.equal(monthRange('2026-1'), null);
  assert.equal(monthRange(undefined), null);
});

test('team overview: unknown kinds and months are rejected', async () => {
  assert.equal((await controller().overview('org', as('hr'), 'salaries', '2026-11')).error, 'invalid-kind');
  assert.equal((await controller().overview('org', as('hr'), 'absences', 'november')).error, 'invalid-month');
});

test('team overview: a member without reports has no team; every table lists the caller first', async () => {
  const member = await controller('emp').overview('org', as('emp'), 'absences', '2026-11');
  assert.deepEqual(member.people, []);
  const peek = await controller('emp').overview('org', as('emp'), 'absences', undefined, '1');
  assert.deepEqual(peek.people, []);

  const hr = await controller('hr').overview('org', as('hr'), 'absences', '2026-11');
  assert.deepEqual(hr.people.map((p: { id: string }) => p.id), ['hr', 'boss', 'emp']);
  assert.deepEqual((hr as { absences?: unknown[] }).absences, []);
  // "Is there a team?" stays the team alone.
  assert.deepEqual((await controller('hr').overview('org', as('hr'), 'absences', undefined, '1')).people.map((p: { id: string }) => p.id), ['boss', 'emp']);
  const work = await controller('hr').overview('org', as('hr'), 'projectTimesheet', '2026-11');
  assert.deepEqual(work.people.map((p: { id: string }) => p.id), ['hr', 'boss', 'emp']);
});
