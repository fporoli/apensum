import { Body, Controller, Delete, Get, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql, type SQL } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isOrgMember, isOperator, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { sendMail } from './mailer';
import { appBaseUrl } from './orgs.controller';
import { newsletterIssue, newsUnsubscribeToken, publicApiRoot, sitePostUrl } from './news-newsletter';
import { allowedOrigins } from './site-contact.controller';
import { markdownImages, markdownPlain } from '@worktime3/shared/markdown';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { MAX_NEWS_IMAGES, newsImageId, newsTextFor, validateNewsTexts, type NewsTexts } from '@worktime3/shared/news';

/**
 * News (module "news", packages/shared/src/news.ts; tables in 080-news.sql): posts an organization's
 * admin or HR (`nav.news:edit`) writes, publishes and deletes; everyone with `nav.news:see` in the
 * post's audience reads them. The audience is worked out per call, never stored per person: the
 * post's departments (whoever's assignment in force is in one, and its leaders), or everyone.
 * Publishing notifies the audience and, when asked, mails them a link (best effort).
 *
 * Product news (organization_id NULL, 082): an operator writes it once for the admins
 * (`nav.admin`) of every organization; it shows in each of their organizations' News page. It is
 * written only on the Super Admin pages of the Admin organization, through the same handlers at
 * `operator/news` (no organization: `orgId` null), which reach product news alone; an organization's
 * routes only read it. Its pictures are documents of the Admin organization (OPERATOR_ORG_ID).
 */

const ORG_NEWS = 'organizations/:orgId/news';
const OPERATOR_NEWS = 'operator/news';
/** A route for an organization's news and the same one for product news on the Super Admin pages. */
const both = (path = '') => [`${ORG_NEWS}${path}`, `${OPERATOR_NEWS}${path}`];

/** Pause between two newsletter mails. */
export const NEWSLETTER_PAUSE_MS = 250;

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
  /** NULL: product news (082). */
  organization_id: string | null;
  texts: NewsTexts;
  require_ack: boolean;
  published_at: string | null;
  /** Product news also on the website and for its newsletter (083). */
  is_public: boolean;
}

export interface NewsCaller {
  id: string;
  /** Writes this organization's news (`nav.news:edit`). */
  editor: boolean;
  /** An admin of this organization (`nav.admin`): reads product news. */
  admin: boolean;
  /** Writes product news for every organization's admins. */
  operator: boolean;
}

/** Who changes a post: the organization's news writers, or for product news an operator. */
export function mayEditNews(caller: NewsCaller, post: { organization_id: string | null }): boolean {
  return post.organization_id === null ? caller.operator : caller.editor;
}

/**
 * SQL condition over `p` (news_posts): the caller sees the post in this organization. The
 * organization's posts: writers all of them, readers the published ones addressed to them. Product
 * news: operators all of it, the organization's admins what is published.
 */
function visibleTo(orgId: string | null, caller: NewsCaller): SQL {
  if (orgId === null) return sql`(p.organization_id IS NULL AND ${caller.operator ? sql`TRUE` : sql`FALSE`})`;
  const own = caller.editor ? sql`TRUE` : sql`(p.published_at IS NOT NULL AND ${inAudience(orgId, caller.id)})`;
  const product = caller.operator ? sql`TRUE` : caller.admin ? sql`p.published_at IS NOT NULL` : sql`FALSE`;
  return sql`((p.organization_id = ${orgId} AND ${own}) OR (p.organization_id IS NULL AND ${product}))`;
}

interface Reader {
  id: string;
  name: string;
  email: string;
  locale: string | null;
  /** The organization the notification goes to (product news: the first one the person administers). */
  orgId: string;
  /** Product news: the organizations the person administers, for the "who read it" list. */
  orgNames?: string[];
}

