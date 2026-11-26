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
import { FlowsController, REQUEST_STATUSES } from './flows.controller';
import { WorkTimeController } from './work-time.controller';
import { WorkflowsController } from './workflows.controller';
import { TimesheetsController } from './timesheets.controller';
import { ProjectTimesheetsController } from './project-timesheets.controller';
import { TeamOverviewController } from './team-overview.controller';
import { DirectoryController } from './directory.controller';

/**
 * The core's assistant tools (assistant-tools.ts): working time, project time, absences, balances,
 * approvals and requests, the monthly report and the project timesheet, the team calendar and the directory.
 * Each calls the page's controller method as the caller.
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
  object: 'nav.time',
  description: "PROJECT TIME per member of a team, by the team's name, in a period. Only the members the user may see.",
  parameters: { type: 'object', properties: { teamName: { type: 'string' }, ...dateRange }, required: ['teamName'] },
  async run(args, ctx) {
    const { db } = ctx;
    if (!(await can(db, ctx.orgId, ctx.callerId, 'nav.time', 'see'))) return { data: { error: 'forbidden' } };
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
    // Only the members whose project time the caller may see (as the project time report).
    const visible = await listableUserIds(db, ctx.orgId, ctx.callerId, 'nav.time');
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

// ---- Flows ----

const flowsList: AssistantTool = {
  name: 'flows_list',
  object: 'nav.flows',
  description: "FLOWS (Free Flows to the manager or a department, and flows of the organization's own types): box 'mine' = the user's own, 'inbox' = the ones they handle, 'archived'.",
  parameters: { type: 'object', properties: { box: { type: 'string', enum: ['mine', 'inbox', 'archived'] } } },
  async run(args, ctx) {
    const res = await ctx.get(FlowsController).list(ctx.orgId, str(args.box), ctx.req) as { flows: Record<string, unknown>[] };
    // Confidential flows stay out of the assistant (they would go to the model).
    const flows = res.flows.filter((r) => r.confidential !== true).slice(0, 40).map((r) => ({
      id: r.id, subject: r.subject, status: r.status, type: r.flow_type, urgent: r.urgent, to: r.target_kind === 'manager' ? 'manager' : r.department_name,
      from: r.requester_name, takenBy: r.assignee_name, lastActivity: r.last_activity_at, messages: r.message_count,
    }));
    return { data: { flows } };
  },
};

const flowsGet: AssistantTool = {
  name: 'flows_get',
  object: 'nav.flows',
  description: 'FLOWS: one flow with its messages, by id (flows_list).',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(FlowsController).get(ctx.orgId, String(args.id ?? ''), ctx.req) as {
      ok: boolean; error?: string; flow?: Record<string, unknown>; messages?: Record<string, unknown>[];
    };
    if (!res.ok) return { data: res };
    if (res.flow?.confidential === true) return { data: { ok: false, error: 'flow-confidential' } };
    return {
      data: {
        flow: { subject: res.flow?.subject, status: res.flow?.status, type: res.flow?.flow_type, from: res.flow?.requester_name, link: res.flow?.link_url },
        messages: (res.messages ?? []).slice(-30).map((m) => ({ kind: m.kind, author: m.author_name, at: m.posted_at, text: m.body, event: m.kind === 'event' ? m.data : undefined })),
      },
    };
  },
};

const flowsCreate: AssistantTool = {
  name: 'flows_create',
  object: 'nav.flows',
  description: "FLOWS: start a new Free Flow to the user's manager or to a department. type is one of the organization's flow types (e.g. service, support, other).",
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
    const controller = ctx.get(FlowsController);
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
    return { data: res, action: res.ok ? `Flow "${args.subject}" started.` : undefined };
  },
};

const flowsReply: AssistantTool = {
  name: 'flows_reply',
  object: 'nav.flows',
  description: 'FLOWS: add a message to a flow, by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, message: { type: 'string' } }, required: ['id', 'message'] },
  async run(args, ctx) {
    const res = await ctx.get(FlowsController).reply(ctx.orgId, String(args.id ?? ''), { body: str(args.message) }, [], ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Replied to a flow.' : undefined };
  },
};

const flowsStatus: AssistantTool = {
  name: 'flows_set_status',
  object: 'nav.flows',
  description: 'FLOWS: set the status of a flow (open, in_progress, resolved), by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: [...REQUEST_STATUSES] } }, required: ['id', 'status'] },
  async run(args, ctx) {
    const res = await ctx.get(FlowsController).setStatus(ctx.orgId, String(args.id ?? ''), { status: str(args.status) }, ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? `Flow set to ${args.status}.` : undefined };
  },
};

// ---- Monthly report (working time) and project timesheet ----

const monthArg = { month: { type: 'string', description: 'YYYY-MM (default: last month)' } };
/** The month asked for, else the one before today's (the month people usually submit). */
function monthOf(args: Args, ctx: AssistantToolContext): string | { error: string } {
  if (args.month !== undefined) return typeof args.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.month) ? args.month : { error: 'month must be YYYY-MM' };
  const [y, m] = ctx.today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const timesheetStatus: AssistantTool = {
  name: 'timesheet_status',
  object: 'nav.timesheet',
  description: "MONTHLY REPORT (working time, Monatsrapport): whether the user's month (or a colleague's they may see) is open, submitted, approved or rejected; without a month, the last months.",
  parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (optional)' }, ...person } },
  async run(args, ctx) {
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const rows = await ctx.get(TimesheetsController).list(ctx.orgId, ctx.req, who.id === ctx.callerId ? undefined : who.id) as {
      user_id: string; period_start: string; status: string; submitted_at: string | null; reviewed_at: string | null; review_note: string | null;
    }[];
    const own = rows.filter((r) => r.user_id === who.id);
    const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : null;
    const periods = (month ? own.filter((r) => r.period_start.startsWith(month)) : own.slice(0, 6))
      .map((r) => ({ month: r.period_start.slice(0, 7), status: r.status, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at, reviewNote: r.review_note }));
    return { data: { person: who.name ?? 'you', periods, ...(month && periods.length === 0 ? { note: 'not submitted yet (open)' } : {}) } };
  },
};

