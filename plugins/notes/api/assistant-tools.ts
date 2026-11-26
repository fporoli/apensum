import type { AssistantTool } from '@worktime3/api/plugin';
import { NotesController } from './notes.controller';

/**
 * The assistant's notes tools (ApiPlugin.assistantTools): the example of how a plugin offers its page to the AI
 * assistant. A tool calls the plugin's own controller with the request made for the caller (`ctx.req`), so it runs
 * exactly the endpoint's checks (here `nav.notes`, own notes only) and answers with its `{ ok, error }`. `object` offers
 * the tool only to whoever may see the page; names start with the plugin's id.
 */

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const notesList: AssistantTool = {
  name: 'notes_list',
  object: 'nav.notes',
  description: "NOTES: the user's own notes, newest first; with a query only those containing every word.",
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for (optional)' } } },
  async run(args, ctx) {
    const res = await ctx.get(NotesController).list(ctx.orgId, ctx.req) as { ok: boolean; notes: { id: string; text: string; created_at: string }[] };
    const words = (str(args.query) ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const notes = res.notes.filter((n) => words.every((w) => n.text.toLowerCase().includes(w)));
    return { data: { count: notes.length, notes: notes.slice(0, 30).map((n) => ({ id: n.id, text: n.text, created: n.created_at.slice(0, 16) })) } };
  },
};

const notesAdd: AssistantTool = {
  name: 'notes_add',
  object: 'nav.notes',
  description: "NOTES: write a note for the user (\"note that …\", \"remember …\"): the text as they want it kept. Only they see it.",
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async run(args, ctx) {
    const res = await ctx.get(NotesController).create(ctx.orgId, { text: args.text }, ctx.req) as { ok: boolean; error?: string; note?: { id: string } };
    return { data: res, action: res.ok ? 'Note saved.' : undefined };
  },
};

const notesUpdate: AssistantTool = {
  name: 'notes_update',
  object: 'nav.notes',
  description: "NOTES: replace the text of one of the user's notes (by its id from notes_list) with the new full text, e.g. to add a line. Markdown is kept as it is.",
  parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string', description: 'The whole new text' } }, required: ['id', 'text'] },
  async run(args, ctx) {
    const res = await ctx.get(NotesController).update(ctx.orgId, String(args.id ?? ''), { text: args.text }, ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Note changed.' : undefined };
  },
};

const notesDelete: AssistantTool = {
  name: 'notes_delete',
  object: 'nav.notes',
  description: 'NOTES: delete one of the user\'s notes by its id (from notes_list), only when they ask to delete that note.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(args, ctx) {
    const res = await ctx.get(NotesController).remove(ctx.orgId, String(args.id ?? ''), ctx.req) as { ok: boolean; error?: string };
    return { data: res, action: res.ok ? 'Note deleted.' : undefined };
  },
};

export const NOTES_ASSISTANT_TOOLS: AssistantTool[] = [notesList, notesAdd, notesUpdate, notesDelete];