@Controller()
export class NewsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * The caller and what they may do, when they are a member who may read news here (the module is on).
   * On the Super Admin pages (`orgId` null): an operator, for product news.
   */
  private async caller(db: Executor, orgId: string | null, req: AuthenticatedRequest): Promise<NewsCaller | null> {
    const id = req.user ? await callerUserId(db, req.user) : null;
    if (orgId === null) {
      if (!id) return null;
      return (await isOperator(db, id)) ? { id, editor: false, admin: false, operator: true } : null;
    }
    if (!id || !(await isOrgMember(db, orgId, id))) return null;
    if (!(await can(db, orgId, id, 'nav.news', 'see'))) return null;
    return {
      id,
      editor: await can(db, orgId, id, 'nav.news', 'edit'),
      admin: await can(db, orgId, id, 'nav.admin', 'see'),
      // Product news is written on the Super Admin pages only; here it is read.
      operator: false,
    };
  }

  /** The post, when it is this organization's or product news (in the console: product news only). */
  private async load(db: Executor, orgId: string | null, id: string): Promise<PostRow | null> {
    const rows = await db.execute(
      sql`SELECT id, organization_id, texts, require_ack, is_public, ${iso('published_at')} AS published_at FROM news_posts
          WHERE id = ${id} AND (${orgId === null ? sql`FALSE` : sql`organization_id = ${orgId}`} OR organization_id IS NULL)`,
    );
    return (rows.rows[0] as unknown as PostRow) ?? null;
  }

  /** The post when the caller may see it here. */
  private async readable(db: Executor, orgId: string | null, caller: NewsCaller, id: string): Promise<PostRow | null> {
    const post = await this.load(db, orgId, id);
    if (!post) return null;
    const rows = await db.execute(sql`SELECT 1 FROM news_posts p WHERE p.id = ${id} AND ${visibleTo(orgId, caller)}`);
    return rows.rows.length > 0 ? post : null;
  }

  /** The post when the caller may change it, else the error to return. */
  private async editable(db: Executor, orgId: string | null, caller: NewsCaller | null, id: string): Promise<PostRow | { error: string }> {
    if (!caller) return { error: 'forbidden' };
    const post = await this.load(db, orgId, id);
    if (!post) return { error: 'not-found' };
    return mayEditNews(caller, post) ? post : { error: 'forbidden' };
  }

  /** Everyone an organization post reaches today who may read news: active members, in its departments if it has any. */
  private async audience(db: Executor, orgId: string, postId: string): Promise<Reader[]> {
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
    ).rows as Omit<Reader, 'orgId'>[];
    const out: Reader[] = [];
    for (const r of rows) if (await can(db, orgId, r.id, 'nav.news', 'see')) out.push({ ...r, orgId });
    return out;
  }

  /**
   * Who product news reaches: in every organization, the active admins (`nav.admin`) who can read
   * news there (the module is on). Once per person, noting every organization they administer.
   */
  private async productAudience(db: Executor): Promise<Reader[]> {
    const rows = (
      await db.execute(
        sql`SELECT m.organization_id AS org_id, o.name AS org_name, u.id, coalesce(nullif(u.display_name, ''), u.email) AS name, u.email, u.locale
            FROM organization_memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id
            WHERE m.status = 'active' AND u.is_active
            ORDER BY name, o.name`,
      )
    ).rows as { org_id: string; org_name: string; id: string; name: string; email: string; locale: string | null }[];
    const byUser = new Map<string, Reader>();
    for (const r of rows) {
      if (!(await can(db, r.org_id, r.id, 'nav.admin', 'see')) || !(await can(db, r.org_id, r.id, 'nav.news', 'see'))) continue;
      const seen = byUser.get(r.id);
      if (seen) seen.orgNames!.push(r.org_name);
      else byUser.set(r.id, { id: r.id, name: r.name, email: r.email, locale: r.locale, orgId: r.org_id, orgNames: [r.org_name] });
    }
    return [...byUser.values()];
  }

  /** Validated texts, departments of this organization and the confirmation flag; or an error code. */
  private async parse(db: Executor, orgId: string | null, body: Record<string, unknown>, product: boolean) {
    const texts = validateNewsTexts(body?.texts);
    if (!texts.ok) return texts;
    const departmentIds = cleanDepartmentIds(body?.departmentIds);
    if (!departmentIds) return { ok: false as const, error: 'invalid-departments' };
    if (product && departmentIds.length > 0) return { ok: false as const, error: 'news-product-departments' };
    const isPublic = body?.public === true;
    if (isPublic && !product) return { ok: false as const, error: 'news-public-product-only' };
    if (departmentIds.length > 0 && orgId !== null) {
      const found = await db.execute(
        sql`SELECT count(*)::int AS n FROM departments WHERE organization_id = ${orgId} AND id IN (${sql.join(departmentIds.map((d) => sql`${d}`), sql`, `)})`,
      );
      if ((found.rows[0]?.n as number) !== departmentIds.length) return { ok: false as const, error: 'invalid-departments' };
    }
    return { ok: true as const, texts: texts.texts, departmentIds, requireAck: body?.requireAck === true, isPublic };
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

  /** Posts the caller may see here, newest first (drafts first), with their own read state. */
  @Get(both())
  async list(@Param('orgId') orgParam: string | undefined, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, editor: false, productEditor: false, posts: [] };
    const caller = await this.caller(db, orgId, req);
    if (!caller) return { ok: true, editor: false, productEditor: false, posts: [] };
    const rows = await db.execute(
      sql`SELECT p.id, p.texts, p.require_ack, ${iso('p.published_at')} AS published_at, (p.organization_id IS NULL) AS product, p.is_public,
                 p.author_user_id, coalesce(nullif(u.display_name, ''), u.email) AS author_name,
                 coalesce((SELECT array_agg(pd.department_id) FROM news_post_departments pd WHERE pd.post_id = p.id), '{}') AS department_ids,
                 ${iso('r.read_at')} AS read_at, ${iso('r.acknowledged_at')} AS acknowledged_at
          FROM news_posts p
          LEFT JOIN users u ON u.id = p.author_user_id
          LEFT JOIN news_post_reads r ON r.post_id = p.id AND r.user_id = ${caller.id}
          WHERE ${visibleTo(orgId, caller)}
          ORDER BY p.published_at DESC NULLS FIRST LIMIT 300`,
    );
    return { ok: true, editor: caller.editor, productEditor: caller.operator, posts: rows.rows };
  }

  /** Published posts for the caller here they have not read (or not confirmed yet): the navbar badge. */
  @Get(`${ORG_NEWS}/summary`)
  async summary(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, unread: 0 };
    const caller = await this.caller(db, orgId, req);
    if (!caller) return { ok: true, unread: 0 };
    // Writers count only what is addressed to them, like everyone else.
    const reader = { ...caller, editor: false, operator: false, admin: caller.admin };
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM news_posts p
          LEFT JOIN news_post_reads r ON r.post_id = p.id AND r.user_id = ${caller.id}
          WHERE p.published_at IS NOT NULL AND ${visibleTo(orgId, reader)} AND ${UNREAD}`,
    );
    return { ok: true, unread: (rows.rows[0]?.n as number) ?? 0 };
  }

  /** A new draft; on the Super Admin pages product news for the admins of every organization. */
  @Post(both())
  async create(@Param('orgId') orgParam: string | undefined, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const product = orgId === null;
    if (!caller || !mayEditNews(caller, { organization_id: product ? null : orgId })) return { ok: false, error: 'forbidden' };
    const input = await this.parse(db, orgId, body, product);
    if (!input.ok) return input;
    // A new post has no pictures yet: they are uploaded to it once it exists.
    if (Object.values(input.texts).some((t) => markdownImages(t?.body ?? '').length > 0)) return { ok: false, error: 'news-image-unknown' };
    const [post] = (
      await db.execute(
        sql`INSERT INTO news_posts (organization_id, author_user_id, texts, require_ack, is_public)
            VALUES (${product ? null : orgId}, ${caller.id}, ${JSON.stringify(input.texts)}::jsonb, ${input.requireAck}, ${input.isPublic}) RETURNING id`,
      )
    ).rows as { id: string }[];
    await this.setDepartments(db, post.id, input.departmentIds);
    void this.versions.record('news_posts', post.id, 'insert', caller.id, { ...input, product }).catch(() => {});
    return { ok: true, id: post.id };
  }

  /** Changes a draft or a published post (a correction does not notify anyone again). */
  @Put(both('/:id'))
  async update(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    const input = await this.parse(db, orgId, body, post.organization_id === null);
    if (!input.ok) return input;
    if (!(await this.imagesBelong(db, id, input.texts))) return { ok: false, error: 'news-image-unknown' };
    await db.execute(sql`UPDATE news_posts SET texts = ${JSON.stringify(input.texts)}::jsonb, require_ack = ${input.requireAck}, is_public = ${input.isPublic} WHERE id = ${id}`);
    await this.setDepartments(db, id, input.departmentIds);
    void this.versions.record('news_posts', id, 'update', caller!.id, { ...input }).catch(() => {});
    return { ok: true };
  }

  /** Publishes a draft: notifies its audience and, with `mail`, mails each of them a link (best effort). */
  @Post(both('/:id/publish'))
  async publish(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Body() body: { mail?: unknown }, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    if (post.published_at) return { ok: false, error: 'news-already-published' };
    const authorId = caller!.id;
    await db.execute(sql`UPDATE news_posts SET published_at = now() WHERE id = ${id}`);
    // The author has read (and, when asked for, confirmed) their own post.
    await db.execute(
      sql`INSERT INTO news_post_reads (post_id, user_id, acknowledged_at) VALUES (${id}, ${authorId}, ${post.require_ack ? sql`now()` : sql`NULL`})
          ON CONFLICT (post_id, user_id) DO UPDATE SET acknowledged_at = coalesce(news_post_reads.acknowledged_at, EXCLUDED.acknowledged_at)`,
    );
    void this.versions.record('news_posts', id, 'update_delta', authorId, { published: true }).catch(() => {});

    const product = post.organization_id === null;
    const audience = (product ? await this.productAudience(db) : await this.audience(db, orgId!, id)).filter((a) => a.id !== authorId);
    // One notification per reader, in the organization it concerns, titled in their language.
    const groups = new Map<string, { orgId: string; lang: string; ids: string[] }>();
    for (const a of audience) {
      const lang = newsTextFor(post.texts, (a.locale ?? 'de').slice(0, 2))?.lang ?? 'de';
      const key = `${a.orgId}:${lang}`;
      const g = groups.get(key) ?? { orgId: a.orgId, lang, ids: [] };
      g.ids.push(a.id);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const text = newsTextFor(post.texts, g.lang);
      await this.notifications.notifyMany({
        organizationId: g.orgId,
        recipientUserIds: g.ids,
        type: product ? 'news.product' : 'news.published',
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
      // In the background: a large audience should not keep the browser waiting.
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

  @Delete(both('/:id'))
  async remove(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    const docs = (await db.execute(sql`SELECT document_id FROM news_post_documents WHERE post_id = ${id}`)).rows as { document_id: string }[];
    await db.execute(sql`DELETE FROM news_posts WHERE id = ${id}`);
    for (const d of docs) await this.documents.remove(db, d.document_id).catch(() => {});
    void this.versions.record('news_posts', id, 'delete', caller!.id, post).catch(() => {});
    return { ok: true };
  }

  /** The caller opened the post. */
  @Post(`${ORG_NEWS}/:id/read`)
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
  @Post(`${ORG_NEWS}/:id/acknowledge`)
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

  /** For whoever may change the post: everyone it reaches, with when they read and confirmed it. */
  @Get(both('/:id/reads'))
  async reads(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error, people: [] };
    const audience = post.organization_id === null ? await this.productAudience(db) : await this.audience(db, orgId!, id);
    const reads = (
      await db.execute(sql`SELECT user_id, ${iso('read_at')} AS read_at, ${iso('acknowledged_at')} AS acknowledged_at FROM news_post_reads WHERE post_id = ${id}`)
    ).rows as { user_id: string; read_at: string; acknowledged_at: string | null }[];
    const byUser = new Map(reads.map((r) => [r.user_id, r]));
    return {
      ok: true,
      people: audience.map((a) => ({
        userId: a.id,
        name: a.name,
        organizations: a.orgNames ?? [],
        readAt: byUser.get(a.id)?.read_at ?? null,
        acknowledgedAt: byUser.get(a.id)?.acknowledged_at ?? null,
      })),
    };
  }

  /** Public product news and the newsletter: who could get it and how many already did. Superdevelopers only. */
  @Get(both('/:id/newsletter'))
  async newsletterStatus(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    if (!post.is_public) return { ok: false, error: 'news-not-public' };
    const [row] = (
      await db.execute(
        sql`SELECT (SELECT count(*)::int FROM newsletter_subscribers WHERE status = 'confirmed') AS subscribers,
                   (SELECT count(*)::int FROM newsletter_deliveries WHERE post_id = ${id}) AS sent`,
      )
    ).rows as { subscribers: number; sent: number }[];
    return { ok: true, subscribers: row.subscribers, sent: row.sent, running: this.sending.has(id) };
  }

  /**
   * Sends a published public post to the newsletter's confirmed subscribers who did not get it yet
   * (newsletter_deliveries), in the background; `test: true` sends it only to the caller.
   */
  @Post(both('/:id/newsletter'))
  async newsletter(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @Body() body: { test?: unknown }, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    if (!post.is_public) return { ok: false, error: 'news-not-public' };
    if (!post.published_at) return { ok: false, error: 'news-not-published' };
    const apiRoot = publicApiRoot(req as unknown as Request);
    const siteOrigin = allowedOrigins()[0] ?? 'https://apensum.ch';

    if (body?.test === true) {
      const me = (await db.execute(sql`SELECT email, coalesce(locale, 'de') AS locale FROM users WHERE id = ${caller!.id}`)).rows[0] as { email: string; locale: string };
      const lang = me.locale.slice(0, 2);
      // The test mail's unsubscribe link leads to the website's news page: the caller is no subscriber.
      const issue = newsletterIssue(post, { lang }, { apiRoot, siteUrl: sitePostUrl(siteOrigin, lang, id), unsubscribeUrl: sitePostUrl(siteOrigin, lang, id).replace(/\?post=.*$/, '') });
      if (!issue) return { ok: false, error: 'news-text-required' };
      try {
        await sendMail({ to: me.email, subject: `[Test] ${issue.subject}`, text: issue.text, html: issue.html }, 15_000);
      } catch {
        return { ok: false, error: 'mail-failed' };
      }
      return { ok: true, test: true, to: me.email };
    }

    if (this.sending.has(id)) return { ok: false, error: 'news-newsletter-running' };
    const subscribers = (
      await db.execute(
        sql`SELECT s.id, s.email::text AS email, s.lang, s.site_origin FROM newsletter_subscribers s
            WHERE s.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.post_id = ${id} AND d.subscriber_id = s.id)
            ORDER BY s.confirmed_at`,
      )
    ).rows as { id: string; email: string; lang: string; site_origin: string }[];
    this.sending.add(id);
    void this.deliver(db, post, subscribers, apiRoot)
      .catch(() => {})
      .finally(() => this.sending.delete(id));
    void this.versions.record('news_posts', id, 'update_delta', caller!.id, { newsletter: subscribers.length }).catch(() => {});
    return { ok: true, queued: subscribers.length };
  }

  /** Posts being sent to the newsletter right now (one send per post at a time). */
  private readonly sending = new Set<string>();

  /** One mail per subscriber, each claimed first in newsletter_deliveries; a failed one is released for the next send. */
  private async deliver(db: Executor, post: PostRow, subscribers: { id: string; email: string; lang: string; site_origin: string }[], apiRoot: string) {
    let failed = 0;
    for (const s of subscribers) {
      const claimed = await db.execute(
        sql`INSERT INTO newsletter_deliveries (post_id, subscriber_id) VALUES (${post.id}, ${s.id}) ON CONFLICT DO NOTHING RETURNING subscriber_id`,
      );
      if (claimed.rows.length === 0) continue;
      const issue = newsletterIssue(post, s, {
        apiRoot,
        siteUrl: sitePostUrl(s.site_origin, s.lang, post.id),
        unsubscribeUrl: `${apiRoot}/public/newsletter/unsubscribe?t=${newsUnsubscribeToken(s.id)}`,
      });
      try {
        if (!issue) throw new Error('no text');
        await sendMail({ to: s.email, subject: issue.subject, text: issue.text, html: issue.html, headers: issue.headers }, 15_000);
      } catch {
        failed += 1;
        await db.execute(sql`DELETE FROM newsletter_deliveries WHERE post_id = ${post.id} AND subscriber_id = ${s.id}`);
      }
      // Gently: an ordinary SMTP account must not take it for a flood.
      await new Promise((r) => setTimeout(r, NEWSLETTER_PAUSE_MS));
    }
    if (failed > 0) {
      // eslint-disable-next-line no-console
      console.warn(`newsletter ${post.id}: ${failed} of ${subscribers.length} mails failed; sending again retries them`);
    }
  }

  /**
   * Uploads a picture for the post's text; the text then shows it as `![alt](doc:<id>)`. Product news
   * pictures are documents of the Admin organization (OPERATOR_ORG_ID).
   */
  @Post(both('/:id/images'))
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  async upload(@Param('orgId') orgParam: string | undefined, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: AuthenticatedRequest) {
    const orgId = orgParam ?? null;
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const caller = await this.caller(db, orgId, req);
    const post = await this.editable(db, orgId, caller, id);
    if ('error' in post) return { ok: false, error: post.error };
    if (!file?.buffer?.length) return { ok: false, error: 'file-required' };
    if (!NEWS_IMAGE_TYPES.includes(file.mimetype)) return { ok: false, error: 'news-image-type' };
    const count = await db.execute(sql`SELECT count(*)::int AS n FROM news_post_documents WHERE post_id = ${id}`);
    if ((count.rows[0]?.n as number) >= MAX_NEWS_IMAGES) return { ok: false, error: 'news-too-many-images' };
    const documentId = await this.documents.upload(db as Db, orgId ?? OPERATOR_ORG_ID, caller!.id, file, { table: 'news_posts', id });
    await db.execute(sql`INSERT INTO news_post_documents (post_id, document_id) VALUES (${id}, ${documentId})`);
    return { ok: true, documentId };
  }

  /** A picture of a post, for whoever may see the post. */
  @Get(both('/:id/images/:documentId'))
  async image(
    @Param('orgId') orgParam: string | undefined,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const orgId = orgParam ?? null;
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
