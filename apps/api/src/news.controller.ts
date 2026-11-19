import { Body, Controller, Delete, Get, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isOrgMember, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { sendMail } from './mailer';
import { appBaseUrl } from './orgs.controller';
import { markdownImages, markdownPlain } from '@worktime3/shared/markdown';
import { MAX_NEWS_IMAGES, newsImageId, newsTextFor, validateNewsTexts, type NewsTexts } from '@worktime3/shared/news';

/**
 * News (module "news", packages/shared/src/news.ts; tables in 080-news.sql): posts an organization's
 * admin or HR (`nav.news:edit`) writes, publishes and deletes; everyone with `nav.news:see` in the
 * post's audience reads them. The audience is worked out per call, never stored per person: the
 * post's departments (whoever's assignment in force is in one, and its leaders), or everyone.
 * Publishing notifies the audience and, when asked, mails them a link (best effort).
 */

/** Pictures a post may show: no SVG (it could carry script when opened on its own). */
export const NEWS_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** A timestamptz column as an ISO string (raw queries otherwise return Postgres's text format). */
const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Assignments in force today, one row per person of the organization. */
function currentAssignments(orgId: string): SQL {
  return sql`SELECT DISTINCT ON (user_id) user_id, department_id FROM employee_assignments
             WHERE organization_id = ${orgId} AND valid_from <= CURRENT_DATE
             ORDER BY user_id, valid_from DESC`;
}

/** SQL condition over `p` (news_posts): the post's audience includes `userId`. */
function inAudience(orgId: string, userId: string): SQL {
  return sql`(NOT EXISTS (SELECT 1 FROM news_post_departments pd WHERE pd.post_id = p.id)
    OR EXISTS (SELECT 1 FROM news_post_departments pd JOIN departments d ON d.id = pd.department_id
               WHERE pd.post_id = p.id AND (d.leader_user_id = ${userId}
                 OR d.id = (SELECT department_id FROM (${currentAssignments(orgId)}) a WHERE a.user_id = ${userId}))))`;
}

/** Unread for the badge: not opened yet, or a confirmation still owed. */
export const UNREAD = sql`(r.read_at IS NULL OR (p.require_ack AND r.acknowledged_at IS NULL))`;

const OPEN: Record<string, string> = { de: 'Lesen in Apensum', fr: 'Lire dans Apensum', it: 'Leggere in Apensum', en: 'Read in Apensum' };
const ACK: Record<string, string> = {
  de: 'Bitte bestätigen Sie in Apensum, dass Sie diese Mitteilung gelesen haben.',
  fr: 'Veuillez confirmer dans Apensum que vous avez lu ce message.',
  it: 'La preghiamo di confermare in Apensum di aver letto questa comunicazione.',
  en: 'Please confirm in Apensum that you have read this post.',
};

/** The mail to one reader: the post's title, the start of its text and the link into the app, in their language. */
export function newsMail(texts: NewsTexts, requireAck: boolean, locale: string | null | undefined, link: string) {
  const lang = (locale ?? 'de').slice(0, 2);
  const text = newsTextFor(texts, lang);
  if (!text) return null;
  const preview = markdownPlain(text.body);
  const short = preview.length > 600 ? `${preview.slice(0, 600).replace(/\s+\S*$/, '')} …` : preview;
  const parts = [short, requireAck ? ACK[lang] ?? ACK.en : '', `${OPEN[lang] ?? OPEN.en}: ${link}`].filter(Boolean);
  return { subject: text.title, text: `${parts.join('\n\n')}\n` };
}

/** Department ids from the browser: a list of uuids, without duplicates. */
export function cleanDepartmentIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v));
  return ids.length === value.length ? [...new Set(ids.map((v) => v.toLowerCase()))] : null;
}

interface PostRow {
  id: string;
  organization_id: string;
  texts: NewsTexts;
  require_ack: boolean;
  published_at: string | null;
}

