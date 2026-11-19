import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWSLETTER_CONFIRM_DAYS, NEWSLETTER_LIMIT_PER_IP, NEWSLETTER_MAIL_GAP_MS, SiteNewsletterController, hashToken, newsletterMail, newsletterPage,
  type Subscriber, type SubscriberStore,
} from '../../apps/api/src/site-newsletter.controller';
import type { MailOptions } from '../../apps/api/src/mailer';

/** The table in memory, as the database store keeps it. */
function memoryStore() {
  const rows: (Subscriber & { token_hash: string; confirmed_at?: Date; unsubscribed_at?: Date })[] = [];
  const store: SubscriberStore = {
    byEmail: async (email) => rows.find((r) => r.email === email) ?? null,
    byToken: async (hash) => rows.find((r) => r.token_hash === hash) ?? null,
    requestSubscription: async (email, lang, site_origin, token_hash, now) => {
      const r = rows.find((x) => x.email === email);
      const values = { lang, status: 'pending' as const, token_hash, site_origin, requested_at: now, last_mail_at: now, confirmed_at: undefined, unsubscribed_at: undefined };
      if (r) Object.assign(r, values);
      else rows.push({ id: `id-${rows.length + 1}`, email, ...values });
    },
    renewToken: async (id, token_hash, now) => { Object.assign(rows.find((r) => r.id === id)!, { token_hash, last_mail_at: now }); },
    confirm: async (id, now) => { const r = rows.find((x) => x.id === id)!; if (r.status === 'pending') Object.assign(r, { status: 'confirmed', confirmed_at: now }); },
    unsubscribe: async (id, now) => { Object.assign(rows.find((r) => r.id === id)!, { status: 'unsubscribed', unsubscribed_at: now }); },
  };
  return { rows, store };
}

function setup() {
  const c = new SiteNewsletterController({ getDb: () => null } as never);
  const { rows, store } = memoryStore();
  c.store = store;
  const sent: MailOptions[] = [];
  c.send = async (m) => { sent.push(m); };
  let clock = Date.parse('2026-11-19T10:00:00Z');
  c.now = () => clock;
  return { c, rows, sent, advance: (ms: number) => { clock += ms; } };
}

const API = { 'x-forwarded-proto': 'https', host: 'api.apensum.ch' };

function post(c: SiteNewsletterController, method: 'subscribe' | 'unsubscribeRequest', body: object, { origin = 'https://apensum.ch', ip = '1.2.3.4' } = {}) {
  const out: { status?: number; location?: string; json?: unknown } = {};
  const res = {
    redirect: (status: number, location: string) => { out.status = status; out.location = location; },
    status: (s: number) => ({ json: (j: unknown) => { out.status = s; out.json = j; } }),
  };
  const req = { headers: { ...API, origin, accept: 'text/html', 'x-forwarded-for': ip }, socket: {} };
  return c[method](body as never, req as never, res as never).then(() => out);
}

/** A link page or a button: the HTML and status the visitor gets. */
function page(c: SiteNewsletterController, method: 'confirmPage' | 'confirm' | 'unsubscribePage' | 'unsubscribe', token: string) {
  const out: { status?: number; html?: string } = {};
  const res = { status: (s: number) => { out.status = s; return { set: () => ({ send: (h: string) => { out.html = h; } }) }; } };
  const req = { headers: API, socket: {} };
  const p = method === 'confirm' || method === 'unsubscribe'
    ? c[method]({ t: token }, undefined as never, res as never)
    : c[method](token, req as never, res as never);
  return p.then(() => out);
}

const tokenOf = (mail: MailOptions) => /[?&]t=([\w-]+)/.exec(mail.text)![1];
const form = { email: 'Anna@Example.ch', lang: 'fr', ok: '/fr/news/verifier/', fail: '/fr/news/erreur/' };

