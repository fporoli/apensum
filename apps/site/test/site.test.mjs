import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DICTS, build, missingOperatorFields } from '../build.mjs';
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
    for (const p of paths) assert.match(p, /^\/[a-z]{2}\/([a-z-]+\/)?$/, p);
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
      // The phone number is only behind the reveal button, never readable in the HTML.
      const digits = fullConfig.operator.phone.replace(/\D/g, '');
      assert.ok(!html.replace(/\D/g, ' ').includes(digits.slice(-7)) && !html.includes(fullConfig.operator.phone), `${file}: phone in plain text`);
      // Only same-site resources: no external src= and no external stylesheet.
      for (const m of html.matchAll(/\s(?:src|href|poster)="([^"]+)"/g)) {
        const url = m[1];
        if (/^(mailto:|#)/.test(url) || [fullConfig.appUrl, fullConfig.demoUrl, fullConfig.about.linkedin].includes(url)) continue;
        if (/^https:\/\//.test(url)) {
          assert.ok(url.startsWith(`https://${fullConfig.domain}/`), `${file}: external link ${url}`);
          continue;
        }
        const path = url.split(/[?#]/)[0];
        const target = path.endsWith('/') ? join(out, path, 'index.html') : join(out, path);
        assert.ok(existsSync(target), `${file}: broken link ${url}`);
      }
    }
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
    assert.match(contact, /<form class="card contact-card contact-form" method="post" action="https:\/\/api\.example\.ch\/api\/v1\/public\/contact">/);
    assert.match(contact, /<input type="hidden" name="ok" value="\/fr\/contact\/merci\/">/);
    assert.match(contact, /<input type="hidden" name="fail" value="\/fr\/contact\/erreur\/">/);
    assert.match(contact, /<label class="hp" aria-hidden="true">[^<]*<input name="website" tabindex="-1"/);
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
    // Without a contact URL there is no form, only the e-mail button.
    const contact = readFileSync(join(out, 'de', 'kontakt', 'index.html'), 'utf8');
    assert.doesNotMatch(contact, /<form/);
    assert.match(contact, /href="mailto:info@apensum\.ch\?subject=/);
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
