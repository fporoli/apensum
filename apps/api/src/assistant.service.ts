import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { azureOpenAiClient, azureOpenAiConfig, chatErrorCode, retryStaleConnection } from './ai-client';
import { AiBudgetService, ASSISTANT_KIND, azureOpenAiAvailable, azurePrices, chatChf, estimateChatChf } from './ai-budget.service';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { VersionsService } from './versions.service';
import { WorkTimeModelService } from './work-time-model.service';
import { can, isOrgMember, isProjectPeriodLocked, listableUserIds, projectBookingError } from './access';
import { project_times, projects, teams, team_members, organization_memberships, users } from './db/schema';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolContext {
  db: Db;
  callerId: string;
  orgId: string;
}

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_time_entries',
      description: "List the caller's own booked project-time entries in a date range.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO date, inclusive, e.g. 2026-09-01' },
          to: { type: 'string', description: 'ISO date, exclusive, e.g. 2026-10-01' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_time_entries',
      description:
        'Batch-create project-time entries for the caller. Each entry needs a date, start and end time (HH:MM, 24h), and optionally a project name and comment. Returns per-entry success/failure — a locked (submitted/approved) month will fail for that entry.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'ISO date, e.g. 2026-09-15' },
                startTime: { type: 'string', description: '24h HH:MM, e.g. 09:00' },
                endTime: { type: 'string', description: '24h HH:MM, e.g. 17:30' },
                projectName: { type: 'string' },
                comment: { type: 'string' },
              },
              required: ['date', 'startTime', 'endTime'],
            },
          },
        },
        required: ['entries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_hours',
      description: "Total booked hours per member of a team, by the team's name. Only the members the caller may see (e.g. a manager's own reports) are returned.",
      parameters: {
        type: 'object',
        properties: {
          teamName: { type: 'string' },
          from: { type: 'string', description: 'ISO date, inclusive' },
          to: { type: 'string', description: 'ISO date, exclusive' },
        },
        required: ['teamName'],
      },
    },
  },
];

/** Model rounds per question (each may call tools), and the answer tokens per round. */
export const ASSISTANT_ROUNDS = 5;
export const ASSISTANT_MAX_TOKENS = 1000;

