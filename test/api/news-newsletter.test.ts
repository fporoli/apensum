import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  SITE_NEWS_SLUGS, newsletterIssue, newsUnsubscribeToken, publicPostHtml, sitePostUrl, verifyNewsUnsubscribeToken,
} from '../../apps/api/src/news-newsletter';
import { publicSummary } from '../../apps/api/src/public-news.controller';
import de from '../../apps/site/src/i18n/de.mjs';
import fr from '../../apps/site/src/i18n/fr.mjs';
import it from '../../apps/site/src/i18n/it.mjs';
import en from '../../apps/site/src/i18n/en.mjs';

const POST = '11111111-2222-3333-4444-555555555555';
const DOC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const API = 'https://api.apensum.ch/api/v1';

test('the post links match the website News page of each language', () => {
  for (const [lang, dict] of Object.entries({ de, fr, it, en })) assert.equal(SITE_NEWS_SLUGS[lang], (dict as Record<string, string>)['slug.news'], lang);
  assert.equal(sitePostUrl('https://apensum.ch/', 'fr', POST), `https://apensum.ch/fr/actualites/?post=${POST}`);
  assert.equal(sitePostUrl('https://wwwpp.apensum.ch', 'es', POST), `https://wwwpp.apensum.ch/de/news/?post=${POST}`);
});

test('a public post as HTML: pictures from the public API, only its own document references, escaped', () => {
  const html = publicPostHtml(`Hallo <b>\n\n![Bild](doc:${DOC})\n\n![x](https://evil.example/x.png)`, API, POST);
  assert.match(html, /Hallo &lt;b&gt;/);
  assert.ok(html.includes(`<img src="${API}/public/news/${POST}/images/${DOC}" alt="Bild"`));
  assert.doesNotMatch(html, /evil\.example/);
});

test('the unsubscribe token is signed and bound to the subscriber', () => {
  const id = '0e9c8b1a-1111-2222-3333-444455556666';
  const token = newsUnsubscribeToken(id);
  assert.match(token, /^[A-Za-z0-9_-]{20,100}$/, 'passes the link check of site-newsletter');
  assert.equal(verifyNewsUnsubscribeToken(token), id);
  assert.equal(verifyNewsUnsubscribeToken(token.replace(id, '0e9c8b1a-1111-2222-3333-444455556667')), null);
  assert.equal(verifyNewsUnsubscribeToken('random-token-from-a-confirm-mail-xxxxxxxxx'), null);
});

test('the newsletter mail: subscriber language, HTML and text, browser and unsubscribe links, one-click header', () => {
  const post = { id: POST, texts: { de: { title: 'Neu: Spesen', body: 'Text mit **fett**\n\n- eins\n- zwei' }, fr: { title: 'Nouveau : frais', body: 'Texte <script>' } } };
  const links = { apiRoot: API, siteUrl: 'https://apensum.ch/fr/actualites/?post=1', unsubscribeUrl: `${API}/public/newsletter/unsubscribe?t=abc` };
  const fr = newsletterIssue(post, { lang: 'fr' }, links)!;
  assert.equal(fr.subject, 'Nouveau : frais');
  assert.match(fr.html, /<html lang="fr">/);
  assert.match(fr.html, /Texte &lt;script&gt;/);
  assert.match(fr.html, /Lire dans le navigateur/);
  assert.match(fr.text, /Se désinscrire: https:\/\/api\.apensum\.ch\/api\/v1\/public\/newsletter\/unsubscribe\?t=abc/);
  assert.deepEqual(fr.headers, { 'List-Unsubscribe': `<${links.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  const it = newsletterIssue(post, { lang: 'it' }, links)!;
  assert.equal(it.subject, 'Neu: Spesen', 'no Italian text: German');
  assert.match(it.text, /Text mit fett\n\n- eins\n- zwei/);
  assert.match(it.text, /Disiscriversi/, 'the frame in the subscriber language');
});

test('the public list shows the title and the start of the text', () => {
  const s = publicSummary({ de: { title: 'T', body: `## Kopf\n\n${'wort '.repeat(100)}` } }, 'en')!;
  assert.equal(s.lang, 'de');
  assert.ok(s.summary.startsWith('Kopf wort') && s.summary.endsWith(' …') && s.summary.length < 300);
});
