import { Body, Controller, Delete, Get, HttpException, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, isOrgMember, userOrgRole } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AssistantService, type AssistantMessage } from './assistant.service';
import { assistant_prompts } from './db/schema';

/** Past questions kept per person and organization (favourites are kept beyond this). */
export const ASSISTANT_RECENT_PROMPTS = 30;
export const MAX_ASSISTANT_PROMPT = 2000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A question as it is kept: trimmed, inner whitespace collapsed (so the same question is one row). */
export function normalizePrompt(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t && t.length <= MAX_ASSISTANT_PROMPT ? t : null;
}

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly db: DbService,
    private readonly assistant: AssistantService,
  ) {}

  @Post('chat')
  async chat(
    @Body() body: { orgId: string; messages: AssistantMessage[] },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!this.assistant.isConfigured()) return { ok: false, error: 'assistant-not-configured' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.orgId || !(await isOrgMember(db, body.orgId, callerId))) return { ok: false, error: 'forbidden' };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return { ok: false, error: 'no-messages' };

    const role = (await userOrgRole(db, body.orgId, callerId)) ?? 'member';
    try {
      const { reply, actions } = await this.assistant.chat(callerId, body.orgId, role, messages);
      const last = [...messages].reverse().find((m) => m.role === 'user');
      await this.remember(db, body.orgId, callerId, last?.content).catch(() => {});
      return { ok: true, reply, actions };
    } catch (err) {
      // Budget refusals and Azure failures come back as their code (ai-org-limit-reached, ai-provider-busy, ...),
      // anything else as a clean error instead of a 500, like the mailer.
      if (err instanceof HttpException && /^[a-z][a-z-]+$/.test(err.message)) return { ok: false, error: err.message };
      const message = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: 'assistant-request-failed', detail: message };
    }
  }

  /** The caller's favourites and recent questions in this organization (nobody else's). */
  @Get('prompts')
  async prompts(@Query('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, prompts: [] };
    const callerId = await this.member(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden', prompts: [] };
    const rows = await db
      .select({ id: assistant_prompts.id, prompt: assistant_prompts.prompt, favorite: assistant_prompts.is_favorite, lastUsedAt: assistant_prompts.last_used_at, uses: assistant_prompts.use_count })
      .from(assistant_prompts)
      .where(and(eq(assistant_prompts.organization_id, orgId), eq(assistant_prompts.user_id, callerId)))
      .orderBy(desc(assistant_prompts.is_favorite), desc(assistant_prompts.last_used_at));
    return { ok: true, prompts: rows };
  }

  /** Stars or unstars one of the caller's questions. */
  @Post('prompts/:id/favorite')
  async favorite(@Param('id') id: string, @Query('orgId') orgId: string, @Body() body: { favorite?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.member(db, orgId, req);
    if (!callerId || !ID.test(id)) return { ok: false, error: 'forbidden' };
    if (typeof body?.favorite !== 'boolean') return { ok: false, error: 'invalid-favorite' };
    const updated = await db
      .update(assistant_prompts)
      .set({ is_favorite: body.favorite })
      .where(and(eq(assistant_prompts.id, id), eq(assistant_prompts.organization_id, orgId), eq(assistant_prompts.user_id, callerId)))
      .returning({ id: assistant_prompts.id });
    return updated.length ? { ok: true } : { ok: false, error: 'not-found' };
  }

  /** Forgets one of the caller's questions. */
  @Delete('prompts/:id')
  async forget(@Param('id') id: string, @Query('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.member(db, orgId, req);
    if (!callerId || !ID.test(id)) return { ok: false, error: 'forbidden' };
    await db.delete(assistant_prompts).where(and(eq(assistant_prompts.id, id), eq(assistant_prompts.organization_id, orgId), eq(assistant_prompts.user_id, callerId)));
    return { ok: true };
  }

  private async member(db: Db, orgId: string | undefined, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !orgId || !ID.test(orgId) || !(await isOrgMember(db, orgId, callerId))) return null;
    return callerId;
  }

  /** Keeps the question (asked again = moved up), then drops non-favourites beyond the newest ASSISTANT_RECENT_PROMPTS. */
  private async remember(db: Db, orgId: string, userId: string, text: unknown): Promise<void> {
    const prompt = normalizePrompt(text);
    if (!prompt) return;
    await db
      .insert(assistant_prompts)
      .values({ organization_id: orgId, user_id: userId, prompt })
      .onConflictDoUpdate({
        target: [assistant_prompts.organization_id, assistant_prompts.user_id, assistant_prompts.prompt],
        set: { last_used_at: sql`now()`, use_count: sql`${assistant_prompts.use_count} + 1` },
      });
    await db.execute(sql`
      DELETE FROM assistant_prompts WHERE id IN (
        SELECT id FROM assistant_prompts
        WHERE organization_id = ${orgId} AND user_id = ${userId} AND NOT is_favorite
        ORDER BY last_used_at DESC OFFSET ${ASSISTANT_RECENT_PROMPTS}
      )`);
  }
}
