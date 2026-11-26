import { HttpException, Injectable, Logger, ServiceUnavailableException, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { azureOpenAiClient, azureOpenAiConfig, chatErrorCode, retryStaleConnection } from './ai-client';
import { AiBudgetService, ASSISTANT_KIND, azureOpenAiAvailable, azurePrices, chatChf, estimateChatChf } from './ai-budget.service';
import { DbService } from './db.service';
import { can } from './access';
import { users } from './db/schema';
import { registerCoreAssistantTools } from './assistant-core-tools';
import {
  assistantTools, assistantZone, findOrgMember, findOrgProject, toolPayload, zonedInstant, zonedLocal,
  type AssistantTool, type AssistantToolContext,
} from './assistant-tools';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Model rounds per question (each may call tools), and the answer tokens per round. */
export const ASSISTANT_ROUNDS = 6;
export const ASSISTANT_MAX_TOKENS = 1000;

/** The tools offered to a caller: those whose page they may see (a module switched off hides its tools). */
export async function offeredTools(
  tools: AssistantTool[], allowed: (object: string) => Promise<boolean>,
): Promise<AssistantTool[]> {
  const seen = new Map<string, boolean>();
  const out: AssistantTool[] = [];
  for (const tool of tools) {
    if (tool.object) {
      if (!seen.has(tool.object)) seen.set(tool.object, await allowed(tool.object));
      if (!seen.get(tool.object)) continue;
    }
    out.push(tool);
  }
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The system prompt: who and when, and the app's terms the model must keep apart. */
export function assistantSystemPrompt(input: { today: string; timeZone: string; role: string; name: string | null; tools: string[] }): string {
  const weekday = WEEKDAYS[new Date(`${input.today}T12:00:00Z`).getUTCDay()];
  const has = (prefix: string) => input.tools.some((t) => t.startsWith(prefix));
  const lines = [
    `You are the assistant of Apensum, a Swiss business app. Today is ${weekday} ${input.today}. Times are local wall-clock times in ${input.timeZone} (24h).`,
    `You talk to ${input.name ?? 'a user'}, whose role in this organization is "${input.role}". Answer in the user's language, briefly.`,
    'The app keeps these apart; never mix them up:',
    has('work_time') ? '- WORKING TIME (Arbeitszeit, Präsenz, attendance, check-in/check-out): when the person was at work. Overtime, balances and the monthly timesheet come from it. Tools work_time_*.' : '',
    has('project_time') ? '- PROJECT TIME (Projektzeit, hours on a project): what the hours were spent on. Recorded separately and does not count as attendance. Tools project_time_*, projects_list.' : '',
    has('project_time') && has('work_time')
      ? '  "Add 8-12 to my time and the same to project X" means BOTH: work_time_add, then project_time_add with the same slot. If the user only says "time", ask which one (or both) unless the context makes it clear.'
      : '',
    has('absences') ? '- ABSENCES (vacation, sickness, ...): requested days, approved by the manager. Tools absences_*.' : '',
    has('approvals') ? '- APPROVALS: items waiting for the user to approve or reject.' : '',
    has('flows') ? '- FLOWS: Free Flows to the manager or a department and flows of the organization\'s own types, with messages.' : '',
    has('expenses') ? '- EXPENSES: receipts and mileage; expense reports go to the manager.' : '',
    has('timesheet') ? '- MONTHLY REPORT (Monatsrapport): the month of WORKING TIME submitted to the manager; tools timesheet_*. The PROJECT TIMESHEET (Projektrapport) is the month of PROJECT TIME per project, submitted to each project\'s owner; tools project_timesheet_*. Submit only when the user asks.' : '',
    has('calendar') ? '- TEAM CALENDAR: who of the user\'s people is absent when (calendar_absences); the user\'s own absences are absences_list.' : '',
    has('directory') ? '- DIRECTORY: colleagues\' contact details, function, department and manager (directory_find).' : '',
    has('roster') ? '- SHIFT PLAN (Dienstplan): published shifts and wishes for a month (roster_*). A wish is a request to the planner, not a promise.' : '',
    has('billing') ? '- CUSTOMER INVOICES: open, overdue and paid invoices per customer (billing_*); invoices are made on the Invoicing page.' : '',
    has('hrplus') ? '- CERTIFICATES AND LOANS: the user\'s certificates with their validity and the items lent to them; for HR the certificates running out (hrplus_*).' : '',
    has('hr_') ? '- PERFORMANCE REVIEWS: the state of the user\'s review and what is open (hr_*).' : '',
    has('notes') ? '- NOTES: the user\'s own private notes in this organization (notes_*); nobody else sees them.' : '',
    'Work out dates yourself ("last Monday", "next week") from today and use them; say which dates you used.',
    'Every tool is checked on the server with the user\'s own rights: an error such as forbidden or period-locked (month already submitted or approved) is final, explain it plainly. ' +
      'Errors ending in -confirm are warnings: tell the user and resend with the confirm flag only after they agree.',
    'Deleting, withdrawing, approving or rejecting only when the user asked for that specific item. ' +
      'After changes, report exactly what was saved and what failed, with dates and times. Do not invent data: look it up.',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * The assistant: Azure OpenAI in Switzerland only, like every AI call of the app. One question is one
 * budget reservation (AiBudgetService: the instance's and the organization's monthly CHF; its own lane of
 * one running question per user and ASSISTANT_CALLS_PER_HOUR), estimated for all its rounds and settled
 * with the tokens actually used. The tools (assistant-tools.ts) call the pages' controllers as the caller.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('Assistant');

  constructor(
    private readonly db: DbService,
    private readonly budget: AiBudgetService,
    private readonly moduleRef: ModuleRef,
  ) {
    registerCoreAssistantTools();
  }

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

    const [me] = await db.select({ name: users.display_name, timezone: users.timezone }).from(users).where(eq(users.id, callerId));
    const timeZone = assistantZone(me?.timezone);
    const today = zonedLocal(new Date(), timeZone).date;
    const ctx: AssistantToolContext = {
      db, orgId, callerId, timeZone, today,
      req: { user: { kind: 'local', sub: callerId } },
      get: <T>(type: Type<T>) => this.moduleRef.get(type, { strict: false }),
      findPerson: (text) => findOrgMember(db, orgId, text),
      findProject: (text) => findOrgProject(db, orgId, text),
      instant: (date, time) => zonedInstant(date, time, timeZone),
      local: (instant) => zonedLocal(instant, timeZone),
    };

    const tools = await offeredTools(assistantTools(), (object) => can(db, orgId, callerId, object, 'see'));
    const toolDefs: ChatCompletionTool[] = tools.map((t) => ({
      type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const byName = new Map(tools.map((t) => [t.name, t]));

    const convo: ChatCompletionMessageParam[] = [
      { role: 'system', content: assistantSystemPrompt({ today, timeZone, role, name: me?.name ?? null, tools: tools.map((t) => t.name) }) },
      ...history.slice(-20).map((m): ChatCompletionMessageParam => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '',
      })),
    ];
    const actions: string[] = [];

    const inputChars = convo.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0) + JSON.stringify(toolDefs).length;
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
      for (let round = 0; round < ASSISTANT_ROUNDS; round++) {
        let completion;
        try {
          completion = await retryStaleConnection(() => client.chat.completions.create({
            model: config.deployment, messages: convo, tools: toolDefs.length ? toolDefs : undefined, max_completion_tokens: ASSISTANT_MAX_TOKENS,
          }));
        } catch (error) {
          const status = (error as { status?: number }).status;
          const code = chatErrorCode(status, 'assistant-request-failed');
          this.logger.warn(`Azure assistant call failed for org ${orgId}: ${error instanceof Error ? error.message : error}`);
          // No answer (timeout) may have been billed: the estimate keeps counting.
          await settle(false, code, status === undefined);
          throw new HttpException(code, 503);
        }
        inputTokens += completion.usage?.prompt_tokens ?? 0;
        outputTokens += completion.usage?.completion_tokens ?? 0;
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
            const parsed = JSON.parse(call.function.arguments || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
          } catch { /* malformed arguments: the tool reports what is missing */ }
          const tool = byName.get(call.function.name);
          let data: unknown;
          if (!tool) data = { error: `unknown tool ${call.function.name}` };
          else {
            try {
              const result = await tool.run(args, ctx);
              data = result.data;
              if (result.action) actions.push(result.action);
            } catch (error) {
              this.logger.warn(`Assistant tool ${tool.name} failed: ${error instanceof Error ? error.message : error}`);
              data = { error: 'tool-failed' };
            }
          }
          convo.push({ role: 'tool', tool_call_id: call.id, content: toolPayload(data) });
        }
      }
      await settle(true);
      return { reply: actions.length ? 'Done, see the list below. That needed many steps: ask again if something is missing.' : 'Sorry, that took too many steps. Try asking in a simpler way.', actions };
    } finally {
      // A failure on the way must not leave the reservation pending, which would block the user.
      await settle(false, 'assistant-request-failed');
    }
  }
}
