import { CANTONS, HOLIDAY_NAMES, cantonHolidays } from '../../../packages/shared/src/worktime.ts';
import { icon } from './icons.mjs';
import { esc, layout, pagePath } from './layout.mjs';

/** The canton each language's holiday example shows. */
const EXAMPLE_CANTON = { de: 'ZH', fr: 'VD', it: 'TI', en: 'BE' };

const PILLARS = [
  ['attendance', 'clock'],
  ['project', 'briefcase'],
  ['absences', 'calendar'],
  ['balances', 'scale'],
  ['expenses', 'receipt'],
  ['approvals', 'inbox'],
];
const ROLES = [
  ['employee', 'user'],
  ['manager', 'users'],
  ['hr', 'shield'],
  ['admin', 'sliders'],
];
const MORE = [
  ['requests', 'chat'],
  ['directory', 'pin'],
  ['documents', 'doc'],
  ['assistant', 'sparkle'],
  ['notifications', 'bell'],
  ['orgs', 'building'],
];
export const FEATURE_GROUPS = [
  ['time', 'clock'],
  ['project', 'briefcase'],
  ['absences', 'calendar'],
  ['balances', 'scale'],
  ['timesheets', 'check'],
  ['expenses', 'receipt'],
  ['requests', 'chat'],
  ['documents', 'doc'],
  ['admin', 'sliders'],
  ['languages', 'globe'],
];
const SECURITY = [
  ['encryption', 'lock'],
  ['transit', 'key'],
  ['permissions', 'shield'],
  ['traceability', 'history'],
  ['separation', 'layers'],
  ['hosting', 'cross'],
  ['assistant', 'sparkle'],
  ['website', 'globe'],
];

/**
 * The phone number behind a "Show phone number" button: in the page only reversed and base64
 * encoded, decoded on click by static/assets/reveal.js (pages using it pass `reveal: true`).
 */
export function phoneReveal(ctx) {
  const phone = ctx.config.operator.phone;
  if (!phone) return '';
  const v = Buffer.from([...phone].reverse().join(''), 'utf8').toString('base64');
  return `<span data-nosnippet><button type="button" class="reveal" data-v="${v}">${icon('phone')}${ctx.t('contact.showPhone')}</button></span>`;
}

const checklist = (items) => `<ul class="checklist">${items.map((i) => `<li>${icon('check')}<span>${i}</span></li>`).join('')}</ul>`;

function ctaBand(ctx) {
  const { t } = ctx;
  return `<section class="section">
  <div class="wrap">
    <div class="cta-band">
      <div>
        <h2>${t('cta.title')}</h2>
        <p>${t('cta.text')}</p>
      </div>
      <div class="actions">
        <a class="btn btn-light" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
        <a class="btn btn-outline-light" href="${ctx.mailto('contact.mailSubject')}">${icon('mail')}${esc(ctx.config.email)}</a>
      </div>
    </div>
  </div>
</section>`;
}

/** A stylised screen of the app (not a screenshot), localized. */
function mockup(ctx) {
  const { t, locale, number } = ctx;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2026-11-09 is a Monday.
  const days = [0, 1, 2, 3, 4].map((i) => weekday.format(new Date(Date.UTC(2026, 10, 9 + i, 12))));
  const heights = [82, 95, 0, 88, 40];
  const bars = days
    .map((d, i) => `<div class="day${i === 2 ? ' off' : ''}${i === 4 ? ' now' : ''}"><span style="height:${heights[i] || 8}%"></span><small>${esc(d)}</small></div>`)
    .join('');
  return `<div class="mock" aria-hidden="true">
  <div class="mock-bar"><i></i><i></i><i></i><span>apensum</span></div>
  <div class="mock-body">
    <div class="mock-card">
      <div class="mock-row"><strong>${t('mock.today')}</strong><span class="chip chip-ok"><b></b>${t('mock.checkedIn', { time: '07:58' })}</span></div>
      <div class="mock-week">${bars}</div>
      <div class="mock-row small"><span>${t('mock.week')}</span><span><strong>27:40</strong> / 32:00 h</span></div>
    </div>
    <div class="mock-tiles">
      <div class="mock-tile"><small>${t('mock.pensum')}</small><strong>${number(80)}&nbsp;%</strong></div>
      <div class="mock-tile"><small>${t('mock.vacation')}</small><strong>${number(14.5)}</strong><em>${t('mock.days')}</em></div>
      <div class="mock-tile"><small>${t('mock.overtime')}</small><strong>+6:45</strong><em>h</em></div>
    </div>
    <div class="mock-toast">${icon('check')}<span>${t('mock.approved')}</span></div>
  </div>
</div>`;
}

