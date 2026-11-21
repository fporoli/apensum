import { and, eq, ilike, inArray } from 'drizzle-orm';
import { can, listableUserIds } from './access';
import { AbsencesController, resolveAbsenceTypes } from './absences.controller';
import {
  isIsoDay, minutesBetween, registerAssistantTool,
  type AssistantTool, type AssistantToolContext, type AssistantToolResult,
} from './assistant-tools';
import { BalancesController } from './balances.controller';
import { organization_memberships, project_times, team_members, teams, users } from './db/schema';
import { ProjectTimeController } from './project-time.controller';
import { ProjectsController } from './projects.controller';
import { RequestsController, REQUEST_STATUSES } from './requests.controller';
import { WorkTimeController } from './work-time.controller';
import { WorkflowsController } from './workflows.controller';

/**
 * The core's assistant tools (assistant-tools.ts): working time, project time, absences, balances,
 * approvals and requests. Each calls the page's controller method as the caller.
 */

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const dateRange = {
  from: { type: 'string', description: 'First day, YYYY-MM-DD (inclusive)' },
  to: { type: 'string', description: 'Last day, YYYY-MM-DD (inclusive)' },
};
const person = {
  person: { type: 'string', description: "A colleague's name or e-mail, only when the user asks about someone else (as their manager or HR). Leave out for the user's own." },
};

/** The person a tool works on: the caller, or a named colleague (the controller decides whether the caller may). */
async function target(args: Args, ctx: AssistantToolContext): Promise<{ id: string; name?: string } | { error: string }> {
  if (!str(args.person)) return { id: ctx.callerId };
  return ctx.findPerson(args.person);
}

/** Inclusive local days as the instants [from 00:00, day after `to` 00:00); defaults to the current month. */
function instantRange(args: Args, ctx: AssistantToolContext): { from: string; to: string; fromDay: string; toDay: string } | { error: string } {
  const fromDay = isIsoDay(args.from) ? args.from : `${ctx.today.slice(0, 8)}01`;
  const toDay = isIsoDay(args.to) ? args.to : ctx.today;
  if (toDay < fromDay) return { error: '"to" is before "from"' };
  const next = new Date(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from: ctx.instant(fromDay, '00:00') as string, to: ctx.instant(next, '00:00') as string, fromDay, toDay };
}

/** Start and end of an entry from date, times and an optional end date (a session past midnight). */
function span(e: Args, ctx: AssistantToolContext): { start: string; end: string } | { error: string } {
  const start = ctx.instant(e.date, e.startTime);
  const end = ctx.instant(isIsoDay(e.endDate) ? e.endDate : e.date, e.endTime);
  if (!start || !end) return { error: 'needs date YYYY-MM-DD and startTime/endTime HH:MM' };
  if (Date.parse(end) <= Date.parse(start)) return { error: 'end is not after start (past midnight: give endDate)' };
  return { start, end };
}

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

function entryList(rows: { id: string; start: string; end: string | null; comment?: string | null; project?: string | null }[], ctx: AssistantToolContext) {
  let total = 0;
  const entries = rows.map((r) => {
    const s = ctx.local(r.start);
    const minutes = r.end ? minutesBetween(r.start, r.end) : null;
    if (minutes) total += minutes;
    return {
      id: r.id, date: s.date, start: s.time, end: r.end ? ctx.local(r.end).time : null, ...(r.end && ctx.local(r.end).date !== s.date ? { endDate: ctx.local(r.end).date } : {}),
      minutes, ...(r.project !== undefined ? { project: r.project ?? null } : {}), comment: r.comment ?? null,
    };
  });
  return { entries, totalHours: hours(total) };
}

const entriesParam = (extra: Record<string, unknown>) => ({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      startTime: { type: 'string', description: 'HH:MM, 24h, local time' },
      endTime: { type: 'string', description: 'HH:MM, 24h, local time' },
      endDate: { type: 'string', description: 'Only for a slot ending after midnight: the day it ends' },
      ...extra,
      comment: { type: 'string' },
    },
    required: ['date', 'startTime', 'endTime'],
  },
});

// ---- Working time (attendance) ----

