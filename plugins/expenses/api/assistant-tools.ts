import { sql } from 'drizzle-orm';
import type { AssistantTool, AssistantToolContext } from '@worktime3/api/plugin';
import { MILEAGE_CATEGORY } from '../shared/booking';
import { bookingContext } from './expense-booking';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpensesController } from './expenses.controller';

/**
 * The assistant's expense tools (ApiPlugin.assistantTools): each calls this plugin's controller as
 * the caller, so the endpoint's checks, validation and booking apply unchanged.
 */

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The org's expense categories (key -> label): its own row, else the global one. */
async function categories(ctx: AssistantToolContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db.execute(sql`
    SELECT "values" FROM static_data
    WHERE entity = 'expenses' AND enum_name = 'expense_category' AND (organization_id = ${ctx.orgId}::uuid OR organization_id IS NULL)
    ORDER BY organization_id NULLS LAST LIMIT 1`);
  return ((rows.rows[0] as { values?: Record<string, unknown> } | undefined)?.values) ?? {};
}

interface ExpenseRow {
  id: string; expense_date: string; category: string; value: string | null; currency: string; original_value: string | null;
  original_currency: string | null; quantity: string | null; comment: string | null; project_name: string | null;
  expense_report_id: string | null; expense_report_status: string | null;
}

async function ownExpenses(ctx: AssistantToolContext, userId: string, from: string, to: string): Promise<ExpenseRow[]> {
  const res = await ctx.get(ExpensesController).list(ctx.orgId, ctx.req, userId, from, nextDay(to));
  return res.entries as unknown as ExpenseRow[];
}

const expensesList: AssistantTool = {
  name: 'expenses_list',
  object: 'nav.expenses',
  description: "EXPENSES: the user's expenses (or a colleague's they may see) in a period, with the booked amount and whether each is on an expense report.",
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive (default: first of this month)' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive (default: today)' },
      person: { type: 'string', description: "A colleague's name, only when asked about someone else" },
    },
  },
  async run(args, ctx) {
    let userId = ctx.callerId;
    if (str(args.person)) {
      const p = await ctx.findPerson(args.person);
      if ('error' in p) return { data: p };
      userId = p.id;
    }
    const from = day(args.from) ?? `${ctx.today.slice(0, 8)}01`;
    const to = day(args.to) ?? ctx.today;
    const rows = await ownExpenses(ctx, userId, from, to);
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.currency] = Math.round(((totals[r.currency] ?? 0) + Number(r.value ?? 0)) * 100) / 100;
    return {
      data: {
        from, to, totals,
        expenses: rows.slice(0, 80).map((r) => ({
          id: r.id, date: r.expense_date, category: r.category, amount: r.value === null ? null : Number(r.value), currency: r.currency,
          ...(r.original_currency && r.original_currency !== r.currency ? { receipt: `${r.original_value} ${r.original_currency}` } : {}),
          ...(r.category === MILEAGE_CATEGORY ? { km: Number(r.quantity) } : {}),
          project: r.project_name, comment: r.comment, report: r.expense_report_id ? r.expense_report_status : null,
        })),
      },
    };
  },
};

const expensesOptions: AssistantTool = {
  name: 'expenses_options',
  object: 'nav.expenses',
  description: "EXPENSES: the organization's expense categories (keys for expenses_add), its reporting currency and the currencies receipts may be in.",
  parameters: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const [cats, booking, currencies] = await Promise.all([
      categories(ctx),
      bookingContext(ctx.db, ctx.orgId),
      ctx.db.execute(sql`
        SELECT "values" FROM static_data
        WHERE entity = 'expenses' AND enum_name = 'currency' AND (organization_id = ${ctx.orgId}::uuid OR organization_id IS NULL)
        ORDER BY organization_id NULLS LAST LIMIT 1`),
    ]);
    return {
      data: {
        categories: { ...cats, [MILEAGE_CATEGORY]: 'Mileage (km driven with a private car; give km, not an amount)' },
        reportingCurrency: booking.reportingCurrency,
        currencies: Object.keys(((currencies.rows[0] as { values?: Record<string, unknown> } | undefined)?.values) ?? {}),
      },
    };
  },
};