function holidayCard(ctx) {
  const { t, lang, locale } = ctx;
  const now = new Date();
  const year = now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const canton = EXAMPLE_CANTON[lang];
  const list = cantonHolidays(year, canton);
  const shown = list.slice(0, 7);
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
  const rows = shown
    .map((h) => `<li><span>${esc(HOLIDAY_NAMES[h.key]?.[lang] ?? h.key)}</span><time datetime="${h.date}">${esc(fmt.format(new Date(`${h.date}T12:00:00Z`)))}</time></li>`)
    .join('');
  const chips = ['ZH', 'BE', 'VD', 'GE', 'TI', 'VS', 'GR']
    .map((c) => `<span class="canton${c === canton ? ' on' : ''}">${c}</span>`)
    .join('');
  return `<div class="card holiday-card">
  <div class="holiday-head">
    <strong>${t('swiss.cardTitle', { year: String(year) })}</strong>
    <span class="muted">${t('swiss.cardCanton', { canton })}</span>
  </div>
  <div class="cantons" aria-hidden="true">${chips}<span class="canton more">+${CANTONS.length - 7}</span></div>
  <ul class="holidays">${rows}</ul>
  ${list.length > shown.length ? `<p class="muted small">${t('swiss.more', { n: String(list.length - shown.length) })}</p>` : ''}
  <p class="muted small">${t('swiss.cardNote')}</p>
</div>`;
}

/**
 * One row per role with its demo video (apps/site/media/demo-<role>.mp4, recorded by
 * videos/record.mjs), alternating sides. Null when the videos are not there: the cards are shown.
 */
function roleVideos(ctx) {
  const { t, lang, assets } = ctx;
  const video = (key) => assets.media?.[`demo-${key}.mp4`];
  if (!ROLES.every(([key]) => video(key))) return null;
  const rows = ROLES.map(([key, ic], i) => {
    const poster = assets.media[`demo-${key}.jpg`];
    const title = t(`roles.${key}.title`);
    return `<div class="role-row${i % 2 ? ' flip' : ''}">
      <div class="role-text">
        <div class="feature-icon">${icon(ic)}</div>
        <h3>${title}</h3>
        <p>${t(`roles.${key}.text`)}</p>
        ${lang === 'de' ? '' : `<p class="muted small">${icon('globe')}${t('roles.videoNote')}</p>`}
      </div>
      <figure class="role-video">
        <video controls preload="none" playsinline${poster ? ` poster="${poster}"` : ''} aria-label="${t('roles.videoLabel', { role: title })}" width="1440" height="900">
          <source src="${video(key)}" type="video/mp4">
        </video>
      </figure>
    </div>`;
  });
  return `<div class="role-rows">\n    ${rows.join('\n    ')}\n    </div>`;
}