const workTimeList: AssistantTool = {
  name: 'work_time_list',
  object: 'nav.workTime',
  description: 'WORKING TIME (attendance, Arbeitszeit/Präsenz, check-in/check-out sessions): list the sessions in a period, with the total. Not project time.',
  parameters: { type: 'object', properties: { ...dateRange, ...person } },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const range = instantRange(args, ctx);
    if ('error' in range) return { data: range };
    const res = await ctx.get(WorkTimeController).list(ctx.orgId, ctx.req, who.id, range.from, range.to);
    const rows = (res.entries as { id: string; check_in: string; check_out: string | null; comment: string | null; home_office?: boolean }[])
      .map((r) => ({ id: r.id, start: r.check_in, end: r.check_out, comment: r.comment, ...(r.home_office ? { homeOffice: true } : {}) }));
    return { data: { person: who.name ?? 'you', from: range.fromDay, to: range.toDay, ...entryList(rows, ctx) } };
  },
};

const workTimeAdd: AssistantTool = {
  name: 'work_time_add',
  object: 'nav.workTime',
  description:
    'WORKING TIME: record completed attendance sessions (as on the Work time page, e.g. a forgotten check-in). ' +
    'This is what overtime and the monthly timesheet count. It does NOT book hours on a project: for that use project_time_add as well. ' +
    "A session overlapping another of the person's is refused (error overlap, naming the other session): tell the user, never delete the other one on your own.",
  parameters: {
    type: 'object',
    properties: {
      entries: entriesParam({}),
      ...person,
      homeOffice: { type: 'boolean', description: 'The sessions were worked from home (only when the user says so; default: not).' },
      confirmLongSession: { type: 'boolean', description: 'Only after the user confirmed a session over 16 hours is meant.' },
    },
    required: ['entries'],
  },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const entries = Array.isArray(args.entries) ? (args.entries as Args[]).slice(0, 31) : [];
    if (entries.length === 0) return { data: { error: 'no entries' } };
    const controller = ctx.get(WorkTimeController);
    const results = [];
    let created = 0;
    for (const e of entries) {
      const s = span(e, ctx);
      if ('error' in s) { results.push({ date: e.date, ok: false, error: s.error }); continue; }
      const res = await controller.addEntry(ctx.orgId, who.id, {
        checkIn: s.start, checkOut: s.end, comment: str(e.comment), homeOffice: args.homeOffice === true, acknowledgeLongSession: args.confirmLongSession === true,
      }, ctx.req) as { ok: boolean; error?: string; id?: string };
      if (res.ok) created += 1;
      results.push({ date: e.date, startTime: e.startTime, endTime: e.endTime, ok: res.ok, ...(res.error ? { error: res.error } : { id: res.id }) });
    }
    return { data: { results }, action: created ? `Working time: ${created} of ${entries.length} recorded${who.name ? ` for ${who.name}` : ''}.` : undefined };
  },
};

const workTimeCheckIn: AssistantTool = {
  name: 'work_time_check_in',
  object: 'nav.workTime',
  description: 'WORKING TIME: check the user in now (starts an attendance session).',
  parameters: { type: 'object', properties: { comment: { type: 'string' }, homeOffice: { type: 'boolean', description: 'Working from home today (only when the user says so)' } } },
  async run(args, ctx) {
    const res = await ctx.get(WorkTimeController).checkIn(ctx.orgId, { comment: str(args.comment), homeOffice: args.homeOffice === true }, ctx.req) as { ok: boolean; error?: string; checkIn?: string };
    return { data: res.checkIn ? { ...res, checkIn: ctx.local(res.checkIn) } : res, action: res.ok ? 'Checked in.' : undefined };
  },
};

const workTimeCheckOut: AssistantTool = {
  name: 'work_time_check_out',
  object: 'nav.workTime',
  description: 'WORKING TIME: check the user out now (closes the open session).',
  parameters: { type: 'object', properties: { confirmLongSession: { type: 'boolean', description: 'Only after the user confirmed a session over 16 hours is right.' } } },
  async run(args, ctx) {
    const res = await ctx.get(WorkTimeController).checkOut({ acknowledgeLongSession: args.confirmLongSession === true }, ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Checked out.' : undefined };
  },
};

const workTimeDelete: AssistantTool = {
  name: 'work_time_delete',
  object: 'nav.workTime',
  description: 'WORKING TIME: delete one session by its id (from work_time_list). Only when the user asked to delete that session.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(WorkTimeController).remove(String(args.id ?? ''), ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Working time: one session deleted.' : undefined };
  },
};

// ---- Project time ----