test('subscribing mails a confirmation link in the language of the form; only the button confirms', async () => {
  const { c, rows, sent } = setup();
  const out = await post(c, 'subscribe', form);
  assert.deepEqual(out, { status: 303, location: 'https://apensum.ch/fr/news/verifier/' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'anna@example.ch');
  assert.equal(rows[0].status, 'pending');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'anna@example.ch');
  assert.match(sent[0].subject, /confirmer votre inscription/);
  assert.match(sent[0].text, /https:\/\/api\.apensum\.ch\/api\/v1\/public\/newsletter\/confirm\?t=/);
  const token = tokenOf(sent[0]);
  assert.equal(rows[0].token_hash, hashToken(token), 'only the hash is kept');

  // Opening the link (or a mail scanner doing so) only shows the button.
  const shown = await page(c, 'confirmPage', token);
  assert.equal(shown.status, 200);
  assert.match(shown.html!, /<form method="post" action="https:\/\/api\.apensum\.ch\/api\/v1\/public\/newsletter\/confirm">/);
  assert.match(shown.html!, /Confirmer l&#39;inscription/);
  assert.equal(rows[0].status, 'pending');

  const done = await page(c, 'confirm', token);
  assert.equal(rows[0].status, 'confirmed');
  assert.match(done.html!, /Merci/);
  assert.match(done.html!, /href="https:\/\/apensum\.ch\/fr\/"/);
});

test('subscribing again never says who is subscribed and never floods an inbox', async () => {
  const { c, sent, rows, advance } = setup();
  await post(c, 'subscribe', form);
  // Within the gap: the same answer, no second mail.
  assert.equal((await post(c, 'subscribe', form, { ip: '5.5.5.5' })).location, 'https://apensum.ch/fr/news/verifier/');
  assert.equal(sent.length, 1);
  advance(NEWSLETTER_MAIL_GAP_MS + 1);
  await post(c, 'subscribe', form, { ip: '5.5.5.5' });
  assert.equal(sent.length, 2, 'a new link after the gap; the old one no longer works');
  assert.equal((await page(c, 'confirm', tokenOf(sent[0]))).status, 404);
  await page(c, 'confirm', tokenOf(sent[1]));
  assert.equal(rows[0].status, 'confirmed');
  advance(NEWSLETTER_MAIL_GAP_MS + 1);
  // Confirmed: answered like any other, nothing sent.
  assert.equal((await post(c, 'subscribe', form, { ip: '6.6.6.6' })).location, 'https://apensum.ch/fr/news/verifier/');
  assert.equal(sent.length, 2);
});

test('a confirmation link expires; an invalid token shows the invalid page', async () => {
  const { c, rows, sent, advance } = setup();
  await post(c, 'subscribe', form);
  advance(NEWSLETTER_CONFIRM_DAYS * 24 * 3600 * 1000 + 1);
  const expired = await page(c, 'confirm', tokenOf(sent[0]));
  assert.equal(expired.status, 404);
  assert.equal(rows[0].status, 'pending');
  assert.equal((await page(c, 'confirmPage', 'nope')).status, 404);
  assert.equal((await page(c, 'confirmPage', 'x'.repeat(43))).status, 404);
});

test('unsubscribing from the website mails a link only to a subscribed address; the answer is the same either way', async () => {
  const { c, rows, sent, advance } = setup();
  await post(c, 'subscribe', form);
  await page(c, 'confirm', tokenOf(sent[0]));
  advance(NEWSLETTER_MAIL_GAP_MS + 1);
  const back = { email: 'anna@example.ch', ok: '/fr/news/desinscription/', fail: '/fr/news/erreur/' };
  assert.equal((await post(c, 'unsubscribeRequest', back)).location, 'https://apensum.ch/fr/news/desinscription/');
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /désinscription/);
  assert.match(sent[1].text, /\/public\/newsletter\/unsubscribe\?t=/);
  assert.equal((await post(c, 'unsubscribeRequest', { ...back, email: 'nobody@example.ch' }, { ip: '7.7.7.7' })).location, 'https://apensum.ch/fr/news/desinscription/');
  assert.equal(sent.length, 2, 'unknown address: nothing sent, same answer');

  const token = tokenOf(sent[1]);
  assert.match((await page(c, 'unsubscribePage', token)).html!, /Se désinscrire/);
  assert.equal(rows[0].status, 'confirmed', 'opening the link changes nothing');
  await page(c, 'unsubscribe', token);
  assert.equal(rows[0].status, 'unsubscribed');
  // Subscribing again later starts over with a confirmation.
  advance(NEWSLETTER_MAIL_GAP_MS + 1);
  await post(c, 'subscribe', form, { ip: '8.8.8.8' });
  assert.equal(rows[0].status, 'pending');
});

test('other websites, bots, bad addresses and floods are refused', async () => {
  const { c, sent } = setup();
  assert.equal((await post(c, 'subscribe', form, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(c, 'subscribe', { ...form, website: 'http://spam' })).location, 'https://apensum.ch/fr/news/verifier/');
  assert.equal((await post(c, 'subscribe', { ...form, email: 'nope' })).location, 'https://apensum.ch/fr/news/erreur/');
  assert.equal(sent.length, 0);
  for (let i = 0; i < NEWSLETTER_LIMIT_PER_IP; i++) await post(c, 'subscribe', { ...form, email: `p${i}@example.ch` }, { ip: '9.9.9.9' });
  assert.equal((await post(c, 'subscribe', { ...form, email: 'last@example.ch' }, { ip: '9.9.9.9' })).location, 'https://apensum.ch/fr/news/erreur/');
});

test('mails and pages exist in every language, and the page escapes what it shows', () => {
  for (const lang of ['de', 'fr', 'it', 'en'] as const) {
    const m = newsletterMail('confirm', 'a@b.ch', lang, 'https://x/confirm?t=abc');
    assert.ok(m.subject && m.text.includes('https://x/confirm?t=abc') && !m.text.includes('{{'), lang);
  }
  const html = newsletterPage('de', { title: '<b>', text: '"x"' });
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /&quot;x&quot;/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});
