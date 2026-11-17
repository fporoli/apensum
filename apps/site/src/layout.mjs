import { icon, logoMark } from './icons.mjs';

export const LANGS = ['de', 'fr', 'it', 'en'];
export const DEFAULT_LANG = 'de';
export const LOCALES = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-GB' };
export const LANG_NAMES = { de: 'Deutsch', fr: 'Français', it: 'Italiano', en: 'English' };
/** Pages per language; every page but home has a translated slug (`slug.<page>`). */
export const PAGES = ['home', 'features', 'pricing', 'security', 'about', 'contact', 'impressum', 'privacy'];

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
    demo: esc(config.demoUrl),
    number: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    /** The contact page's form with a topic preselected (CONTACT_TOPICS); no mailto: links anywhere. */
    contactLink: (topic = 'general') => `${pagePath(dicts, lang, 'contact')}?topic=${topic}#contact-form`,
    /** The address as plain text: one click selects it for copying. */
    email: `<span class="email">${esc(config.email)}</span>`,
    dicts,
  };
}

function header(ctx) {
  const { t, link, lang, page, dicts, config } = ctx;
  const nav = ['features', 'pricing', 'security', 'about', 'contact']
    .map((p) => `<a href="${link(p)}"${p === page ? ' aria-current="page"' : ''}>${t(`nav.${p}`)}</a>`)
    .join('');
  const langs = LANGS.map(
    (l) =>
      `<a href="${pagePath(dicts, l, page)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}<span>${LANG_NAMES[l]}</span></a>`,
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

function footer(ctx) {
  const { t, link, config } = ctx;
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="${link('home')}">${logoMark(26)}<span class="wordmark">a<b>pensum</b></span></a>
      <p class="muted">${t('footer.tagline')}</p>
    </div>
    <nav aria-label="${t('footer.product')}">
      <h2>${t('footer.product')}</h2>
      <a href="${link('features')}">${t('nav.features')}</a>
      <a href="${link('pricing')}">${t('nav.pricing')}</a>
      <a href="${link('security')}">${t('nav.security')}</a>
      <a href="${ctx.demo}">${t('cta.demo')}</a>
      ${config.appUrl ? `<a href="${esc(config.appUrl)}">${t('nav.login')}</a>` : ''}
      ${config.sourceUrl ? `<a href="${esc(config.sourceUrl)}" rel="noopener">${t('nav.source')}</a>` : ''}
    </nav>
    <nav aria-label="${t('footer.company')}">
      <h2>${t('footer.company')}</h2>
      <a href="${link('about')}">${t('nav.about')}</a>
      <a href="${link('contact')}">${t('nav.contact')}</a>
      <a href="${link('impressum')}">${t('nav.impressum')}</a>
      <a href="${link('privacy')}">${t('nav.privacy')}</a>
    </nav>
  </div>
  <div class="wrap footer-base muted">© ${year} Apensum · ${t('footer.madeIn')}${config.sourceUrl ? ` · ${t('footer.openSource')}` : ''}</div>
</footer>`;
}

/** A full HTML document. `alternates` maps language -> path of this page. */
export function layout(ctx, { title, description, body, noindex = false, reveal = false, form = false }) {
  const { lang, page, dicts, config, assets, t } = ctx;
  const origin = `https://${config.domain}`;
  const alternates = page
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}${pagePath(dicts, l, page)}">`).join('\n  ') +
      `\n  <link rel="alternate" hreflang="x-default" href="${origin}/">`
    : '';
  const canonical = page ? `<link rel="canonical" href="${origin}${pagePath(dicts, lang, page)}">` : '';
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