const timesheetSubmit: AssistantTool = {
  name: 'timesheet_submit',
  object: 'nav.timesheet',
  description: "MONTHLY REPORT: submit the user's own working-time month to their manager (it then closes the month's balance when approved). Only the user's own; ask before submitting.",
  parameters: { type: 'object', properties: { ...monthArg, note: { type: 'string' } } },
  async run(args, ctx) {
    const month = monthOf(args, ctx);
    if (typeof month !== 'string') return { data: month };
    const res = await ctx.get(TimesheetsController).submit(ctx.orgId, { periodStart: `${month}-01`, note: str(args.note) }, ctx.req) as { ok: boolean; error?: string; autoApproved?: boolean };
    return { data: res, action: res.ok ? `Monthly report ${month} submitted.` : undefined };
  },
};

const projectTimesheetStatus: AssistantTool = {
  name: 'project_timesheet_status',
  object: 'nav.time',
  description: "PROJECT TIMESHEET (project time per project and month, Projektrapport): the user's (or a colleague's) hours per project in a month and each project month's status (open, submitted, approved, rejected).",
  parameters: { type: 'object', properties: { ...monthArg, ...person } },
  async run(args, ctx) {
    const month = monthOf(args, ctx);
    if (typeof month !== 'string') return { data: month };
    const who = await target(args, ctx);
    if ('error' in who) return { data: who };
    const res = await ctx.get(ProjectTimesheetsController).month(ctx.orgId, ctx.req, month, who.id === ctx.callerId ? undefined : who.id) as {
      ok: boolean; error?: string; projects?: { project_name: string | null; owner_name: string | null; minutes: number; period: { status: string; review_note: string | null } | null }[];
      unassigned?: { minutes: number; entries: number };
    };
    if (!res.ok) return { data: res };
    return {
      data: {
        person: who.name ?? 'you', month,
        projects: (res.projects ?? []).map((p) => ({ project: p.project_name, owner: p.owner_name, hours: hours(Number(p.minutes)), status: p.period?.status ?? 'open', reviewNote: p.period?.review_note ?? null })),
        withoutProject: res.unassigned && res.unassigned.entries > 0 ? { hours: hours(res.unassigned.minutes), entries: res.unassigned.entries } : null,
      },
    };
  },
};

const projectTimesheetSubmit: AssistantTool = {
  name: 'project_timesheet_submit',
  object: 'nav.time',
  description: "PROJECT TIMESHEET: submit the user's own project time of a month, each project to its owner (hours without a project block it). Only the user's own; ask before submitting.",
  parameters: { type: 'object', properties: { ...monthArg, note: { type: 'string' } } },
  async run(args, ctx) {
    const month = monthOf(args, ctx);
    if (typeof month !== 'string') return { data: month };
    const res = await ctx.get(ProjectTimesheetsController).submit(ctx.orgId, { periodStart: `${month}-01`, note: str(args.note) }, ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? `Project timesheet ${month} submitted.` : undefined };
  },
};