const projectsList: AssistantTool = {
  name: 'projects_list',
  object: 'nav.time',
  description: 'The projects the user may book project time on (names to use in project_time_add).',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const rows = await ctx.get(ProjectsController).list(ctx.orgId, ctx.req) as { name: string; bookable: boolean; owner_name: string | null }[];
    return { data: { projects: rows.filter((p) => p.bookable).map((p) => ({ name: p.name, owner: p.owner_name })) } };
  },
};

const projectTimeList: AssistantTool = {
  name: 'project_time_list',
  object: 'nav.time',
  description: 'PROJECT TIME (hours booked on projects, Projektzeit): list the entries in a period with project and total. Not working time.',
  parameters: { type: 'object', properties: { ...dateRange, ...person } },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const range = instantRange(args, ctx);
    if ('error' in range) return { data: range };
    const res = await ctx.get(ProjectTimeController).list(ctx.orgId, ctx.req, who.id, range.from, range.to);
    const rows = (res.entries as { id: string; start_time: string; end_time: string; comment: string | null; project_name: string | null }[])
      .map((r) => ({ id: r.id, start: r.start_time, end: r.end_time, comment: r.comment, project: r.project_name }));
    return { data: { person: who.name ?? 'you', from: range.fromDay, to: range.toDay, ...entryList(rows, ctx) } };
  },
};

const projectTimeAdd: AssistantTool = {
  name: 'project_time_add',
  object: 'nav.time',
  description:
    'PROJECT TIME: book hours on projects (as on the Project time page). Separate from working time: it does not count as attendance. ' +
    "A day's project time should not exceed that day's working time, so when the user wants both, call work_time_add first. " +
    'An answer "project-exceeds-attendance-confirm" or "overlapping-entry-confirm" is a warning: tell the user and only resend with confirmWarnings after they agree.',
  parameters: {
    type: 'object',
    properties: {
      entries: entriesParam({ project: { type: 'string', description: 'Project name (projects_list); leave out for time without a project' } }),
      ...person,
      confirmWarnings: { type: 'boolean', description: 'Only after the user agreed to save despite the warning.' },
    },
    required: ['entries'],
  },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const entries = Array.isArray(args.entries) ? (args.entries as Args[]).slice(0, 31) : [];
    if (entries.length === 0) return { data: { error: 'no entries' } };
    const controller = ctx.get(ProjectTimeController);
    const results = [];
    let created = 0;
    for (const e of entries) {
      const s = span(e, ctx);
      if ('error' in s) { results.push({ date: e.date, ok: false, error: s.error }); continue; }
      let projectId: string | undefined;
      if (str(e.project)) {
        const p = await ctx.findProject(e.project);
        if ('error' in p) { results.push({ date: e.date, ok: false, error: p.error }); continue; }
        projectId = p.id;
      }
      const res = await controller.create(ctx.orgId, {
        projectId, startTime: s.start, endTime: s.end, comment: str(e.comment), userId: who.id,
        acknowledgeOverlap: args.confirmWarnings === true, acknowledgeAttendance: args.confirmWarnings === true,
      }, ctx.req) as { ok: boolean; error?: string; id?: string; projectMinutes?: number; attendanceMinutes?: number };
      if (res.ok) created += 1;
      results.push({
        date: e.date, startTime: e.startTime, endTime: e.endTime, project: e.project ?? null, ok: res.ok,
        ...(res.error ? { error: res.error } : { id: res.id }),
        ...(res.error === 'project-exceeds-attendance-confirm' ? { projectMinutesThatDay: res.projectMinutes, workingMinutesThatDay: res.attendanceMinutes } : {}),
      });
    }
    return { data: { results }, action: created ? `Project time: ${created} of ${entries.length} booked${who.name ? ` for ${who.name}` : ''}.` : undefined };
  },
};

const projectTimeDelete: AssistantTool = {
  name: 'project_time_delete',
  object: 'nav.time',
  description: 'PROJECT TIME: delete one entry by its id (from project_time_list). Only when the user asked to delete that entry.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(ProjectTimeController).remove(String(args.id ?? ''), ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Project time: one entry deleted.' : undefined };
  },
};

