import { Body, Controller, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { AiBudgetService, azureOpenAiAvailable, azurePrices, chatChf, estimateChatChf } from './ai-budget.service';
import { azureOpenAiClient, azureOpenAiConfig, retryStaleConnection } from './ai-client';
import { isValidEmail } from './auth.controller';
import { clientIp } from './client-ip';
import { Public } from './jwt.guard';
import { sendMail, type MailOptions } from './mailer';
import { pushToOperator, type OperatorPush } from './operator-push';
import { allowedOrigins } from './site-contact.controller';
import { chatLang, chatSystemPrompt, cleanHistory, cleanPhone, handoverMail, siteKnowledge, type ChatLang, type ChatMessage } from './site-chat';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Questions per visitor (IP) and hour, and for the whole website per day; hand-overs likewise. */
export const CHAT_PER_IP_HOUR = 20;
export const CHAT_PER_DAY = 400;
export const HANDOVER_PER_IP_HOUR = 3;
export const HANDOVER_PER_DAY = 50;
const MAX_ANSWER_TOKENS = 600;
const SITE_CHAT_KIND = 'site_chat';

/** `import()` that TypeScript leaves alone (the API is CommonJS; the website's texts are ES modules). */
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ default: Record<string, unknown> }>;

/**
 * The website's chatbot (apps/site/static/assets/chat.js), public like the contact form and only from the website's
 * origins (CONTACT_SITE_ORIGINS). `public/chat` answers a question from the website's own texts (site-chat.ts) through
 * Azure OpenAI in Switzerland, every call through AiBudgetService, counted on the operators' organization (its AI limit
 * caps the chatbot's spend); `public/chat/handover` mails the visitor's question and the conversation to CONTACT_EMAIL
 * (Reply-To the visitor) and pushes a hint to the operator's phone. Nothing of a conversation is stored or logged.
 */