@Controller('organizations/:orgId/news')
export class NewsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
  ) {}

  /** The caller and whether they write news, when they are a member who may read news (the module is on). */
  private async caller(db: Executor, orgId: string, req: AuthenticatedRequest): Promise<{ id: string; editor: boolean } | null> {
    const id = req.user ? await callerUserId(db, req.user) : null;
    if (!id || !(await isOrgMember(db, orgId, id))) return null;
    if (!(await can(db, orgId, id, 'nav.news', 'see'))) return null;
    return { id, editor: await can(db, orgId, id, 'nav.news', 'edit') };
  }

  private async load(db: Executor, orgId: string, id: string): Promise<PostRow | null> {
    const rows = await db.execute(
      sql`SELECT id, organization_id, texts, require_ack, ${iso('published_at')} AS published_at FROM news_posts WHERE id = ${id} AND organization_id = ${orgId}`,
    );
    return (rows.rows[0] as unknown as PostRow) ?? null;
  }

  /** The post when the caller may read it: editors every post, readers published ones addressed to them. */
  private async readable(db: Executor, orgId: string, caller: { id: string; editor: boolean }, id: string): Promise<PostRow | null> {
    const post = await this.load(db, orgId, id);
    if (!post) return null;
    if (caller.editor) return post;
    if (!post.published_at) return null;
    const rows = await db.execute(sql`SELECT 1 FROM news_posts p WHERE p.id = ${id} AND ${inAudience(orgId, caller.id)}`);
    return rows.rows.length > 0 ? post : null;
  }

  /** Everyone the post reaches today who may read news: active members, in its departments if it has any. */
  private async audience(db: Executor, orgId: string, postId: string): Promise<{ id: string; name: string; email: string; locale: string | null }[]> {
    const rows = (
      await db.execute(
        sql`SELECT u.id, coalesce(nullif(u.display_name, ''), u.email) AS name, u.email, u.locale
            FROM organization_memberships m JOIN users u ON u.id = m.user_id, news_posts p
            WHERE m.organization_id = ${orgId} AND m.status = 'active' AND u.is_active AND p.id = ${postId}
              AND (NOT EXISTS (SELECT 1 FROM news_post_departments pd WHERE pd.post_id = p.id)
                OR EXISTS (SELECT 1 FROM news_post_departments pd JOIN departments d ON d.id = pd.department_id
                           LEFT JOIN (${currentAssignments(orgId)}) a ON a.user_id = u.id
                           WHERE pd.post_id = p.id AND (d.leader_user_id = u.id OR a.department_id = d.id)))
            ORDER BY name`,
      )
    ).rows as { id: string; name: string; email: string; locale: string | null }[];
    const out = [];
    for (const r of rows) if (await can(db, orgId, r.id, 'nav.news', 'see')) out.push(r);
    return out;
  }

  /** Validated texts, departments of this organization and the confirmation flag; or an error code. */
  private async parse(db: Executor, orgId: string, body: Record<string, unknown>) {
    const texts = validateNewsTexts(body?.texts);
    if (!texts.ok) return texts;
    const departmentIds = cleanDepartmentIds(body?.departmentIds);
    if (!departmentIds) return { ok: false as const, error: 'invalid-departments' };
    if (departmentIds.length > 0) {
      const found = await db.execute(
        sql`SELECT count(*)::int AS n FROM departments WHERE organization_id = ${orgId} AND id IN (${sql.join(departmentIds.map((d) => sql`${d}`), sql`, `)})`,
      );
      if ((found.rows[0]?.n as number) !== departmentIds.length) return { ok: false as const, error: 'invalid-departments' };
    }
    return { ok: true as const, texts: texts.texts, departmentIds, requireAck: body?.requireAck === true };
  }

  /** A text may only show pictures uploaded to this post. */
  private async imagesBelong(db: Executor, postId: string, texts: NewsTexts): Promise<boolean> {
    const ids = new Set<string>();
    for (const t of Object.values(texts)) {
      for (const src of markdownImages(t?.body ?? '')) {
        const id = newsImageId(src);
        if (!id) return false;
        ids.add(id);
      }
    }
    if (ids.size === 0) return true;
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM news_post_documents WHERE post_id = ${postId} AND document_id IN (${sql.join([...ids].map((d) => sql`${d}`), sql`, `)})`,
    );
    return (rows.rows[0]?.n as number) === ids.size;
  }

  private async setDepartments(db: Executor, postId: string, departmentIds: string[]) {
    await db.execute(sql`DELETE FROM news_post_departments WHERE post_id = ${postId}`);
    for (const d of departmentIds) await db.execute(sql`INSERT INTO news_post_departments (post_id, department_id) VALUES (${postId}, ${d})`);
  }

  /** Posts the caller may read, newest first (drafts first for editors), with their own read state. */
  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, editor: false, posts: [] };
    const caller = await this.caller(db, orgId, req);
    if (!caller) return { ok: true, editor: false, posts: [] };
    const visible = caller.editor ? sql`TRUE` : sql`p.published_at IS NOT NULL AND ${inAudience(orgId, caller.id)}`;
    const rows = await db.execute(
      sql`SELECT p.id, p.texts, p.require_ack, ${iso('p.published_at')} AS published_at,
                 p.author_user_id, coalesce(nullif(u.display_name, ''), u.email) AS author_name,
                 coalesce((SELECT array_agg(pd.department_id) FROM news_post_departments pd WHERE pd.post_id = p.id), '{}') AS department_ids,
                 ${iso('r.read_at')} AS read_at, ${iso('r.acknowledged_at')} AS acknowledged_at
          FROM news_posts p
          LEFT JOIN users u ON u.id = p.author_user_id
          LEFT JOIN news_post_reads r ON r.post_id = p.id AND r.user_id = ${caller.id}
          WHERE p.organization_id = ${orgId} AND ${visible}
          ORDER BY p.published_at DESC NULLS FIRST LIMIT 300`,
    );
    return { ok: true, editor: caller.editor, posts: rows.rows };
  }

  /** Published posts addressed to the caller they have not read (or not confirmed yet): the navbar badge. */
  @Get('summary')
  async summary(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, unread: 0 };
    const caller = await this.caller(db, orgId, req);
    if (!caller) return { ok: true, unread: 0 };
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM news_posts p
          LEFT JOIN news_post_reads r ON r.post_id = p.id AND r.user_id = ${caller.id}
          WHERE p.organization_id = ${orgId} AND p.published_at IS NOT NULL AND ${inAudience(orgId, caller.id)} AND ${UNREAD}`,
    );
    return { ok: true, unread: (rows.rows[0]?.n as number) ?? 0 };
  }

  /** A new draft. */
  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden' };
    const input = await this.parse(db, orgId, body);
    if (!input.ok) return input;
    // A new post has no pictures yet: they are uploaded to it once it exists.
    if (Object.values(input.texts).some((t) => markdownImages(t?.body ?? '').length > 0)) return { ok: false, error: 'news-image-unknown' };
    const [post] = (
      await db.execute(
        sql`INSERT INTO news_posts (organization_id, author_user_id, texts, require_ack)
            VALUES (${orgId}, ${caller.id}, ${JSON.stringify(input.texts)}::jsonb, ${input.requireAck}) RETURNING id`,
      )
    ).rows as { id: string }[];
    await this.setDepartments(db, post.id, input.departmentIds);
    void this.versions.record('news_posts', post.id, 'insert', caller.id, { ...input }).catch(() => {});
    return { ok: true, id: post.id };
  }

  /** Changes a draft or a published post (a correction does not notify anyone again). */
  @Put(':id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden' };
    if (!(await this.load(db, orgId, id))) return { ok: false, error: 'not-found' };
    const input = await this.parse(db, orgId, body);
    if (!input.ok) return input;
    if (!(await this.imagesBelong(db, id, input.texts))) return { ok: false, error: 'news-image-unknown' };
    await db.execute(sql`UPDATE news_posts SET texts = ${JSON.stringify(input.texts)}::jsonb, require_ack = ${input.requireAck} WHERE id = ${id}`);
    await this.setDepartments(db, id, input.departmentIds);
    void this.versions.record('news_posts', id, 'update', caller.id, { ...input }).catch(() => {});
    return { ok: true };
  }

  /** Publishes a draft: notifies its audience and, with `mail`, mails each of them a link (best effort). */
  @Post(':id/publish')
  async publish(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { mail?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden' };
    const post = await this.load(db, orgId, id);
    if (!post) return { ok: false, error: 'not-found' };
    if (post.published_at) return { ok: false, error: 'news-already-published' };
    await db.execute(sql`UPDATE news_posts SET published_at = now() WHERE id = ${id}`);
    // The author has read (and, when asked for, confirmed) their own post.
    await db.execute(
      sql`INSERT INTO news_post_reads (post_id, user_id, acknowledged_at) VALUES (${id}, ${caller.id}, ${post.require_ack ? sql`now()` : sql`NULL`})
          ON CONFLICT (post_id, user_id) DO UPDATE SET acknowledged_at = coalesce(news_post_reads.acknowledged_at, EXCLUDED.acknowledged_at)`,
    );
    void this.versions.record('news_posts', id, 'update_delta', caller.id, { published: true }).catch(() => {});

    const audience = (await this.audience(db, orgId, id)).filter((a) => a.id !== caller.id);
    // One notification per reader, titled in their language.
    const byLang = new Map<string, string[]>();
    for (const a of audience) {
      const lang = newsTextFor(post.texts, (a.locale ?? 'de').slice(0, 2))?.lang ?? 'de';
      byLang.set(lang, [...(byLang.get(lang) ?? []), a.id]);
    }
    for (const [lang, recipientUserIds] of byLang) {
      const text = newsTextFor(post.texts, lang);
      await this.notifications.notifyMany({
        organizationId: orgId,
        recipientUserIds,
        type: 'news.published',
        title: text?.title ?? '',
        body: text ? markdownPlain(text.body).slice(0, 200) : undefined,
        sourceTable: 'news_posts',
        sourceTableUuid: id,
        data: { postId: id },
      });
    }
    let mailed = 0;
    if (body?.mail === true) {
      const link = `${appBaseUrl()}/#/news?id=${id}`;
      // In the background: a large organization should not keep the browser waiting.
      void (async () => {
        for (const a of audience) {
          const mail = newsMail(post.texts, post.require_ack, a.locale, link);
          if (!mail) continue;
          await sendMail({ to: a.email, subject: mail.subject, text: mail.text }, 15_000).catch(() => {});
        }
      })();
      mailed = audience.length;
    }
    return { ok: true, notified: audience.length, mailed };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden' };
    const post = await this.load(db, orgId, id);
    if (!post) return { ok: false, error: 'not-found' };
    const docs = (await db.execute(sql`SELECT document_id FROM news_post_documents WHERE post_id = ${id}`)).rows as { document_id: string }[];
    await db.execute(sql`DELETE FROM news_posts WHERE id = ${id}`);
    for (const d of docs) await this.documents.remove(db, d.document_id).catch(() => {});
    void this.versions.record('news_posts', id, 'delete', caller.id, post).catch(() => {});
    return { ok: true };
  }

  /** The caller opened the post. */
  @Post(':id/read')
  async read(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = caller ? await this.readable(db, orgId, caller, id) : null;
    if (!caller || !post?.published_at) return { ok: false, error: 'not-found' };
    await db.execute(sql`INSERT INTO news_post_reads (post_id, user_id) VALUES (${id}, ${caller.id}) ON CONFLICT DO NOTHING`);
    return { ok: true };
  }

  /** The caller confirms they read a post that asks for it. */
  @Post(':id/acknowledge')
  async acknowledge(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = caller ? await this.readable(db, orgId, caller, id) : null;
    if (!caller || !post?.published_at) return { ok: false, error: 'not-found' };
    if (!post.require_ack) return { ok: false, error: 'news-no-confirmation' };
    await db.execute(
      sql`INSERT INTO news_post_reads (post_id, user_id, acknowledged_at) VALUES (${id}, ${caller.id}, now())
          ON CONFLICT (post_id, user_id) DO UPDATE SET acknowledged_at = coalesce(news_post_reads.acknowledged_at, now())`,
    );
    return { ok: true };
  }

  /** For editors: everyone the post reaches, with when they read and confirmed it. */
  @Get(':id/reads')
  async reads(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden', people: [] };
    if (!(await this.load(db, orgId, id))) return { ok: false, error: 'not-found', people: [] };
    const audience = await this.audience(db, orgId, id);
    const reads = (
      await db.execute(sql`SELECT user_id, ${iso('read_at')} AS read_at, ${iso('acknowledged_at')} AS acknowledged_at FROM news_post_reads WHERE post_id = ${id}`)
    ).rows as { user_id: string; read_at: string; acknowledged_at: string | null }[];
    const byUser = new Map(reads.map((r) => [r.user_id, r]));
    return {
      ok: true,
      people: audience.map((a) => ({ userId: a.id, name: a.name, readAt: byUser.get(a.id)?.read_at ?? null, acknowledgedAt: byUser.get(a.id)?.acknowledged_at ?? null })),
    };
  }

  /** Uploads a picture for the post's text; the text then shows it as `![alt](doc:<id>)`. */
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  async upload(@Param('orgId') orgId: string, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    if (!caller?.editor) return { ok: false, error: 'forbidden' };
    if (!(await this.load(db, orgId, id))) return { ok: false, error: 'not-found' };
    if (!file?.buffer?.length) return { ok: false, error: 'file-required' };
    if (!NEWS_IMAGE_TYPES.includes(file.mimetype)) return { ok: false, error: 'news-image-type' };
    const count = await db.execute(sql`SELECT count(*)::int AS n FROM news_post_documents WHERE post_id = ${id}`);
    if ((count.rows[0]?.n as number) >= MAX_NEWS_IMAGES) return { ok: false, error: 'news-too-many-images' };
    const documentId = await this.documents.upload(db as Db, orgId, caller.id, file, { table: 'news_posts', id });
    await db.execute(sql`INSERT INTO news_post_documents (post_id, document_id) VALUES (${id}, ${documentId})`);
    return { ok: true, documentId };
  }

  /** A picture of a post, for whoever may read the post. */
  @Get(':id/images/:documentId')
  async image(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const db = this.db.getDb();
    const caller = db ? await this.caller(db, orgId, req) : null;
    if (!db || !caller || !(await this.readable(db, orgId, caller, id))) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const linked = await db.execute(sql`SELECT 1 FROM news_post_documents WHERE post_id = ${id} AND document_id = ${documentId}`);
    const doc = linked.rows.length > 0 ? await this.documents.get(db, documentId) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }
}