const teamHours: AssistantTool = {
  name: 'team_hours',
  object: 'nav.teamHours',
  description: "PROJECT TIME per member of a team, by the team's name, in a period. Only the members the user may see.",
  parameters: { type: 'object', properties: { teamName: { type: 'string' }, ...dateRange }, required: ['teamName'] },
  async run(args, ctx) {
    const { db } = ctx;
    if (!(await can(db, ctx.orgId, ctx.callerId, 'nav.teamHours', 'see'))) return { data: { error: 'forbidden' } };
    const teamName = str(args.teamName) ?? '';
    const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.organization_id, ctx.orgId), ilike(teams.name, teamName)));
    if (!team) return { data: { error: `unknown team "${teamName}"` } };
    const range = instantRange(args, ctx);
    if ('error' in range) return { data: range };
    const teamMembers = await db
      .select({ user_id: organization_memberships.user_id, name: users.display_name })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(team_members.team_id, team.id));
    // Same filter as the Team hours page: only members the caller may see.
    const visible = await listableUserIds(db, ctx.orgId, ctx.callerId, 'nav.teamHours');
    const members = visible === 'all' ? teamMembers : teamMembers.filter((m) => visible.includes(m.user_id));
    const rows = members.length
      ? await db.select({ user_id: project_times.user_id, start: project_times.start_time, end: project_times.end_time })
          .from(project_times)
          .where(and(eq(project_times.organization_id, ctx.orgId), inArray(project_times.user_id, members.map((m) => m.user_id))))
      : [];
    const inRange = rows.filter((r) => r.start >= range.from && r.start < range.to);
    return {
      data: {
        team: team.name, from: range.fromDay, to: range.toDay,
        members: members.map((m) => ({ name: m.name, hours: hours(inRange.filter((r) => r.user_id === m.user_id).reduce((n, r) => n + minutesBetween(r.start, r.end), 0)) })),
      },
    };
  },
};

// ---- Absences and balances ----

const absencesList: AssistantTool = {
  name: 'absences_list',
  object: 'nav.absences',
  description: 'ABSENCES (vacation, sickness, ...): the user\'s own, or a colleague\'s they may see; optionally by status and period.',
  parameters: {
    type: 'object',
    properties: { ...dateRange, ...person, status: { type: 'string', enum: ['pending', 'approved', 'rejected'] } },
  },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const rows = await ctx.get(AbsencesController).list(ctx.orgId, ctx.req, who.id, str(args.status)) as {
      id: string; date_start: string; date_end: string; status: string; absence_type: string; half_day: boolean; note: string | null; review_note: string | null;
    }[];
    const from = isIsoDay(args.from) ? args.from : null;
    const to = isIsoDay(args.to) ? args.to : null;
    const absences = rows
      .filter((r) => (!from || r.date_end >= from) && (!to || r.date_start <= to))
      .slice(0, 60)
      .map((r) => ({ id: r.id, from: r.date_start, to: r.date_end, type: r.absence_type, halfDay: r.half_day, status: r.status, note: r.note, reviewNote: r.review_note }));
    return { data: { person: who.name ?? 'you', absences } };
  },
};

const absencesTypes: AssistantTool = {
  name: 'absences_types',
  object: 'nav.absences',
  description: 'The absence types of this organization (keys for absences_request) and whether each needs the manager\'s approval.',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const types = await resolveAbsenceTypes(ctx.db, ctx.orgId);
    return { data: { types: Object.entries(types).map(([key, v]) => ({ key, needsApproval: (v as { approval?: boolean } | null)?.approval !== false })) } };
  },
};

const absencesRequest: AssistantTool = {
  name: 'absences_request',
  object: 'nav.absences',
  description:
    'ABSENCES: request (or report) an absence for the user, from one day to another inclusive; it goes to their manager for approval unless the type needs none. ' +
    'type is a key from absences_types (vacation when the user says holiday/Ferien/Urlaub, sickness for sick/krank).',
  parameters: {
    type: 'object',
    properties: {
      dateStart: { type: 'string', description: 'YYYY-MM-DD' },
      dateEnd: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      type: { type: 'string' },
      halfDay: { type: 'boolean', description: 'Half a day (only for a single day)' },
      note: { type: 'string' },
    },
    required: ['dateStart', 'dateEnd', 'type'],
  },
  async run(args, ctx) {
    const res = await ctx.get(AbsencesController).submit(ctx.orgId, {
      dateStart: String(args.dateStart ?? ''), dateEnd: String(args.dateEnd ?? ''), absenceType: str(args.type), halfDay: args.halfDay === true, note: str(args.note),
    }, ctx.req) as { ok: boolean; error?: string; autoApproved?: boolean };
    const what = res.autoApproved ? 'recorded' : 'sent for approval';
    return { data: res, action: res.ok ? `Absence ${args.dateStart}${args.dateEnd !== args.dateStart ? ` – ${args.dateEnd}` : ''} (${args.type}) ${what}.` : undefined };
  },
};