export function home(ctx) {
  const { t, link } = ctx;
  const card = (prefix, [key, ic]) => `<article class="card feature">
      <div class="feature-icon">${icon(ic)}</div>
      <h3>${t(`${prefix}.${key}.title`)}</h3>
      <p>${t(`${prefix}.${key}.text`)}</p>
    </article>`;
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-text">
      <p class="eyebrow">${t('hero.eyebrow')}</p>
      <h1>${t('hero.title')}</h1>
      <p class="lead">${t('hero.lead')}</p>
      <div class="actions">
        <a class="btn btn-primary" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
        <a class="btn btn-ghost" href="${link('features')}">${t('hero.secondary')}</a>
      </div>
      <p class="note">${icon('globe')}${t('hero.note')}</p>
    </div>
    ${mockup(ctx)}
  </div>
</section>

<section class="facts" aria-label="${t('facts.label')}">
  <div class="wrap facts-grid">
    <div><strong>26</strong><span>${t('facts.cantons')}</span></div>
    <div><strong>4</strong><span>${t('facts.languages')}</span></div>
    <div><strong>AES-256</strong><span>${t('facts.encryption')}</span></div>
    <div><strong>1</strong><span>${t('facts.approvals')}</span></div>
  </div>
</section>

<section class="section" id="pillars">
  <div class="wrap">
    <div class="section-head">
      <h2>${t('pillars.title')}</h2>
      <p class="lead">${t('pillars.lead')}</p>
    </div>
    <div class="grid grid-3">
    ${PILLARS.map((p) => card('pillars', p)).join('\n    ')}
    </div>
  </div>
</section>

<section class="section band">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${icon('cross')}${t('swiss.eyebrow')}</p>
      <h2>${t('swiss.title')}</h2>
      <p class="lead">${t('swiss.lead')}</p>
      ${checklist(t.list('swiss.items'))}
    </div>
    ${holidayCard(ctx)}
  </div>
</section>

<section class="section" id="roles">
  <div class="wrap">
    <div class="section-head">
      <h2>${t('roles.title')}</h2>
      <p class="lead">${t('roles.lead')}</p>
    </div>
    ${roleVideos(ctx) ?? `<div class="grid grid-4">\n    ${ROLES.map((r) => card('roles', r)).join('\n    ')}\n    </div>`}
  </div>
</section>

<section class="section band">
  <div class="wrap">
    <div class="section-head">
      <h2>${t('more.title')}</h2>
    </div>
    <div class="grid grid-3 compact">
    ${MORE.map(([key, ic]) => `<div class="mini">${icon(ic)}<div><h3>${t(`more.${key}.title`)}</h3><p>${t(`more.${key}.text`)}</p></div></div>`).join('\n    ')}
    </div>
  </div>
</section>

<section class="section tight-bottom">
  <div class="wrap">
    <div class="card pricing-teaser">
      <div>
        <p class="eyebrow">${icon('tag')}${t('nav.pricing')}</p>
        <h2>${t('home.pricing.title')}</h2>
        <p class="lead">${t('home.pricing.text')}</p>
        <a class="link-arrow" href="${link('pricing')}">${t('home.pricing.link')}${icon('arrow')}</a>
      </div>
      <div class="price-badge"><strong>CHF&nbsp;0</strong><span>${t('pricing.app.period')}</span></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${icon('shield')}${t('nav.security')}</p>
      <h2>${t('secTeaser.title')}</h2>
      <p class="lead">${t('secTeaser.lead')}</p>
      <a class="link-arrow" href="${link('security')}">${t('secTeaser.link')}${icon('arrow')}</a>
    </div>
    <div class="card">${checklist(t.list('secTeaser.items'))}</div>
  </div>
</section>
${ctaBand(ctx)}`;
  return layout(ctx, { title: t('home.meta.title'), description: t('home.meta.description'), body });
}

export function features(ctx) {
  const { t } = ctx;
  const toc = FEATURE_GROUPS.map(([g, ic]) => `<a href="#${g}">${icon(ic)}${t(`features.${g}.title`)}</a>`).join('');
  const groups = FEATURE_GROUPS.map(
    ([g, ic]) => `<section class="feature-group" id="${g}">
      <div class="feature-group-head">
        <div class="feature-icon">${icon(ic)}</div>
        <div>
          <h2>${t(`features.${g}.title`)}</h2>
          <p class="lead">${t(`features.${g}.lead`)}</p>
        </div>
      </div>
      ${checklist(t.list(`features.${g}.items`))}
    </section>`,
  ).join('\n');
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('nav.features')}</p>
    <h1>${t('features.title')}</h1>
    <p class="lead">${t('features.lead')}</p>
  </div>
</section>
<div class="wrap with-toc">
  <nav class="toc" aria-label="${t('features.toc')}">${toc}</nav>
  <div class="feature-groups">
${groups}
  </div>
</div>
${ctaBand(ctx)}`;
  return layout(ctx, { title: t('features.meta.title'), description: t('features.meta.description'), body });
}

