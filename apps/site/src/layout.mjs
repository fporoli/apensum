import { githubMark, icon, logoMark } from './icons.mjs';

export const LANGS = ['de', 'fr', 'it', 'en'];
export const DEFAULT_LANG = 'de';
export const LOCALES = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-GB' };
export const LANG_NAMES = { de: 'Deutsch', fr: 'Français', it: 'Italiano', en: 'English' };
/** Pages per language; every page but home has a translated slug (`slug.<page>`). */
export const PAGES = ['home', 'features', 'cases', 'expenses', 'roster', 'plugins', 'pricing', 'security', 'law', 'support', 'about', 'references', 'contact', 'news', 'impressum', 'privacy'];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/**
 * `t(key, vars)` returns the escaped text, `t.list(key)` an array of escaped lines. A missing key
 * or placeholder throws, so a gap in a dictionary fails the build instead of shipping.
 */
export function translator(dict, lang) {
  const raw = (key) => {
    if (!(key in dict)) throw new Error(`site: missing ${lang} text "${key}"`);
    return dict[key];
  };
  const fill = (s, vars, key) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!vars || !(k in vars)) throw new Error(`site: ${lang} "${key}" needs {{${k}}}`);
      return vars[k];
    });
  const t = (key, vars) => {
    const v = raw(key);
    if (typeof v !== 'string') throw new Error(`site: ${lang} "${key}" is a list`);
    return esc(fill(v, vars, key));
  };
  t.list = (key, vars) => {
    const v = raw(key);
    if (!Array.isArray(v)) throw new Error(`site: ${lang} "${key}" is not a list`);
    return v.map((s) => esc(vars ? fill(s, vars, key) : s));
  };
  return t;
}

export function pagePath(dicts, lang, page) {
  return page === 'home' ? `/${lang}/` : `/${lang}/${dicts[lang][`slug.${page}`]}/`;
}

/** Everything a page template needs. */
export function context(dicts, lang, page, config, assets) {
  const t = translator(dicts[lang], lang);
  const locale = LOCALES[lang];
  return {
    lang,
    page,
    t,
    config,
    assets,
    locale,
    link: (p) => pagePath(dicts, lang, p),
    /** This page in another language (the language menu, hreflang, canonical). */
    pathIn: (l) => pagePath(dicts, l, page),
    demo: esc(config.demoUrl),
    number: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    /** The contact page's form with a topic preselected (CONTACT_TOPICS); no mailto: links anywhere. */
    contactLink: (topic = 'general') => `${pagePath(dicts, lang, 'contact')}?topic=${topic}#contact-form`,
    /**
     * The news forms' targets on the same API as the contact form (public/newsletter/...); null
     * without a contact URL, and then no news forms are shown.
     */
    newsletterUrl: (action) => (config.contactUrl ? `${config.contactUrl.replace(/\/contact\/?$/, '')}/newsletter/${action}` : null),
    /** The public news posts on the same API (public/news, loaded by assets/news.js); null without a contact URL. */
    newsApiUrl: config.contactUrl ? `${config.contactUrl.replace(/\/contact\/?$/, '')}/news` : null,
    /** The address as plain text: one click selects it for copying. */
    email: `<span class="email">${esc(config.email)}</span>`,
    dicts,
  };
}

/** The modules submenu: the optional modules, then how to build one's own. */
export const MODULE_PAGES = ['cases', 'expenses', 'roster', 'plugins'];

function header(ctx) {
  const { t, link, lang, page, config } = ctx;
  const item = (p) => `<a href="${link(p)}"${p === page || (p === 'security' && page === 'law') ? ' aria-current="page"' : ''}>${t(`nav.${p}`)}</a>`;
  // "Modules" opens on hover or focus (CSS only, no JavaScript); in the small-screen menu its pages are listed below it.
  const modules = `<div class="nav-sub">
          <button type="button" class="nav-sub-label" aria-haspopup="true"${MODULE_PAGES.includes(page) ? ' aria-current="page"' : ''}>${t('nav.modules')}${icon('chevron')}</button>
          <div class="nav-sub-menu">${MODULE_PAGES.map(item).join('')}</div>
        </div>`;
  // The Working Hours Act page lives under Security (its slug and its place in the menu).
  const nav = ['features', 'modules', 'pricing', 'references', 'security', 'support', 'about', 'contact'].map((p) => (p === 'modules' ? modules : item(p))).join('');
  const langs = LANGS.map(
    (l) =>
      `<a href="${ctx.pathIn(l)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}<span>${LANG_NAMES[l]}</span></a>`,
  ).join('');
  const login = config.appUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(config.appUrl)}">${t('nav.login')}</a>` : '';
  // The same panel twice: a bar on wide screens, a <details> menu on small ones (no JavaScript).
  const panel = `<nav class="nav" aria-label="${t('nav.main')}">${nav}</nav>
        <div class="langs" role="group" aria-label="${t('nav.language')}">${langs}</div>
        <div class="header-actions">${login}<a class="btn btn-primary btn-sm" href="${ctx.demo}">${t('cta.demo')}</a></div>`;
  return `<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${link('home')}" aria-label="Apensum – ${t('nav.home')}">${logoMark(30)}<span class="wordmark">a<b>pensum</b></span></a>
    <div class="menu-panel bar">
        ${panel}
    </div>
    <details class="menu">
      <summary aria-label="${t('nav.menu')}">${icon('menu')}</summary>
      <div class="menu-panel">
        ${panel}
      </div>
    </details>
  </div>
</header>`;
}