const absencesCancel: AssistantTool = {
  name: 'absences_cancel',
  object: 'nav.absences',
  description: "ABSENCES: withdraw one of the user's own still pending requests, by id (absences_list). Only when the user asked to.",
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(AbsencesController).cancel(String(args.id ?? ''), ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Absence request withdrawn.' : undefined };
  },
};

const balancesGet: AssistantTool = {
  name: 'balances_get',
  description: 'BALANCES this year: overtime (hours, from working time) and vacation days left, of the user or a colleague they may see.',
  parameters: { type: 'object', properties: { ...person } },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const res = await ctx.get(BalancesController).get(ctx.orgId, ctx.req, who.id);
    if (!res) return { data: { error: 'forbidden' } };
    return {
      data: {
        person: who.name ?? 'you',
        overtimeHours: hours(res.overtimeMinutes), overtimeHoursOfOpenMonths: hours(res.pendingOvertimeMinutes),
        vacationDaysLeft: res.vacationDays, vacationDaysPlanned: res.vacationPlannedDays,
      },
    };
  },
};

// ---- Approvals ----

const approvalsList: AssistantTool = {
  name: 'approvals_list',
  object: 'nav.approvals',
  description: 'APPROVALS waiting for the user (absence requests, timesheets, project months, expense reports, ...).',
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const rows = await ctx.get(WorkflowsController).assignedToMe(ctx.req) as Record<string, unknown>[];
    const skip = new Set(['id', 'source_table', 'source_table_uuid', 'step', 'step_status', 'workflow_data', 'started', 'definition_name', 'source', 'source_name']);
    const items = rows.slice(0, 40).map((r) => {
      const record = Object.entries(r).find(([k, v]) => !skip.has(k) && v && typeof v === 'object');
      const detail = record ? Object.fromEntries(Object.entries(record[1] as Record<string, unknown>).filter(([k]) => !/(^|_)id$|email/.test(k))) : null;
      return { id: r.id, kind: r.definition_name, what: r.source, since: r.started, detail, note: (r.workflow_data as { note?: unknown } | null)?.note ?? null };
    });
    return { data: { count: rows.length, items } };
  },
};

const approvalsDecide: AssistantTool = {
  name: 'approvals_decide',
  object: 'nav.approvals',
  description: 'APPROVALS: approve or reject one item by its id from approvals_list (call that first). Only after the user named that item and said approve or reject.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } },
    required: ['id', 'decision'],
  },
  async run(args, ctx) {
    const controller = ctx.get(WorkflowsController);
    // Only an item waiting for the caller, by its id or its record's (the model sometimes passes the absence's).
    const waiting = await controller.assignedToMe(ctx.req) as { id: string; source_table_uuid: string }[];
    const given = String(args.id ?? '');
    const item = waiting.find((w) => w.id === given) ?? waiting.find((w) => w.source_table_uuid === given);
    if (!item) return { data: { error: 'not among the items waiting for the user: call approvals_list and use an id from it' } };
    const id = item.id;
    const body = { note: str(args.note) };
    const res = (args.decision === 'reject' ? await controller.reject(id, body, ctx.req) : await controller.approve(id, body, ctx.req)) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? (args.decision === 'reject' ? 'Rejected one approval.' : 'Approved one approval.') : undefined };
  },
};

// ---- Requests ----

const requestsList: AssistantTool = {
  name: 'requests_list',
  object: 'nav.requests',
  description: "REQUESTS (tickets to the manager or a department): box 'mine' = the user's own, 'inbox' = the ones they handle, 'archived'.",
  parameters: { type: 'object', properties: { box: { type: 'string', enum: ['mine', 'inbox', 'archived'] } } },
  async run(args, ctx) {
    const res = await ctx.get(RequestsController).list(ctx.orgId, str(args.box), ctx.req) as { requests: Record<string, unknown>[] };
    // Confidential requests stay out of the assistant (they would go to the model).
    const requests = res.requests.filter((r) => r.confidential !== true).slice(0, 40).map((r) => ({
      id: r.id, subject: r.subject, status: r.status, type: r.request_type, urgent: r.urgent, to: r.target_kind === 'manager' ? 'manager' : r.department_name,
      from: r.requester_name, takenBy: r.assignee_name, lastActivity: r.last_activity_at, messages: r.message_count,
    }));
    return { data: { requests } };
  },
};