export function security(ctx) {
  const { t } = ctx;
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('nav.security')}</p>
    <h1>${t('security.title')}</h1>
    <p class="lead">${t('security.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap grid grid-2">
  ${SECURITY.map(
    ([k, ic]) => `<article class="card feature">
      <div class="feature-icon">${icon(ic)}</div>
      <h2 class="h3">${t(`security.${k}.title`)}</h2>
      <p>${t(`security.${k}.text`)}</p>
    </article>`,
  ).join('\n  ')}
  </div>
  <div class="wrap"><p class="muted small note-block">${t('security.note')}</p></div>
</section>
${ctaBand(ctx)}`;
  return layout(ctx, { title: t('security.meta.title'), description: t('security.meta.description'), body });
}

/** Paths of the pages the contact form's server sends the visitor back to. */
export function contactResultPath(dicts, lang, kind) {
  return `${pagePath(dicts, lang, 'contact')}${dicts[lang][kind === 'thanks' ? 'slug.contactThanks' : 'slug.contactFailed']}/`;
}

/**
 * A plain HTML form (no script) posted to the API, which mails it and redirects back to the
 * thank-you or error page. `website` is a honeypot: hidden from people, filled in by bots.
 */
function contactForm(ctx) {
  const { t, config, lang, dicts } = ctx;
  const field = (name, label, attrs) => `<label class="field"><span>${t(label)}</span>${attrs}</label>`;
  return `<form class="card contact-card contact-form" method="post" action="${esc(config.contactUrl)}">
        <div class="feature-icon">${icon('mail')}</div>
        <h2 class="h3">${t('contact.form.title')}</h2>
        <p>${t('contact.form.text')}</p>
        ${field('name', 'contact.form.name', '<input name="name" required maxlength="120" autocomplete="name">')}
        ${field('email', 'contact.form.email', '<input name="email" type="email" required maxlength="200" autocomplete="email">')}
        ${field('organization', 'contact.form.organization', '<input name="organization" maxlength="200" autocomplete="organization">')}
        ${field('message', 'contact.form.message', '<textarea name="message" required minlength="2" maxlength="5000" rows="6"></textarea>')}
        <label class="hp" aria-hidden="true">${t('contact.form.honeypot')}<input name="website" tabindex="-1" autocomplete="off"></label>
        <input type="hidden" name="lang" value="${lang}">
        <input type="hidden" name="ok" value="${contactResultPath(dicts, lang, 'thanks')}">
        <input type="hidden" name="fail" value="${contactResultPath(dicts, lang, 'failed')}">
        <button class="btn btn-primary" type="submit">${t('contact.form.send')}</button>
        <p class="muted small">${t('contact.form.note')}</p>
        <p class="muted small">${t('contact.emailLabel')} <a href="mailto:${esc(config.email)}">${esc(config.email)}</a></p>
        ${config.operator.phone ? `<p class="small">${phoneReveal(ctx)}</p>` : ''}
      </form>`;
}

/** The page after sending: thanks, or what to do when it failed. */
export function contactResult(ctx, kind) {
  const { t, config } = ctx;
  const ok = kind === 'thanks';
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <p class="eyebrow">${t('nav.contact')}</p>
    <h1>${t(ok ? 'contact.thanks.title' : 'contact.failed.title')}</h1>
    <p class="lead">${ok ? t('contact.thanks.text') : t('contact.failed.text', { email: `<a href="mailto:${esc(config.email)}">${esc(config.email)}</a>` })}</p>
    <p class="actions">${ok ? '' : `<a class="btn btn-primary" href="${ctx.link('contact')}">${t('contact.retry')}</a>`}<a class="btn btn-ghost" href="${ctx.link('home')}">${t('contact.back')}</a></p>
  </div>
</section>`;
  return layout(ctx, { title: `${t(ok ? 'contact.thanks.title' : 'contact.failed.title')} – Apensum`, description: t('contact.meta.description'), body, noindex: true, reveal: false });
}

export function contact(ctx) {
  const { t, config } = ctx;
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('nav.contact')}</p>
    <h1>${t('contact.title')}</h1>
    <p class="lead">${t('contact.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap split top">
    <div class="stack">
      ${config.contactUrl ? contactForm(ctx) : `<div class="card contact-card">
        <div class="feature-icon">${icon('mail')}</div>
        <h2 class="h3">${t('contact.mailTitle')}</h2>
        <p>${t('contact.mailText')}</p>
        <a class="btn btn-primary" href="${ctx.mailto('contact.mailSubject')}">${t('contact.mailButton')}</a>
        <p class="muted small">${t('contact.emailLabel')} <a href="mailto:${esc(config.email)}">${esc(config.email)}</a></p>
        ${config.operator.phone ? `<p class="small">${phoneReveal(ctx)}</p>` : ''}
      </div>`}
      <div class="card contact-card">
        <div class="feature-icon">${icon('sparkle')}</div>
        <h2 class="h3">${t('contact.demoTitle')}</h2>
        <p>${t('contact.demoText')}</p>
        <a class="btn btn-ghost" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
      </div>
    </div>
    <div>
      <h2 class="h3">${t('contact.includeTitle')}</h2>
      ${checklist(t.list('contact.include'))}
      ${
        config.appUrl
          ? `<div class="card subtle"><h2 class="h3">${t('contact.customerTitle')}</h2><p>${t('contact.customerText')}</p><a class="link-arrow" href="${esc(config.appUrl)}">${t('nav.login')}${icon('arrow')}</a></div>`
          : ''
      }
    </div>
  </div>
</section>`;
  return layout(ctx, { title: t('contact.meta.title'), description: t('contact.meta.description'), body, reveal: true });
}

export function impressum(ctx) {
  const { t, config } = ctx;
  const c = config.operator;
  const missing = `<em class="todo">${t('impressum.missing')}</em>`;
  const v = (x) => (x ? esc(x) : missing);
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <h1>${t('impressum.title')}</h1>
  </div>
</section>
<section class="section tight">
  <div class="wrap narrow prose">
    <dl class="facts-list">
      ${row(t('impressum.company'), v(c.name))}
      ${row(t('impressum.address'), `${v(c.street)}<br>${v(c.city)}<br>${esc(c.country)}`)}
      ${c.responsible ? row(t('impressum.responsible'), esc(c.responsible)) : ''}
      ${row(t('impressum.email'), `<a href="mailto:${esc(config.email)}">${esc(config.email)}</a>`)}
      ${c.phone ? row(t('impressum.phone'), phoneReveal(ctx)) : ''}
      ${c.uid ? row(t('impressum.uid'), esc(c.uid)) : ''}
    </dl>
    <h2>${t('impressum.liabilityTitle')}</h2>
    ${t.list('impressum.liability').map((p) => `<p>${p}</p>`).join('\n    ')}
  </div>
</section>`;
  return layout(ctx, { title: t('impressum.meta.title'), description: t('impressum.meta.description'), body, reveal: true });
}

export const PRIVACY_SECTIONS = ['controller', 'visit', 'contact', 'app', 'rights', 'changes'];

export function privacy(ctx) {
  const { t, config, locale } = ctx;
  const updated = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15)));
  const sections = PRIVACY_SECTIONS.map(
    (s) => `<h2>${t(`privacy.${s}.title`)}</h2>
    ${t.list(`privacy.${s}.text`).map((p) => `<p>${p.replace('{{email}}', `<a href="mailto:${esc(config.email)}">${esc(config.email)}</a>`)}</p>`).join('\n    ')}`,
  ).join('\n    ');
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <h1>${t('privacy.title')}</h1>
    <p class="muted">${t('privacy.updated', { date: updated })}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap narrow prose">
    <p class="lead">${t('privacy.lead')}</p>
    ${sections}
  </div>