const expensesAdd: AssistantTool = {
  name: 'expenses_add',
  object: 'nav.expenses',
  description:
    'EXPENSES: record one expense of the user (without the receipt file: they can attach it on the Expenses page). ' +
    'category is a key from expenses_options; for mileage give km instead of amount. A receipt in another currency is converted with the organization\'s exchange rate.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      category: { type: 'string' },
      amount: { type: 'number', description: 'Receipt amount' },
      currency: { type: 'string', description: 'Receipt currency, e.g. CHF or EUR (default: the reporting currency)' },
      km: { type: 'number', description: 'Only for mileage' },
      project: { type: 'string' },
      comment: { type: 'string' },
    },
    required: ['date', 'category'],
  },
  async run(args, ctx) {
    const booking = await bookingContext(ctx.db, ctx.orgId);
    const category = str(args.category) ?? '';
    const mileage = category === MILEAGE_CATEGORY;
    let projectId: string | undefined;
    if (str(args.project)) {
      const p = await ctx.findProject(args.project);
      if ('error' in p) return { data: p };
      projectId = p.id;
    }
    const res = await ctx.get(ExpensesController).create(ctx.orgId, {
      expenseDate: String(args.date ?? ''),
      category,
      currency: booking.reportingCurrency,
      ...(mileage
        ? { quantity: num(args.km) }
        : { originalValue: num(args.amount), originalCurrency: str(args.currency)?.toUpperCase() ?? booking.reportingCurrency }),
      comment: str(args.comment),
      projectId,
    }, ctx.req) as { ok: boolean; error?: string; id?: string; fields?: unknown };
    const what = mileage ? `${num(args.km)} km` : `${num(args.amount)} ${str(args.currency)?.toUpperCase() ?? booking.reportingCurrency}`;
    return { data: res, action: res.ok ? `Expense ${args.date}: ${category}, ${what} recorded.` : undefined };
  },
};

const expensesReportSubmit: AssistantTool = {
  name: 'expenses_report_submit',
  object: 'nav.expenseReports',
  description:
    "EXPENSES: put the user's expenses of a period that are on no report yet into a new expense report and submit it to their manager. Only when the user asked to submit.",
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      note: { type: 'string' },
    },
    required: ['from', 'to'],
  },
  async run(args: Args, ctx) {
    const from = day(args.from);
    const to = day(args.to);
    if (!from || !to || to < from) return { data: { error: 'needs from and to as YYYY-MM-DD' } };
    const open = (await ownExpenses(ctx, ctx.callerId, from, to)).filter((r) => !r.expense_report_id);
    if (open.length === 0) return { data: { error: 'no expenses without a report in that period' } };
    const reports = ctx.get(ExpenseReportsController);
    const created = await reports.create(ctx.orgId, ctx.req) as { ok: boolean; error?: string; id?: string };
    if (!created.ok || !created.id) return { data: created };
    const failed: { id: string; error?: string }[] = [];
    for (const e of open) {
      const res = await reports.attach(created.id, { expenseId: e.id }, ctx.req) as { ok: boolean; error?: string };
      if (!res.ok) failed.push({ id: e.id, error: res.error });
    }
    const submitted = await reports.submit(created.id, { note: str(args.note) }, ctx.req) as { ok: boolean; error?: string; autoApproved?: boolean };
    const count = open.length - failed.length;
    return {
      data: { ...submitted, expenses: count, notAdded: failed },
      action: submitted.ok ? `Expense report with ${count} expenses ${submitted.autoApproved ? 'submitted and approved' : 'submitted'}.` : `Expense report with ${count} expenses created, not submitted.`,
    };
  },
};

export const EXPENSE_ASSISTANT_TOOLS: AssistantTool[] = [expensesList, expensesOptions, expensesAdd, expensesReportSubmit];
