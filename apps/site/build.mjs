// Builds the Apensum website into dist/: every page in de/fr/it/en, a language chooser at /
// (the server redirects / by Accept-Language, infra/site/Caddyfile), 404, sitemap and robots.
// No dependencies: templates are functions in src/, texts in src/i18n/<lang>.mjs.
//   node build.mjs            build (warns about an incomplete legal notice)
//   node build.mjs --strict   fail instead (the deploy uses this)
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig, { REQUIRED_OPERATOR_FIELDS } from './site.config.mjs';
import { LANGS, LANG_NAMES, NEWS_RESULTS, PAGES, context, esc, newsResultPath, pagePath, translator } from './src/layout.mjs';
import { RENDER, contactResult, contactResultPath, newsResult } from './src/pages.mjs';
import { logoMark } from './src/icons.mjs';
import de from './src/i18n/de.mjs';
import fr from './src/i18n/fr.mjs';
import it from './src/i18n/it.mjs';
import en from './src/i18n/en.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const DICTS = { de, fr, it, en };

/** Width and height of a JPEG (its first SOF marker), for <img> sizes; null when unreadable. */
export function jpegSize(data) {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

export function missingOperatorFields(config) {
  return REQUIRED_OPERATOR_FIELDS.filter((f) => !String(config.operator?.[f] ?? '').trim());
}

/** A plain page outside the per-language tree (/ and 404), with all four languages. */
function multilingual({ title, blocks, assets, noindex }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  <meta name="theme-color" content="#1a56db">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${assets.css}">
</head>
<body class="chooser">
  <main class="wrap chooser-main">
    <div class="brand">${logoMark(40)}<span class="wordmark">a<b>pensum</b></span></div>
    ${blocks}
  </main>
</body>
</html>
`;
}

export function build({ outDir = join(ROOT, 'dist'), strict = false, config = baseConfig, log = console, mediaDir = join(ROOT, 'media') } = {}) {
  const missing = missingOperatorFields(config);
  if (missing.length) {
    const msg = `site: the legal notice (Impressum) lacks operator.${missing.join(', operator.')} in apps/site/site.config.mjs`;
    if (strict) throw new Error(msg);
    log.warn(`WARNING ${msg}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  cpSync(join(ROOT, 'static'), outDir, { recursive: true });
  // Assets are cached for a year (infra/site/Caddyfile): the ?v= content hash makes a change visible.
  const versioned = (name) => `/assets/${name}?v=${createHash('sha256').update(readFileSync(join(ROOT, 'static', 'assets', name))).digest('hex').slice(0, 10)}`;
  const assets = { css: versioned('site.css'), reveal: versioned('reveal.js'), contact: versioned('contact.js'), media: {}, mediaSize: {} };
  // Demo videos and posters (apps/site/media, not in git: recorded by videos/record.mjs, deployed
  // from the site-media release). Pages show only what is there.
  if (existsSync(mediaDir)) {
    mkdirSync(join(outDir, 'media'), { recursive: true });
    for (const name of readdirSync(mediaDir).filter((f) => /^[\w.-]+\.(mp4|webm|jpg|png)$/.test(f))) {
      const data = readFileSync(join(mediaDir, name));
      writeFileSync(join(outDir, 'media', name), data);
      assets.media[name] = `/media/${name}?v=${createHash('sha256').update(data).digest('hex').slice(0, 10)}`;
      if (name.endsWith('.jpg')) assets.mediaSize[name] = jpegSize(data);
    }
  }

  const files = [];
  const write = (path, content) => {
    const file = join(outDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    files.push(path);
  };

  for (const lang of LANGS) {
    for (const page of PAGES) {
      const ctx = context(DICTS, lang, page, config, assets);
      write(join(pagePath(DICTS, lang, page), 'index.html'), RENDER[page](ctx));
    }
    // Where the contact form's server sends the visitor back to (not in the sitemap).
    for (const kind of ['thanks', 'failed']) {
      write(join(contactResultPath(DICTS, lang, kind), 'index.html'), contactResult(context(DICTS, lang, 'contact', config, assets), kind));
    }
    // The same for the news forms (site-newsletter.controller.ts), only when there is an API to post to.
    if (config.contactUrl) {
      for (const kind of Object.keys(NEWS_RESULTS)) {
        write(join(newsResultPath(DICTS, lang, kind), 'index.html'), newsResult(context(DICTS, lang, 'news', config, assets), kind));
      }
    }
  }

  // / : the server redirects by browser language; this is the fallback (and what crawlers see).
  const choose = LANGS.map((l) => {
    const t = translator(DICTS[l], l);
    return `<a class="chooser-option" href="/${l}/" hreflang="${l}" lang="${l}"><strong>${LANG_NAMES[l]}</strong><span>${t('root.tagline')}</span></a>`;
  }).join('\n    ');
  write('index.html', multilingual({ title: 'Apensum', assets, blocks: `<nav class="chooser-list" aria-label="Language / Sprache / Langue / Lingua">\n    ${choose}\n    </nav>` }));

  const notFound = LANGS.map((l) => {
    const t = translator(DICTS[l], l);
    return `<section lang="${l}"><h1>${t('notFound.title')}</h1><p>${t('notFound.text')}</p><a href="/${l}/">${t('notFound.home')}</a></section>`;
  }).join('\n    ');
  write('404.html', multilingual({ title: 'Apensum – 404', assets, noindex: true, blocks: `<div class="not-found">${notFound}</div>` }));

  const origin = `https://${config.domain}`;
  const urls = PAGES.flatMap((page) =>
    LANGS.map((lang) => {
      const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${origin}${pagePath(DICTS, l, page)}"/>`).join('');
      return `<url><loc>${origin}${pagePath(DICTS, lang, page)}</loc>${alts}</url>`;
    }),
  );
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${esc(origin)}/sitemap.xml\n`);
  return { outDir, files, missing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { outDir, files } = build({ strict: process.argv.includes('--strict') });
    console.log(`site: ${files.length} files in ${outDir}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