</section>`;
  return layout(ctx, { title: t('privacy.meta.title'), description: t('privacy.meta.description'), body });
}

export function pricing(ctx) {
  const { t } = ctx;
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('nav.pricing')}</p>
    <h1>${t('pricing.title')}</h1>
    <p class="lead">${t('pricing.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap grid grid-2 plans">
    <article class="card plan plan-main">
      <h2 class="h3">${t('pricing.app.name')}</h2>
      <p class="muted">${t('pricing.app.text')}</p>
      <p class="price"><strong>CHF&nbsp;0</strong><span>${t('pricing.app.period')}</span></p>
      ${checklist(t.list('pricing.app.items'))}
      <a class="btn btn-primary" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
    </article>
    <article class="card plan">
      <h2 class="h3">${t('pricing.custom.name')}</h2>
      <p class="muted">${t('pricing.custom.text')}</p>
      <p class="price"><button type="button" class="rate-button" popovertarget="rate">${icon('tag')}${t('pricing.custom.show')}</button></p>
      <div id="rate" popover class="rate-popover" role="dialog" aria-labelledby="rate-title">
        <h3 id="rate-title">${t('pricing.custom.rateTitle')}</h3>
        <p class="price"><span>${t('pricing.custom.rateFrom')}</span><strong>CHF&nbsp;120.–</strong><span>${t('pricing.custom.period')}</span></p>
        <p>${t('pricing.custom.rateText')}</p>
        <div class="actions">
          <a class="btn btn-primary" href="${ctx.mailto('pricing.custom.mailSubject')}">${icon('mail')}${t('pricing.custom.cta')}</a>
          <button type="button" class="btn btn-ghost" popovertarget="rate" popovertargetaction="hide">${t('pricing.custom.close')}</button>
        </div>
      </div>
      ${checklist(t.list('pricing.custom.items'))}
      <a class="btn btn-ghost" href="${ctx.mailto('pricing.custom.mailSubject')}">${icon('mail')}${t('pricing.custom.cta')}</a>
    </article>
  </div>
  <div class="wrap"><p class="muted small note-block">${t('pricing.note')}</p></div>
</section>
${ctaBand(ctx)}`;
  return layout(ctx, { title: t('pricing.meta.title'), description: t('pricing.meta.description'), body });
}