/** Where the news forms' server sends the visitor back to: /de/news/pruefen/ and the like (not in the sitemap). */
export const NEWS_RESULTS = { sent: 'slug.newsSent', unsubscribeSent: 'slug.newsUnsubscribeSent', failed: 'slug.newsFailed' };
export function newsResultPath(dicts, lang, kind) {
  return `${pagePath(dicts, lang, 'news')}${dicts[lang][NEWS_RESULTS[kind]]}/`;
}

/**
 * The news forms: a plain HTML post to the API (public/newsletter/subscribe or unsubscribe-request),
 * which mails a link and redirects back to a result page. `website` is a honeypot (hidden from people).
 * Nothing without a contact URL (no API to post to). `compact`: the footer's one-line form.
 */
export function newsletterForm(ctx, kind, compact = false) {
  const { t, lang, dicts } = ctx;
  const action = ctx.newsletterUrl(kind === 'subscribe' ? 'subscribe' : 'unsubscribe-request');
  if (!action) return '';
  const ok = newsResultPath(dicts, lang, kind === 'subscribe' ? 'sent' : 'unsubscribeSent');
  const id = `news-${kind}${compact ? '-footer' : ''}`;
  return `<form class="news-form${compact ? ' compact' : ''}" method="post" action="${esc(action)}">
        <label for="${id}">${t(`news.${kind}.label`)}</label>
        <div class="news-row">
          <input id="${id}" type="email" name="email" required maxlength="200" autocomplete="email" placeholder="${t('news.placeholder')}">
          <button class="btn ${kind === 'subscribe' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="submit">${t(`news.${kind}.button`)}</button>
        </div>
        <input type="hidden" name="lang" value="${lang}">
        <input type="hidden" name="ok" value="${ok}">
        <input type="hidden" name="fail" value="${newsResultPath(dicts, lang, 'failed')}">
        <label class="hp" aria-hidden="true">${t('contact.form.honeypot')}<input name="website" tabindex="-1" autocomplete="off"></label>
        ${compact ? `<small><a href="${ctx.link('news')}">${t('news.more')}</a></small>` : ''}
      </form>`;
}

function footer(ctx) {
  const { t, link, config } = ctx;
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="${link('home')}">${logoMark(26)}<span class="wordmark">a<b>pensum</b></span></a>
      <p class="muted">${t('footer.tagline')}</p>
      ${newsletterForm(ctx, 'subscribe', true)}
    </div>
    <nav aria-label="${t('footer.product')}">
      <h2>${t('footer.product')}</h2>
      <a href="${link('features')}">${t('nav.features')}</a>
      <a href="${link('pricing')}">${t('nav.pricing')}</a>
      <a href="${link('security')}">${t('nav.security')}</a>
      <a href="${link('law')}">${t('nav.law')}</a>
      <a href="${link('support')}">${t('nav.support')}</a>
      <a href="${ctx.demo}">${t('cta.demo')}</a>
      ${config.appUrl ? `<a href="${esc(config.appUrl)}">${t('nav.login')}</a>` : ''}
      ${config.sourceUrl ? `<a class="footer-github" href="${esc(config.sourceUrl)}" rel="noopener">${t('nav.source')}${githubMark()}</a>` : ''}
    </nav>
    <nav aria-label="${t('nav.modules')}">
      <h2>${t('nav.modules')}</h2>
      ${MODULE_PAGES.map((p) => `<a href="${link(p)}">${t(`nav.${p}`)}</a>`).join('\n      ')}
    </nav>
    <nav aria-label="${t('footer.company')}">
      <h2>${t('footer.company')}</h2>
      <a href="${link('about')}">${t('nav.about')}</a>
      <a href="${link('references')}">${t('nav.references')}</a>
      <a href="${link('contact')}">${t('nav.contact')}</a>
      <a href="${link('news')}">${t('nav.news')}</a>
      <a href="${link('impressum')}">${t('nav.impressum')}</a>
      <a href="${link('privacy')}">${t('nav.privacy')}</a>
    </nav>
  </div>
  <div class="wrap footer-base muted">© ${year} Apensum · ${t('footer.madeIn')}${config.sourceUrl ? ` · ${t('footer.openSource')}` : ''}</div>
</footer>`;
}

/** A full HTML document. `alternates` maps language -> path of this page. */
export function layout(ctx, { title, description, body, noindex = false, reveal = false, form = false, news = false }) {
  const { lang, page, config, assets, t } = ctx;
  const origin = `https://${config.domain}`;
  const alternates = page
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}${ctx.pathIn(l)}">`).join('\n  ') +
      `\n  <link rel="alternate" hreflang="x-default" href="${origin}/">`
    : '';
  const canonical = page ? `<link rel="canonical" href="${origin}${ctx.pathIn(lang)}">` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  ${canonical}
  ${alternates}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Apensum">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:locale" content="${LOCALES[lang].replace('-', '_')}">
  <meta name="theme-color" content="#1a56db">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${assets.css}">
  ${reveal && config.operator.phone ? `<script src="${assets.reveal}" defer></script>` : ''}
  ${form ? `<script src="${assets.contact}" defer></script>` : ''}
  ${news ? `<script src="${assets.news}" defer></script>` : ''}
  ${news || body.includes('class="shot') ? `<script src="${assets.zoom}" data-close="${t('shot.close')}" defer></script>` : ''}
</head>
<body>
  <a class="skip" href="#main">${t('nav.skip')}</a>
  ${header(ctx)}
  <main id="main">
${body}
  </main>
  ${footer(ctx)}
</body>
</html>
`;
}
