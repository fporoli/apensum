import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DICTS, build, jpegSize, missingOperatorFields } from '../build.mjs';
import { LANGS, PAGES, pagePath } from '../src/layout.mjs';
import { preferredLang } from '../serve.mjs';
import baseConfig from '../site.config.mjs';

const placeholders = (v) => [...JSON.stringify(v).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const fullConfig = { ...baseConfig, appUrl: 'https://app.example.ch', contactUrl: 'https://api.example.ch/api/v1/public/contact', operator: { ...baseConfig.operator, name: 'Test Person', street: 'Weg 1', city: '8000 Zürich' } };

test('every language has the same texts as English', () => {
  const ref = DICTS.en;
  for (const lang of LANGS) {
    const dict = DICTS[lang];
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(ref).sort(), `${lang}: keys differ from en`);
    for (const key of Object.keys(ref)) {
      assert.equal(Array.isArray(dict[key]), Array.isArray(ref[key]), `${lang} ${key}: list vs text`);
      if (Array.isArray(ref[key])) assert.equal(dict[key].length, ref[key].length, `${lang} ${key}: list length`);
      assert.deepEqual(placeholders(dict[key]), placeholders(ref[key]), `${lang} ${key}: placeholders`);
      assert.ok(JSON.stringify(dict[key]).trim().length > 2, `${lang} ${key}: empty`);
    }
  }
});

test('German texts use Swiss spelling (no ß)', () => {
  assert.doesNotMatch(JSON.stringify(DICTS.de), /ß/);
});

test('slugs are unique per language and URL-safe', () => {
  for (const lang of LANGS) {
    const paths = PAGES.map((p) => pagePath(DICTS, lang, p));
    assert.equal(new Set(paths).size, paths.length, lang);
    // One or two levels: the Working Hours Act page lives under Security.
    for (const p of paths) assert.match(p, /^\/[a-z]{2}\/([a-z-]+\/){0,2}$/, p);
  }
});