export function about(ctx) {
  const { t, config } = ctx;
  const name = config.operator.name;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
  const portrait = config.about?.photo
    ? `<img class="portrait" src="${esc(config.about.photo)}" alt="${esc(name)}" width="160" height="160">`
    : `<div class="portrait initials" aria-hidden="true">${esc(initials)}</div>`;
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('nav.about')}</p>
    <h1>${t('about.title')}</h1>
    <p class="lead">${t('about.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap about-grid">
    <div class="card profile">
      ${portrait}
      <h2 class="h3">${esc(name)}</h2>
      <p class="muted">${t('about.role')}</p>
      <p class="muted small">${t('about.degree')}</p>
      <div class="profile-links">
        <a href="mailto:${esc(config.email)}">${icon('mail')}${esc(config.email)}</a>
        ${phoneReveal(ctx)}
        ${config.about?.linkedin ? `<a href="${esc(config.about.linkedin)}" rel="me noopener">${icon('linkedin')}${t('about.linkedin')}</a>` : ''}
      </div>
    </div>
    <div class="prose">
      ${t.list('about.bio', { name }).map((p) => `<p>${p}</p>`).join('\n      ')}
      <h2>${t('about.status.title')}</h2>
      ${checklist(t.list('about.status.items'))}
    </div>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="card invest">
      <div class="feature-icon">${icon('handshake')}</div>
      <div>
        <h2>${t('about.invest.title')}</h2>
        <p>${t('about.invest.text')}</p>
        <a class="btn btn-primary" href="${ctx.mailto('about.invest.mailSubject')}">${icon('mail')}${t('about.invest.cta')}</a>
      </div>
    </div>
  </div>
</section>`;
  return layout(ctx, { title: t('about.meta.title'), description: t('about.meta.description'), body, reveal: true });
}

export const RENDER = { home, features, pricing, security, about, contact, impressum, privacy };