const requestsGet: AssistantTool = {
  name: 'requests_get',
  object: 'nav.requests',
  description: 'REQUESTS: one request with its messages, by id (requests_list).',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(RequestsController).get(ctx.orgId, String(args.id ?? ''), ctx.req) as {
      ok: boolean; error?: string; request?: Record<string, unknown>; messages?: Record<string, unknown>[];
    };
    if (!res.ok) return { data: res };
    if (res.request?.confidential === true) return { data: { ok: false, error: 'request-confidential' } };
    return {
      data: {
        request: { subject: res.request?.subject, status: res.request?.status, type: res.request?.request_type, from: res.request?.requester_name, link: res.request?.link_url },
        messages: (res.messages ?? []).slice(-30).map((m) => ({ kind: m.kind, author: m.author_name, at: m.posted_at, text: m.body, event: m.kind === 'event' ? m.data : undefined })),
      },
    };
  },
};

const requestsCreate: AssistantTool = {
  name: 'requests_create',
  object: 'nav.requests',
  description: "REQUESTS: send a new request to the user's manager or to a department. type is one of the organization's request types (e.g. service, support, other).",
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', enum: ['manager', 'department'] },
      department: { type: 'string', description: 'Department name, when to = department' },
      subject: { type: 'string' },
      message: { type: 'string' },
      type: { type: 'string' },
      urgent: { type: 'boolean' },
      link: { type: 'string', description: 'An optional http(s) link' },
    },
    required: ['to', 'subject', 'message'],
  },
  async run(args, ctx) {
    const controller = ctx.get(RequestsController);
    let departmentId: string | undefined;
    if (args.to === 'department') {
      const targets = await controller.targets(ctx.orgId, ctx.req) as { departments: { id: string; name: string }[] };
      const name = (str(args.department) ?? '').toLowerCase();
      const matches = targets.departments.filter((d) => d.name.toLowerCase().includes(name));
      const exact = matches.find((d) => d.name.toLowerCase() === name);
      if (!exact && matches.length !== 1) {
        return { data: { error: matches.length ? 'several departments match' : 'unknown department', departments: targets.departments.map((d) => d.name) } };
      }
      departmentId = (exact ?? matches[0]).id;
    }
    const res = await controller.create(ctx.orgId, {
      target: String(args.to ?? ''), departmentId, subject: str(args.subject), message: str(args.message), type: str(args.type) ?? 'other',
      urgent: args.urgent === true, link: str(args.link),
    }, [], ctx.req) as { ok: boolean; error?: string; id?: string };
    return { data: res, action: res.ok ? `Request "${args.subject}" sent.` : undefined };
  },
};

const requestsReply: AssistantTool = {
  name: 'requests_reply',
  object: 'nav.requests',
  description: 'REQUESTS: add a message to a request, by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, message: { type: 'string' } }, required: ['id', 'message'] },
  async run(args, ctx) {
    const res = await ctx.get(RequestsController).reply(ctx.orgId, String(args.id ?? ''), { body: str(args.message) }, [], ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Replied to a request.' : undefined };
  },
};

const requestsStatus: AssistantTool = {
  name: 'requests_set_status',
  object: 'nav.requests',
  description: 'REQUESTS: set the status of a request (open, in_progress, resolved), by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: [...REQUEST_STATUSES] } }, required: ['id', 'status'] },
  async run(args, ctx) {
    const res = await ctx.get(RequestsController).setStatus(ctx.orgId, String(args.id ?? ''), { status: str(args.status) }, ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? `Request set to ${args.status}.` : undefined };
  },
};

export const CORE_ASSISTANT_TOOLS: AssistantTool[] = [
  workTimeList, workTimeAdd, workTimeCheckIn, workTimeCheckOut, workTimeDelete,
  projectsList, projectTimeList, projectTimeAdd, projectTimeDelete, teamHours,
  absencesList, absencesTypes, absencesRequest, absencesCancel, balancesGet,
  approvalsList, approvalsDecide,
  requestsList, requestsGet, requestsCreate, requestsReply, requestsStatus,
];

/** Registers the core's tools (AssistantService does at start). */
export function registerCoreAssistantTools(): void {
  for (const tool of CORE_ASSISTANT_TOOLS) registerAssistantTool(tool);
}

export type { AssistantToolResult };
