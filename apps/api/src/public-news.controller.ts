import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DbService } from './db.service';
import { DocumentsService } from './documents.service';
import { Public } from './jwt.guard';
import { publicApiRoot, publicPostHtml } from './news-newsletter';
import { markdownPlain } from '@worktime3/shared/markdown';
import { newsTextFor, type NewsTexts } from '@worktime3/shared/news';

/**
 * Public product news for the website (apps/site loads it with static/assets/news.js): published
 * product posts marked public (083), with their pictures. No login; nothing else of a post (author,
 * who read it) and no other post is reachable here.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC = sql`organization_id IS NULL AND is_public AND published_at IS NOT NULL`;
const day = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD')`);

/** What the list shows of a post: its title and the start of its text, in the visitor's language. */
export function publicSummary(texts: NewsTexts, lang: string) {
  const text = newsTextFor(texts, lang);
  if (!text) return null;
  const plain = markdownPlain(text.body);
  return { lang: text.lang, title: text.title, summary: plain.length > 280 ? `${plain.slice(0, 280).replace(/\s+\S*$/, '')} …` : plain };
}

@Controller('public/news')
export class PublicNewsController {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
  ) {}

  /** The latest public posts, newest first. */
  @Public()
  @Get()
  async list(@Query('lang') lang: string | undefined, @Res({ passthrough: true }) res: Response) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, posts: [] };
    const rows = (await db.execute(sql`SELECT id, texts, ${day('published_at')} AS date FROM news_posts WHERE ${PUBLIC} ORDER BY published_at DESC LIMIT 50`))
      .rows as { id: string; texts: NewsTexts; date: string }[];
    res.set('Cache-Control', 'public, max-age=60');
    return { ok: true, posts: rows.map((r) => ({ id: r.id, date: r.date, ...publicSummary(r.texts, String(lang ?? 'de')) })).filter((p) => p.title) };
  }

  /** One public post with its text as HTML (escaped by the shared renderer). */
  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @Query('lang') lang: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    if (!ID.test(id)) return { ok: false, error: 'not-found' };
    const row = (await db.execute(sql`SELECT id, texts, ${day('published_at')} AS date FROM news_posts WHERE id = ${id} AND ${PUBLIC}`)).rows[0] as
      | { id: string; texts: NewsTexts; date: string }
      | undefined;
    const text = row ? newsTextFor(row.texts, String(lang ?? 'de')) : null;
    if (!row || !text) return { ok: false, error: 'not-found' };
    res.set('Cache-Control', 'public, max-age=60');
    return { ok: true, post: { id: row.id, date: row.date, lang: text.lang, title: text.title, html: publicPostHtml(text.body, publicApiRoot(req), row.id) } };
  }

  /** A picture of a public post (websites and mail programs load it). */
  @Public()
  @Get(':id/images/:documentId')
  async image(@Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const linked =
      db && ID.test(id) && ID.test(documentId)
        ? await db.execute(
            sql`SELECT 1 FROM news_post_documents d JOIN news_posts p ON p.id = d.post_id
                WHERE d.post_id = ${id} AND d.document_id = ${documentId} AND p.organization_id IS NULL AND p.is_public AND p.published_at IS NOT NULL`,
          )
        : null;
    const doc = db && linked && linked.rows.length > 0 ? await this.documents.get(db, documentId) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    // Pictures never change (a new one gets a new id); other sites may show them (the website, mail programs).
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    await this.documents.send(res, doc, { publicCache: 'public, max-age=86400' });
  }
}
