import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_LIMIT_PER_IP, SiteContactController, allowedOrigins, contactMail, safeBackPath, spamReason } from '../../apps/api/src/site-contact.controller';
import type { MailOptions } from '../../apps/api/src/mailer';

const form = { name: 'Anna Muster', email: 'anna@example.ch', organization: 'Muster AG', message: 'Wir haben 40 Mitarbeitende.', lang: 'de', ok: '/de/kontakt/danke/', fail: '/de/kontakt/fehler/' };

function run(controller: SiteContactController, body: object, origin = 'https://apensum.ch', ip = '1.2.3.4') {
  const out: { status?: number; location?: string; json?: unknown } = {};
  const res = {
    redirect: (status: number, location: string) => { out.status = status; out.location = location; },
    status: (s: number) => ({ json: (j: unknown) => { out.status = s; out.json = j; } }),
  };
  const req = { headers: { origin, 'x-forwarded-for': `${ip}, 10.0.0.1` }, socket: {} };
  return controller.submit(body as never, req as never, res as never).then(() => out);
}

function controller() {
  const c = new SiteContactController();
  const sent: MailOptions[] = [];
  c.send = async (m) => { sent.push(m); };
  return { c, sent };
}

test('the mail goes to the fixed address, the visitor is only the Reply-To', () => {
  const mail = contactMail({ ...form, name: 'Anna\r\nBcc: x@evil.ch' }, 'info@apensum.ch')!;
  assert.equal(mail.to, 'info@apensum.ch');
  assert.equal(mail.replyTo, 'anna@example.ch');
  assert.equal(mail.subject, '[Website] Allgemeine Frage: Anna Bcc: x@evil.ch');
  assert.match(mail.text, /^Thema: Allgemeine Frage\n/);
  assert.match(mail.text, /Organisation: Muster AG\n/);
  assert.match(mail.text, /Wir haben 40 Mitarbeitende\./);
  assert.equal(contactMail({ ...form, email: 'nope' }, 'x@y.ch'), null);
  assert.equal(contactMail({ ...form, name: ' ' }, 'x@y.ch'), null);
  assert.equal(contactMail({ ...form, message: '' }, 'x@y.ch'), null);
});

test('only the website may post, and only back to its own pages', () => {
  assert.deepEqual(allowedOrigins('https://a.ch/, https://b.ch'), ['https://a.ch', 'https://b.ch']);
  assert.ok(allowedOrigins(undefined).includes('https://apensum.ch'));
  assert.equal(safeBackPath('/fr/contact/merci/'), '/fr/contact/merci/');
  for (const bad of ['//evil.ch/', 'https://evil.ch/', '/de/kontakt/danke', '/de/../x/y/', 5]) assert.equal(safeBackPath(bad), '/');
});

test('a valid form is sent and the visitor lands on the thank-you page', async () => {
  const { c, sent } = controller();
  assert.deepEqual(await run(c, form), { status: 303, location: 'https://apensum.ch/de/kontakt/danke/' });
  assert.equal(sent.length, 1);
  assert.deepEqual(await run(c, { ...form, email: 'x' }), { status: 303, location: 'https://apensum.ch/de/kontakt/fehler/' });
  assert.deepEqual(await run(c, form, 'https://evil.ch'), { status: 403, json: { ok: false, error: 'forbidden' } });
  assert.equal(sent.length, 1);
});

test('bots (honeypot) get a thank-you and no mail; too many posts are refused', async () => {
  const { c, sent } = controller();
  assert.equal((await run(c, { ...form, website: 'http://spam' })).location, 'https://apensum.ch/de/kontakt/danke/');
  assert.equal(sent.length, 0);
  for (let i = 0; i < CONTACT_LIMIT_PER_IP; i++) await run(c, form, undefined, '9.9.9.9');
  assert.equal((await run(c, form, undefined, '9.9.9.9')).location, 'https://apensum.ch/de/kontakt/fehler/');
  assert.equal((await run(c, form, undefined, '8.8.8.8')).location, 'https://apensum.ch/de/kontakt/danke/');
  assert.equal(sent.length, CONTACT_LIMIT_PER_IP + 1);
});

test('a mail failure sends the visitor to the error page', async () => {
  const { c } = controller();
  c.send = async () => { throw new Error('smtp down'); };
  assert.equal((await run(c, form)).location, 'https://apensum.ch/de/kontakt/fehler/');
});

test('the topic from the form names the subject; unknown topics count as general', () => {
  assert.equal(contactMail({ ...form, topic: 'pricing' }, 'x@y.ch')!.subject, '[Website] Anpassung / Offerte: Anna Muster');
  assert.equal(contactMail({ ...form, topic: 'invest' }, 'x@y.ch')!.subject, '[Website] Investition / Partnerschaft: Anna Muster');
  assert.equal(contactMail({ ...form, topic: 'constructor' }, 'x@y.ch')!.subject, '[Website] Allgemeine Frage: Anna Muster');
});

test('bot signs: sent within seconds, links in the name, a message full of links', () => {
  assert.equal(spamReason(form), null);
  assert.equal(spamReason({ ...form, elapsed: '' }), null, 'no JavaScript: no time, still accepted');
  assert.equal(spamReason({ ...form, elapsed: '45000' }), null);
  assert.equal(spamReason({ ...form, elapsed: '800' }), 'too-fast');
  assert.equal(spamReason({ ...form, name: 'Cheap pills www.spam.example' }), 'link-in-name');
  assert.equal(spamReason({ ...form, organization: 'https://seo.example' }), 'link-in-name');
  assert.equal(spamReason({ ...form, message: 'See https://a.ch, https://b.ch and www.c.ch' }), null);
  assert.equal(spamReason({ ...form, message: 'http://1 http://2 https://3 www.4' }), 'too-many-links');
});

test('a bot-like post gets the thank-you page and sends nothing', async () => {
  const { c, sent } = controller();
  assert.equal((await run(c, { ...form, elapsed: '500' })).location, 'https://apensum.ch/de/kontakt/danke/');
  assert.equal(sent.length, 0);
  await run(c, { ...form, elapsed: '20000', topic: 'demo' });
  assert.equal(sent[0].subject, '[Website] Vorführung: Anna Muster');
});