/**
 * The assistant: Azure OpenAI in Switzerland only, like every AI call of the app. One question is one
 * budget reservation (AiBudgetService: the instance's and the organization's monthly CHF; its own lane of
 * one running question per user and ASSISTANT_CALLS_PER_HOUR), estimated for all its rounds and settled with the tokens actually used.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Assistant');

  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly workTime: WorkTimeModelService,
    private readonly budget: AiBudgetService,
  ) {}

  isConfigured(): boolean {
    return azureOpenAiAvailable();
  }

  async chat(
    callerId: string,
    orgId: string,
    role: string,
    history: AssistantMessage[],
  ): Promise<{ reply: string; actions: string[] }> {
    const config = azureOpenAiConfig();
    const prices = azurePrices();
    const db = this.db.getDb();
    if (!db) return { reply: '', actions: [] };
    if (!this.isConfigured() || !config || !prices) throw new ServiceUnavailableException('assistant-not-configured');

    const today = new Date().toISOString().slice(0, 10);
    const sanitizedHistory = history
      .slice(-20)
      .map((m): ChatCompletionMessageParam => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '',
      }));

    const convo: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          `You are the Apensum assistant. Today's date is ${today}. The caller's role in this organization is "${role}". ` +
          'You can look up and create the caller\'s own time entries, and pull team-hours reports covering only the people the caller may see. ' +
          'Every tool call is independently authorization-checked server-side regardless of the caller\'s stated role, so a request outside their permission will come back as an error — explain that plainly rather than guessing around it. ' +
          'When creating entries, always report back exactly which ones succeeded or failed and why (e.g. a locked month). Keep replies concise.',
      },
      ...sanitizedHistory,
    ];

    const ctx: ToolContext = { db, callerId, orgId };
    const actions: string[] = [];

    const inputChars = convo.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0) + JSON.stringify(TOOLS).length;
    const orgLimitChf = await this.budget.orgMonthlyLimitChf(orgId);
    const usageId = await this.budget.reserve({
      orgId, userId: callerId, kind: ASSISTANT_KIND, provider: 'azure-openai',
      estimateChf: estimateChatChf(inputChars, ASSISTANT_MAX_TOKENS, prices) * ASSISTANT_ROUNDS, orgLimitChf,
    });
    const context = { orgId, orgLimitChf };
    const client = azureOpenAiClient(config);
    let inputTokens = 0;
    let outputTokens = 0;
    let settled = false;
    const settle = async (ok: boolean, error?: string, unknownCost = false) => {
      if (settled) return;
      settled = true;
      await this.budget.finish(usageId, {
        ok, error, inputTokens, outputTokens,
        actualChf: unknownCost ? null : chatChf(inputTokens, outputTokens, prices),
      }, context);
    };

    try {
      return await this.rounds(client, config.deployment, convo, ctx, actions, (u) => {
        inputTokens += u?.prompt_tokens ?? 0;
        outputTokens += u?.completion_tokens ?? 0;
      }, settle);
    } finally {
      // A tool that threw (database) must not leave the reservation pending, which would block the user.
      await settle(false, 'assistant-request-failed');
    }
  }

  private async rounds(
    client: ReturnType<typeof azureOpenAiClient>, deployment: string, convo: ChatCompletionMessageParam[], ctx: ToolContext, actions: string[],
    count: (usage: { prompt_tokens: number; completion_tokens: number } | undefined) => void,
    settle: (ok: boolean, error?: string, unknownCost?: boolean) => Promise<void>,
  ): Promise<{ reply: string; actions: string[] }> {
    for (let round = 0; round < ASSISTANT_ROUNDS; round++) {
      let completion;
      try {
        completion = await retryStaleConnection(() => client.chat.completions.create({
          model: deployment, messages: convo, tools: TOOLS, max_completion_tokens: ASSISTANT_MAX_TOKENS,
        }));
      } catch (error) {
        const status = (error as { status?: number }).status;
        const code = chatErrorCode(status, 'assistant-request-failed');
        this.logger.warn(`Azure assistant call failed for org ${ctx.orgId}: ${error instanceof Error ? error.message : error}`);
        // No answer (timeout) may have been billed: the estimate keeps counting.
        await settle(false, code, status === undefined);
        throw new HttpException(code, 503);
      }
      count(completion.usage);
      const message = completion.choices[0]?.message;
      if (!message) break;
      convo.push(message);

      const calls = message.tool_calls?.filter((c): c is typeof c & { type: 'function' } => c.type === 'function');
      if (!calls || calls.length === 0) {
        await settle(true);
        return { reply: message.content ?? '', actions };
      }

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch { /* malformed args from the model; run with defaults */ }
        const result = await this.runTool(call.function.name, args, ctx);
        if (result.actionSummary) actions.push(result.actionSummary);
        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.data) });
      }
    }
    await settle(true);
    return { reply: "Sorry, that took too many steps — try asking in a simpler way.", actions };
  }

  private async runTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ data: unknown; actionSummary?: string }> {
    switch (name) {
      case 'get_my_time_entries':
        return { data: await this.getMyTimeEntries(ctx, args) };
      case 'create_time_entries':
        return this.createTimeEntries(ctx, args);
      case 'get_team_hours':
        return { data: await this.getTeamHours(ctx, args) };
      default:
        return { data: { error: `unknown-tool:${name}` } };
    }
  }

  private async getMyTimeEntries(ctx: ToolContext, args: Record<string, unknown>) {
    const conditions = [eq(project_times.organization_id, ctx.orgId), eq(project_times.user_id, ctx.callerId)];
    const rows = await ctx.db
      .select({
        id: project_times.id,
        start_time: project_times.start_time,
        end_time: project_times.end_time,
        comment: project_times.comment,
        project_name: projects.name,
      })
      .from(project_times)
      .leftJoin(projects, eq(projects.id, project_times.project_id))
      .where(and(...conditions))
      .orderBy(asc(project_times.start_time));
    const from = typeof args.from === 'string' ? args.from : undefined;
    const to = typeof args.to === 'string' ? args.to : undefined;
    return rows.filter((r) => (!from || r.start_time >= from) && (!to || r.start_time < to));
  }

  private async createTimeEntries(ctx: ToolContext, args: Record<string, unknown>) {
    if (!(await isOrgMember(ctx.db, ctx.orgId, ctx.callerId))) {
      return { data: { error: 'forbidden — you are not a member of this organization' } };
    }
    // Same right as booking one's own project time in the app (project-time.controller.ts).
    if (!(await can(ctx.db, ctx.orgId, ctx.callerId, 'nav.time', 'edit', ctx.callerId))) {
      return { data: { error: 'forbidden — you may not book project time' } };
    }
    const entries = Array.isArray(args.entries) ? (args.entries as Record<string, unknown>[]) : [];
    if (entries.length === 0) return { data: { error: 'no-entries-provided' } };

    const orgProjects = await ctx.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organization_id, ctx.orgId));

    const results: Array<{ date: unknown; ok: boolean; error?: string }> = [];
    let created = 0;
    for (const e of entries) {
      const date = typeof e.date === 'string' ? e.date : null;
      const startTime = typeof e.startTime === 'string' ? e.startTime : null;
      const endTime = typeof e.endTime === 'string' ? e.endTime : null;
      if (!date || !startTime || !endTime) {
        results.push({ date, ok: false, error: 'missing date/startTime/endTime' });
        continue;
      }
      const start = new Date(`${date}T${startTime}:00`).toISOString();
      const end = new Date(`${date}T${endTime}:00`).toISOString();
      if (!(new Date(end).getTime() > new Date(start).getTime())) {
        results.push({ date, ok: false, error: 'end must be after start' });
        continue;
      }
      const projectName = typeof e.projectName === 'string' ? e.projectName : undefined;
      const project = projectName
        ? orgProjects.find((p) => p.name.toLowerCase() === projectName.toLowerCase())
        : undefined;
      if (projectName && !project) {
        results.push({ date, ok: false, error: `unknown project "${projectName}"` });
        continue;
      }
      if (project && (await projectBookingError(ctx.db, ctx.orgId, ctx.callerId, project.id))) {
        results.push({ date, ok: false, error: `you may not book on "${project.name}": it is limited to teams you are not in` });
        continue;
      }
      if (await isProjectPeriodLocked(ctx.db, ctx.orgId, ctx.callerId, project?.id, start, end)) {
        results.push({ date, ok: false, error: "that project's month is locked (submitted/approved)" });
        continue;
      }
      // The REST endpoint warns and saves on confirmation; the assistant can't ask, so it skips
      // the entry and says why (the person can add it themselves after recording working time).
      const check = await this.workTime.checkProjectTime(ctx.db, ctx.orgId, ctx.callerId, start, end);
      if (!check.ok) {
        results.push({
          date,
          ok: false,
          error: `project time (${check.projectMinutes} min) would exceed the attendance recorded that day (${check.attendanceMinutes} min); record working time first`,
        });
        continue;
      }
      const values = {
        user_id: ctx.callerId,
        organization_id: ctx.orgId,
        project_id: project?.id ?? null,
        start_time: start,
        end_time: end,
        comment: typeof e.comment === 'string' ? e.comment : null,
      };
      const [row] = await ctx.db.insert(project_times).values(values).returning({ id: project_times.id });
      void this.versions.record('project_times', row.id, 'insert', ctx.callerId, { id: row.id, ...values }).catch(() => {});
      created += 1;
      results.push({ date, ok: true });
    }
    return {
      data: { results },
      actionSummary: created > 0 ? `Created ${created} of ${entries.length} time entries.` : undefined,
    };
  }

  private async getTeamHours(ctx: ToolContext, args: Record<string, unknown>) {
    if (!(await can(ctx.db, ctx.orgId, ctx.callerId, 'nav.teamHours', 'see'))) {
      return { error: 'forbidden — you may not see team hours' };
    }
    const teamName = typeof args.teamName === 'string' ? args.teamName : '';
    const [team] = await ctx.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organization_id, ctx.orgId), ilike(teams.name, teamName)));
    if (!team) return { error: `unknown team "${teamName}"` };

    const teamMembers = await ctx.db
      .select({ user_id: organization_memberships.user_id, display_name: users.display_name })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(team_members.team_id, team.id));
    // Same filter as the Team hours page (teams.controller.ts): only members the caller may see.
    const visible = await listableUserIds(ctx.db, ctx.orgId, ctx.callerId, 'nav.teamHours');
    const members = visible === 'all' ? teamMembers : teamMembers.filter((m) => visible.includes(m.user_id));
    if (members.length === 0) return { team: teamName, members: [] };

    const memberIds = members.map((m) => m.user_id);
    const from = typeof args.from === 'string' ? args.from : undefined;
    const to = typeof args.to === 'string' ? args.to : undefined;
    const conditions = [inArray(project_times.user_id, memberIds), eq(project_times.organization_id, ctx.orgId)];
    const entries = await ctx.db
      .select({ user_id: project_times.user_id, start_time: project_times.start_time, end_time: project_times.end_time })
      .from(project_times)
      .where(and(...conditions));
    const filtered = entries.filter((e) => (!from || e.start_time >= from) && (!to || e.start_time < to));

    return {
      team: teamName,
      members: members.map((m) => {
        const mins = filtered
          .filter((e) => e.user_id === m.user_id)
          .reduce((sum, e) => sum + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000, 0);
        return { displayName: m.display_name, totalHours: Math.round((mins / 60) * 100) / 100 };
      }),
    };
  }

}