test('builds every page; internal links resolve; nothing loads from third parties', () => {
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  try {
    const { files, missing } = build({ outDir: out, config: fullConfig, log: { warn() {} } });
    assert.deepEqual(missing, []);
    for (const lang of LANGS) for (const page of PAGES) assert.ok(files.includes(join(pagePath(DICTS, lang, page), 'index.html')), `${lang} ${page}`);
    for (const f of ['index.html', '404.html', 'sitemap.xml', 'robots.txt', 'favicon.svg', 'assets/site.css']) assert.ok(existsSync(join(out, f)), f);

    for (const file of files.filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(out, file), 'utf8');
      assert.doesNotMatch(html, /\{\{\w+\}\}/, `${file}: unfilled placeholder`);
      assert.doesNotMatch(html, /undefined|\[object Object\]/, `${file}: rendering bug`);
      // No mailto: links (they do nothing without a mail program): buttons lead to the contact form.
      assert.doesNotMatch(html, /mailto:/, `${file}: mailto link`);
      // The phone number is only behind the reveal button, never readable in the HTML.
      const digits = fullConfig.operator.phone.replace(/\D/g, '');
      assert.ok(!html.replace(/\D/g, ' ').includes(digits.slice(-7)) && !html.includes(fullConfig.operator.phone), `${file}: phone in plain text`);
      // Only same-site resources: no external src= and no external stylesheet.
      for (const m of html.matchAll(/\s(?:src|href|poster)="([^"]+)"/g)) {
        const url = m[1];
        if (/^#/.test(url) || [fullConfig.appUrl, fullConfig.demoUrl, fullConfig.about.linkedin, fullConfig.sourceUrl, fullConfig.lawSourceUrl].includes(url)) continue;
        // Files in the source repository (the plugin page links its developer docs).
        if (fullConfig.sourceUrl && url.startsWith(`${fullConfig.sourceUrl.replace(/\/$/, '')}/blob/`)) continue;
        if (/^https:\/\//.test(url)) {
          assert.ok(url.startsWith(`https://${fullConfig.domain}/`), `${file}: external link ${url}`);
          continue;
        }
        const path = url.split(/[?#]/)[0];
        const target = path.endsWith('/') ? join(out, path, 'index.html') : join(out, path);
        assert.ok(existsSync(target), `${file}: broken link ${url}`);
      }
    }
    // News: the forms post to the same API as the contact form and come back to their result pages.
    const newsApi = fullConfig.contactUrl.replace(/\/contact$/, '/newsletter');
    const news = readFileSync(join(out, 'de', 'news', 'index.html'), 'utf8');
    assert.match(news, new RegExp(`action="${newsApi}/subscribe"`));
    assert.match(news, new RegExp(`action="${newsApi}/unsubscribe-request"`));
    assert.match(news, /name="ok" value="\/de\/news\/pruefen\/"/);
    assert.match(news, /name="website"/, 'honeypot');
    for (const kind of ['pruefen', 'abmelden', 'fehler']) assert.ok(existsSync(join(out, 'de', 'news', kind, 'index.html')), kind);
    assert.match(readFileSync(join(out, 'fr', 'contact', 'index.html'), 'utf8'), new RegExp(`class="news-form compact" method="post" action="${newsApi}/subscribe"`), 'the footer form on every page');
    assert.match(readFileSync(join(out, 'de', 'datenschutz', 'index.html'), 'utf8'), /<h2 id="newsletter">/);
    const home = readFileSync(join(out, 'de', 'index.html'), 'utf8');
    assert.match(home, /<html lang="de">/);
    for (const lang of LANGS) assert.match(home, new RegExp(`hreflang="${lang}" href="https://${fullConfig.domain}/${lang}/"`));
    assert.match(readFileSync(join(out, 'fr', 'index.html'), 'utf8'), /Canton VD/);
    assert.match(readFileSync(join(out, 'sitemap.xml'), 'utf8'), /\/it\/sicurezza\//);
    // Every "Demo" button goes to the live demo; prices and the operator are on their pages.
    assert.match(home, new RegExp(`class="btn btn-primary btn-sm" href="${fullConfig.demoUrl}">Demo<`));
    // The hourly rate is only in the popup behind a button ("ab CHF 120.–"), and 130 nowhere.
    const pricing = readFileSync(join(out, 'de', 'preise', 'index.html'), 'utf8');
    assert.match(pricing, /<button type="button" class="rate-button" popovertarget="rate">/);
    assert.match(pricing, /<div id="rate" popover[^>]*>[\s\S]*<span>ab<\/span><strong>CHF&nbsp;120\.–<\/strong>/);
    assert.doesNotMatch(pricing, /130/);
    assert.match(readFileSync(join(out, 'fr', 'a-propos', 'index.html'), 'utf8'), /Bonjour, je suis Test Person, ingénieur/);
    const impressum = readFileSync(join(out, 'de', 'impressum', 'index.html'), 'utf8');
    assert.match(impressum, /<dt>Betreiber<\/dt><dd>Test Person<\/dd>/);
    // The reveal button decodes back to the number, and its script is on that page.
    const encoded = impressum.match(/data-v="([^"]+)"/)[1];
    assert.equal([...Buffer.from(encoded, 'base64').toString('utf8')].reverse().join(''), fullConfig.operator.phone);
    assert.match(impressum, /<script src="\/assets\/reveal\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    assert.doesNotMatch(home, /reveal\.js/);
    // The contact form posts to the API and names the pages it comes back to, which exist.
    const contact = readFileSync(join(out, 'fr', 'contact', 'index.html'), 'utf8');
    assert.match(contact, /<form id="contact-form" class="card contact-card contact-form" method="post" action="https:\/\/api\.example\.ch\/api\/v1\/public\/contact">/);
    assert.match(contact, /<input type="hidden" name="ok" value="\/fr\/contact\/merci\/">/);
    assert.match(contact, /<input type="hidden" name="fail" value="\/fr\/contact\/erreur\/">/);
    assert.match(contact, /<label class="hp" aria-hidden="true">[^<]*<input name="website" tabindex="-1"/);
    assert.match(contact, /<select name="topic"><option value="general">[^<]+<\/option><option value="demo">/);
    assert.match(contact, /<input type="hidden" name="elapsed" value="">/);
    assert.match(contact, /<script src="\/assets\/contact\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    assert.doesNotMatch(home, /contact\.js/);
    // The buttons that used to open the mail program now open the form with their topic.
    assert.match(pricing, /href="\/de\/kontakt\/\?topic=pricing#contact-form"/);
    assert.match(readFileSync(join(out, 'de', 'ueber-uns', 'index.html'), 'utf8'), /href="\/de\/kontakt\/\?topic=invest#contact-form"/);
    assert.match(impressum, /<span class="email">info@apensum\.ch<\/span>/);
    for (const page of ['de/kontakt/danke', 'de/kontakt/fehler', 'it/contatto/grazie', 'en/contact/error']) {
      const html = readFileSync(join(out, page, 'index.html'), 'utf8');
      assert.match(html, /<meta name="robots" content="noindex">/, page);
    }
    assert.doesNotMatch(readFileSync(join(out, 'sitemap.xml'), 'utf8'), /danke/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a strict build refuses an incomplete legal notice', () => {
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  try {
    // contactUrl set explicitly: the deploy runs these tests with SITE_CONTACT_URL in the environment.
    const empty = { ...baseConfig, contactUrl: '', operator: { ...baseConfig.operator, name: '', street: '', city: '' } };
    assert.deepEqual(missingOperatorFields(empty), ['name', 'street', 'city']);
    assert.throws(() => build({ outDir: out, strict: true, config: empty }), /Impressum/);
    const warnings = [];
    build({ outDir: out, config: empty, log: { warn: (m) => warnings.push(m) } });
    assert.equal(warnings.length, 1);
    // Without a contact URL there is no form, only the address to copy.
    const contact = readFileSync(join(out, 'de', 'kontakt', 'index.html'), 'utf8');
    assert.doesNotMatch(contact, /<form|contact\.js/);
    assert.match(contact, /<span class="email">info@apensum\.ch<\/span>/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('/ picks the browser language, German otherwise', () => {
  assert.equal(preferredLang('fr-CH,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(preferredLang('it'), 'it');
  assert.equal(preferredLang('en-US,en'), 'en');
  assert.equal(preferredLang('es-ES'), 'de');
  assert.equal(preferredLang(undefined), 'de');
});

test('the home page shows the role videos when all four are there, cards otherwise', () => {
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  const media = join(out, 'media-src');
  try {
    mkdirSync(media);
    const quiet = { warn() {} };
    build({ outDir: join(out, 'a'), config: fullConfig, log: quiet, mediaDir: media });
    let html = readFileSync(join(out, 'a', 'de', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<video/);
    assert.match(html, /class="grid grid-4"/);

    for (const r of ['employee', 'manager', 'hr', 'admin']) {
      writeFileSync(join(media, `demo-${r}.mp4`), `video ${r}`);
      writeFileSync(join(media, `demo-${r}.jpg`), `poster ${r}`);
    }
    build({ outDir: join(out, 'b'), config: fullConfig, log: quiet, mediaDir: media });
    html = readFileSync(join(out, 'b', 'de', 'index.html'), 'utf8');
    assert.equal((html.match(/<video /g) ?? []).length, 4);
    assert.match(html, /<source src="\/media\/demo-hr\.mp4\?v=[0-9a-f]{10}" type="video\/mp4">/);
    assert.match(html, /poster="\/media\/demo-hr\.jpg\?v=[0-9a-f]{10}"/);
    assert.ok(existsSync(join(out, 'b', 'media', 'demo-admin.mp4')));
    assert.doesNotMatch(html, /Video auf Deutsch/);
    assert.match(readFileSync(join(out, 'b', 'fr', 'index.html'), 'utf8'), /Vidéo en allemand/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

/** The smallest JPEG header jpegSize reads: SOI, then a SOF0 segment with height and width. */
const fakeJpeg = (width, height) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('feature screenshots: sized, in the page language or German, the developer video', () => {
  assert.deepEqual(jpegSize(fakeJpeg(2080, 1512)), { width: 2080, height: 1512 });
  assert.equal(jpegSize(Buffer.from('not a jpeg')), null);
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  const media = join(out, 'media-src');
  try {
    mkdirSync(media);
    writeFileSync(join(media, 'feature-time-1-de.jpg'), fakeJpeg(400, 300));
    writeFileSync(join(media, 'feature-time-1-fr.jpg'), fakeJpeg(400, 300));
    writeFileSync(join(media, 'feature-admin-1-de.jpg'), fakeJpeg(800, 500));
    writeFileSync(join(media, 'demo-developer.mp4'), 'video');
    build({ outDir: join(out, 'a'), config: fullConfig, log: { warn() {} }, mediaDir: media });
    const de = readFileSync(join(out, 'a', 'de', 'funktionen', 'index.html'), 'utf8');
    assert.match(de, /<img src="\/media\/feature-time-1-de\.jpg\?v=[0-9a-f]{10}" alt="[^"]+" loading="lazy" decoding="async" width="400" height="300">/);
    // The languages group shows the dashboard in the other languages that exist (fr; it is missing: de).
    assert.match(de, /<section class="feature-group" id="languages">[\s\S]*feature-time-1-fr\.jpg[\s\S]*<\/section>/);
    assert.match(de, /<section class="feature-group" id="customize">[\s\S]*<video[^>]*>\s*<source src="\/media\/demo-developer\.mp4/);
    // No French admin shot: the German one.
    const fr = readFileSync(join(out, 'a', 'fr', 'fonctionnalites', 'index.html'), 'utf8');
    assert.match(fr, /feature-admin-1-de\.jpg/);
    assert.match(fr, /feature-time-1-fr\.jpg/);
    // Groups without pictures have none.
    assert.doesNotMatch(de, /<section class="feature-group" id="project">[\s\S]*?<img[\s\S]*?<\/section>\s*<section class="feature-group" id="absences">/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('references page: no references yet, first customers contact us under their own topic', () => {
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  try {
    build({ outDir: out, config: fullConfig, log: { warn() {} } });
    const de = readFileSync(join(out, 'de', 'referenzen', 'index.html'), 'utf8');
    assert.match(de, /Noch keine Referenzen/);
    assert.match(de, /href="\/de\/kontakt\/\?topic=pilot#contact-form"/);
    assert.match(de, /href="\/de\/preise\/"/);
    // The hourly rate stays on the pricing page.
    assert.doesNotMatch(de, /CHF|120|130/);
    assert.match(readFileSync(join(out, 'fr', 'contact', 'index.html'), 'utf8'), /<option value="pilot">Premiers clients \/ pilote<\/option>/);
    assert.match(readFileSync(join(out, 'it', 'index.html'), 'utf8'), /<a href="\/it\/referenze\/">Referenze<\/a>/, 'in the menu');
    // HTML handed to a text placeholder would be shown as code.
    for (const page of ['de/news', 'de/news/fehler']) assert.doesNotMatch(readFileSync(join(out, page, 'index.html'), 'utf8'), /&lt;span/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('news posts: the News page loads them from the API with news.js; nothing without an API', () => {
  const out = mkdtempSync(join(tmpdir(), 'apensum-site-'));
  try {
    build({ outDir: join(out, 'a'), config: fullConfig, log: { warn() {} } });
    const fr = readFileSync(join(out, 'a', 'fr', DICTS.fr['slug.news'], 'index.html'), 'utf8');
    assert.match(fr, /<div id="news-posts" class="news-posts" data-api="https:\/\/api\.example\.ch\/api\/v1\/public\/news" data-lang="fr" data-locale="fr-CH"/);
    assert.match(fr, /<script src="\/assets\/news\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    assert.match(fr, /<noscript>/);
    assert.doesNotMatch(readFileSync(join(out, 'a', 'fr', 'index.html'), 'utf8'), /news\.js/, 'only on the News page');
    build({ outDir: join(out, 'b'), config: { ...fullConfig, contactUrl: '' }, log: { warn() {} } });
    const de = readFileSync(join(out, 'b', 'de', 'news', 'index.html'), 'utf8');
    assert.doesNotMatch(de, /news-posts|news\.js/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