@Controller()
export class SiteChatController {
  private readonly logger = new Logger('SiteChat');
  private readonly knowledge = new Map<ChatLang, string>();
  private readonly perIp = new Map<string, number[]>();
  private readonly handoversPerIp = new Map<string, number[]>();
  private today: number[] = [];
  private handoversToday: number[] = [];
  /** Replaceable in tests. */
  now: () => number = () => Date.now();
  send: (mail: MailOptions) => Promise<void> = (mail) => sendMail(mail, 10_000);
  push: (push: OperatorPush) => Promise<boolean> = (push) => pushToOperator(push);
  /** The model's answer to the conversation (Azure OpenAI); replaceable in tests. */
  complete: (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) => Promise<{ text: string; inputTokens: number; outputTokens: number }> =
    async (messages) => {
      const config = azureOpenAiConfig();
      if (!config) throw new Error('not configured');
      const completion = await retryStaleConnection(() => azureOpenAiClient(config, 45_000).chat.completions.create({
        model: config.deployment, messages, max_completion_tokens: MAX_ANSWER_TOKENS,
      }));
      return {
        text: completion.choices[0]?.message?.content?.trim() ?? '',
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
    };

  constructor(private readonly budget: AiBudgetService) {}

  /** The website's texts of a language (apps/site/src/i18n), read once. */
  private async knowledgeOf(lang: ChatLang): Promise<string> {
    const cached = this.knowledge.get(lang);
    if (cached !== undefined) return cached;
    const file = resolve(__dirname, '../../site/src/i18n', `${lang}.mjs`);
    const text = await importModule(pathToFileURL(file).href).then((m) => siteKnowledge(m.default), () => '');
    if (!text) this.logger.warn(`The website's texts (${lang}) were not found at ${file}: the chatbot is off.`);
    this.knowledge.set(lang, text);
    return text;
  }

  private originAllowed(req: Request): boolean {
    return allowedOrigins().includes(String(req.headers.origin ?? '').replace(/\/$/, ''));
  }

  /** Counts a call against a per-IP and a daily window; false once either is full. */
  private allow(ip: string, perIp: Map<string, number[]>, day: number[], ipMax: number, dayMax: number): number[] | null {
    const now = this.now();
    const recent = (perIp.get(ip) ?? []).filter((t) => now - t < HOUR);
    const today = day.filter((t) => now - t < DAY);
    if (recent.length >= ipMax || today.length >= dayMax) return null;
    perIp.set(ip, [...recent, now]);
    if (perIp.size > 5000) perIp.clear();
    return [...today, now];
  }

  /** A question: `{ lang, messages: [{ role, content }] }` -> `{ ok, answer }`. */
  @Public()
  @Post('public/chat')
  async ask(@Body() body: { lang?: string; messages?: unknown }, @Req() req: Request) {
    if (!this.originAllowed(req)) return { ok: false, error: 'forbidden' };
    const lang = chatLang(body?.lang);
    const history = cleanHistory(body?.messages);
    if (!history) return { ok: false, error: 'invalid' };
    const prices = azurePrices();
    const knowledge = await this.knowledgeOf(lang);
    if (!azureOpenAiAvailable() || !prices || !knowledge) return { ok: false, error: 'chat-unavailable' };
    const today = this.allow(clientIp(req), this.perIp, this.today, CHAT_PER_IP_HOUR, CHAT_PER_DAY);
    if (!today) return { ok: false, error: 'rate-limited' };
    this.today = today;

    const system = chatSystemPrompt(lang, knowledge, {
      email: process.env.CONTACT_EMAIL || 'info@apensum.ch',
      demoUrl: process.env.SITE_DEMO_URL || 'https://appdemo.apensum.ch',
    });
    const messages = [{ role: 'system' as const, content: system }, ...history];
    const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
    let usageId: string;
    let orgLimitChf: number;
    try {
      orgLimitChf = await this.budget.orgMonthlyLimitChf(OPERATOR_ORG_ID);
      usageId = await this.budget.reserve({
        orgId: OPERATOR_ORG_ID, userId: null, kind: SITE_CHAT_KIND, provider: 'azure-openai',
        estimateChf: estimateChatChf(inputChars, MAX_ANSWER_TOKENS, prices), orgLimitChf,
      });
    } catch (error) {
      // The budget is used up, or the instance has no operators' organization yet.
      this.logger.warn(`Website chat refused: ${error instanceof Error ? error.message : error}`);
      return { ok: false, error: 'chat-unavailable' };
    }
    try {
      const answer = await this.complete(messages);
      await this.budget.finish(usageId, {
        ok: true, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, actualChf: chatChf(answer.inputTokens, answer.outputTokens, prices),
      }, { orgId: OPERATOR_ORG_ID, orgLimitChf });
      return answer.text ? { ok: true, answer: answer.text } : { ok: false, error: 'chat-failed' };
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.logger.warn(`Website chat call failed: ${error instanceof Error ? error.message : error}`);
      // No answer (a timeout) may still have been billed: the estimate keeps counting.
      await this.budget.finish(usageId, { ok: false, error: 'chat-failed', actualChf: status === undefined ? null : 0 }, { orgId: OPERATOR_ORG_ID, orgLimitChf });
      return { ok: false, error: 'chat-failed' };
    }
  }

  /** Passing the question on to a person: `{ lang, name, email, phone?, message, messages, website }` -> `{ ok }`. */
  @Public()
  @Post('public/chat/handover')
  async handover(@Body() body: { lang?: string; name?: unknown; email?: unknown; phone?: unknown; message?: unknown; messages?: unknown; website?: unknown }, @Req() req: Request) {
    if (!this.originAllowed(req)) return { ok: false, error: 'forbidden' };
    // The hidden field a bot fills in: look successful, send nothing.
    if (typeof body?.website === 'string' && body.website.trim()) return { ok: true };
    const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
    const name = line(body?.name, 120);
    const email = line(body?.email, 200);
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 3000) : '';
    // The phone is optional; one that is given has to look like a number.
    const phone = cleanPhone(body?.phone);
    const phoneGiven = typeof body?.phone === 'string' && body.phone.trim() !== '';
    if (!name || !isValidEmail(email) || message.length < 2 || (phoneGiven && !phone)) return { ok: false, error: 'invalid' };
    const today = this.allow(clientIp(req), this.handoversPerIp, this.handoversToday, HANDOVER_PER_IP_HOUR, HANDOVER_PER_DAY);
    if (!today) return { ok: false, error: 'rate-limited' };
    this.handoversToday = today;
    const history = (cleanHistory([...(Array.isArray(body?.messages) ? body.messages : []), { role: 'user', content: '…' }]) ?? []).slice(0, -1) as ChatMessage[];
    const mail = handoverMail({ name, email, phone, message, history, lang: chatLang(body?.lang) }, process.env.CONTACT_EMAIL || 'info@apensum.ch');
    try {
      await this.send(mail);
    } catch {
      return { ok: false, error: 'mail-failed' };
    }
    // That someone asks, not who or what: the push leaves Switzerland.
    void this.push({ title: 'Website-Chat: Bitte um Rückmeldung', message: 'Jemand möchte über den Chatbot mit Apensum sprechen. Die Nachricht ist in der Mailbox.', tags: ['speech_balloon'], priority: 4 });
    return { ok: true };
  }
}