// ---- Team calendar and directory ----

const calendarAbsences: AssistantTool = {
  name: 'calendar_absences',
  object: 'nav.calendar',
  description: 'TEAM CALENDAR: who of the people the user may see (their reporting line, or everyone for HR) is absent on which days of a period, with the type, as the Calendar page shows it.',
  parameters: { type: 'object', properties: { ...dateRange } },
  async run(args, ctx) {
    const fromDay = isIsoDay(args.from) ? args.from : ctx.today;
    const toDay = isIsoDay(args.to) ? args.to : fromDay;
    if (toDay < fromDay) return { data: { error: '"to" is before "from"' } };
    const names = new Map<string, string>();
    const absences: { person: string; from: string; to: string; type: string; halfDay: boolean; status: string }[] = [];
    const seen = new Set<string>();
    // One month at a time, as the page loads it.
    for (let m = fromDay.slice(0, 7); m <= toDay.slice(0, 7); m = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7)) {
      const res = await ctx.get(TeamOverviewController).overview(ctx.orgId, ctx.req, 'absences', m) as {
        ok: boolean; error?: string; people?: { id: string; name: string | null; email: string }[];
        absences?: { id: string; user_id: string; date_start: string; date_end: string; status: string; absence_type: string; half_day: boolean }[];
      };
      if (!res.ok) return { data: res };
      for (const p of res.people ?? []) names.set(p.id, p.name ?? p.email);
      for (const a of res.absences ?? []) {
        // An absence over a month's end comes with both months: once.
        if (a.status === 'rejected' || a.date_end < fromDay || a.date_start > toDay || seen.has(a.id)) continue;
        seen.add(a.id);
        absences.push({ person: names.get(a.user_id) ?? '?', from: a.date_start, to: a.date_end, type: a.absence_type, halfDay: a.half_day, status: a.status });
      }
    }
    if (names.size === 0) return { data: { note: 'The user sees nobody else in the calendar (no reporting line); their own absences: absences_list.' } };
    return { data: { from: fromDay, to: toDay, absences } };
  },
};

const directoryFind: AssistantTool = {
  name: 'directory_find',
  object: 'nav.directory',
  description: "DIRECTORY: colleagues by name, department, function or location, with e-mail, phone, function, department, manager and whether they are checked in or absent today (never why). For 'how do I reach X', 'who leads Y'.",
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for (name, department, function, location); empty = everyone' } } },
  async run(args, ctx) {
    const res = await ctx.get(DirectoryController).list(ctx.orgId, ctx.req) as {
      ok: boolean; error?: string; people?: { name: string; email: string; phone: string | null; position: string | null; department: string | null; location: string | null; managerName: string | null; status: string; absentUntil: string | null }[];
    };
    if (!res.ok) return { data: res };
    const words = (str(args.query) ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const found = (res.people ?? []).filter((p) => words.every((w) => [p.name, p.email, p.position, p.department, p.location].some((v) => (v ?? '').toLowerCase().includes(w))));
    return {
      data: {
        count: found.length,
        people: found.slice(0, 25).map((p) => ({
          name: p.name, email: p.email, phone: p.phone, function: p.position, department: p.department, location: p.location, manager: p.managerName,
          today: p.status === 'absent' ? `absent until ${p.absentUntil}` : p.status === 'checkedIn' ? 'checked in' : null,
        })),
      },
    };
  },
};

export const CORE_ASSISTANT_TOOLS: AssistantTool[] = [
  workTimeList, workTimeAdd, workTimeCheckIn, workTimeCheckOut, workTimeDelete,
  projectsList, projectTimeList, projectTimeAdd, projectTimeDelete, teamHours,
  absencesList, absencesTypes, absencesRequest, absencesCancel, balancesGet,
  approvalsList, approvalsDecide,
  flowsList, flowsGet, flowsCreate, flowsReply, flowsStatus,
  timesheetStatus, timesheetSubmit, projectTimesheetStatus, projectTimesheetSubmit,
  calendarAbsences, directoryFind,
];

/** Registers the core's tools (AssistantService does at start). */
export function registerCoreAssistantTools(): void {
  for (const tool of CORE_ASSISTANT_TOOLS) registerAssistantTool(tool);
}

export type { AssistantToolResult };
