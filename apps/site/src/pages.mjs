import { CANTONS, HOLIDAY_NAMES, cantonHolidays } from '../../../packages/shared/src/worktime.ts';
import { githubMark, icon } from './icons.mjs';
import { esc, layout, newsletterForm, pagePath } from './layout.mjs';

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
  ['mobile', 'phone'],
  ['project', 'briefcase'],
  ['absences', 'calendar'],
  ['balances', 'scale'],
  ['timesheets', 'check'],
  ['importexport', 'sync'],
  ['requests', 'chat'],
  ['documents', 'doc'],
  ['admin', 'sliders'],
  ['tenants', 'building'],
  ['access', 'key'],
  ['customize', 'layers'],
  ['languages', 'globe'],
];
/**
 * Screenshots per feature group (media/feature-<shot>-<lang>.jpg, taken by videos/screens.mjs).
 * The languages group shows the dashboard in two other languages; customize and cases have their video.
 */
export const FEATURE_SHOTS = {
  time: ['time-1', 'time-2'],
  mobile: ['mobile-1', 'mobile-2'],
  project: ['project-1'],
  absences: ['absences-1'],
  balances: ['balances-1', 'balances-2'],
  timesheets: ['timesheets-1'],
  expenses: ['expenses-1'],
  requests: ['requests-1'],
  documents: ['documents-1'],
  admin: ['admin-1', 'admin-2'],
  tenants: ['tenants-1'],
  access: ['access-1', 'access-2'],
};
const OTHER_LANGS = { de: ['fr', 'it'], fr: ['de', 'it'], it: ['de', 'fr'], en: ['de', 'fr'] };
const SECURITY = [
  ['encryption', 'lock'],
  ['transit', 'key'],
  ['permissions', 'shield'],
  ['traceability', 'history'],
  ['separation', 'layers'],
  ['hosting', 'cross'],
  ['assistant', 'sparkle'],
  ['website', 'globe'],
  ['opensource', 'code'],
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

/** What a contact message is about: the form's dropdown, preselected by `?topic=` (contact.js). */
export const CONTACT_TOPICS = ['general', 'demo', 'pilot', 'pricing', 'invest'];

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
        <a class="btn btn-outline-light" href="${ctx.contactLink()}">${icon('mail')}${t('cta.contact')}</a>
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

<section class="section band" id="modules">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">${icon('layers')}${t('home.modules.eyebrow')}</p>
      <h2>${t('home.modules.title')}</h2>
      <p class="lead">${t('home.modules.lead')}</p>
    </div>
    <div class="grid grid-2">
      <article class="card feature" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div class="feature-icon">${icon('lock')}</div>
            <span class="chip chip-ok"><b></b>${t('common.freeBadge')}</span>
          </div>
          <h3>${t('home.modules.cases.title')}</h3>
          <p>${t('home.modules.cases.text')}</p>
        </div>
        <div style="margin-top: 20px;">
          <a class="link-arrow" href="${link('cases')}">${t('home.modules.cases.link')}${icon('arrow')}</a>
        </div>
      </article>
      <article class="card feature" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div class="feature-icon">${icon('receipt')}</div>
            <span class="chip chip-ok"><b></b>${t('common.freeBadge')}</span>
          </div>
          <h3>${t('home.modules.expenses.title')}</h3>
          <p>${t('home.modules.expenses.text')}</p>
        </div>
        <div style="margin-top: 20px;">
          <a class="link-arrow" href="${link('expenses')}">${t('home.modules.expenses.link')}${icon('arrow')}</a>
        </div>
      </article>
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
${
  ctx.config.sourceUrl
    ? `
<section class="section tight-bottom">
  <div class="wrap">
    <div class="card">
      <p class="eyebrow">${icon('code')}${t('home.oss.eyebrow')}</p>
      <h2>${t('home.oss.title')}</h2>
      <p class="lead">${t('home.oss.text')}</p>
      ${githubButton(ctx, t('home.oss.link'))}
    </div>
  </div>
</section>`
    : ''
}

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

/** A screenshot that opens full size; the page's language, else German. Null when not recorded. */
function shot(ctx, id, caption, lang = ctx.lang) {
  const { assets } = ctx;
  const name = [`feature-${id}-${lang}.jpg`, `feature-${id}-de.jpg`].find((n) => assets.media?.[n]);
  if (!name) return null;
  const size = assets.mediaSize?.[name];
  const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
  return `<figure class="shot">
          <a href="${assets.media[name]}" title="${ctx.t('features.shot.enlarge')}"><img src="${assets.media[name]}" alt="${caption}" loading="lazy" decoding="async"${dims}></a>
          <figcaption>${caption}</figcaption>
        </figure>`;
}

/** Feature groups shown with a demo video (media/demo-<id>.mp4, videos/record.mjs) instead of screenshots. */
const FEATURE_VIDEOS = { customize: 'developer' };

/** The pictures (or the video) of one feature group, between its intro and its list. */
function featureMedia(ctx, group) {
  const { t, lang, assets } = ctx;
  if (FEATURE_VIDEOS[group]) {
    const video = assets.media?.[`demo-${FEATURE_VIDEOS[group]}.mp4`];
    if (!video) return '';
    const poster = assets.media[`demo-${FEATURE_VIDEOS[group]}.jpg`];
    return `<figure class="shot feature-video">
          <video controls preload="none" playsinline${poster ? ` poster="${poster}"` : ''} width="1440" height="900" aria-label="${t(`features.${group}.video`)}">
            <source src="${video}" type="video/mp4">
          </video>
          <figcaption>${t(`features.${group}.video`)}${lang === 'de' ? '' : ` · ${t('roles.videoNote')}`}</figcaption>
        </figure>`;
  }
  const figures =
    group === 'languages'
      ? OTHER_LANGS[lang].map((l) => shot(ctx, 'time-1', t('features.shot.languages'), l))
      : (FEATURE_SHOTS[group] ?? []).map((id) => shot(ctx, id, t(`features.shot.${id}`)));
  const shown = figures.filter(Boolean);
  if (!shown.length) return '';
  // Phone screenshots are tall: shown side by side at phone size, not across the column.
  return `<div class="shots${shown.length > 1 ? ' two' : ''}${group === 'mobile' ? ' phones' : ''}">
        ${shown.join('\n        ')}
      </div>`;
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
      ${featureMedia(ctx, g)}
      ${checklist(t.list(`features.${g}.items`))}
      ${g === 'mobile' ? `<div class="feature-action" style="margin-top: 18px;"><a class="btn btn-primary btn-sm" href="${ctx.demo}">${icon('phone')}${t('features.mobile.demoCta')}</a></div>` : ''}
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

/** A button to the public repository: GitHub's mark, the label and the repository's address. */
function githubButton(ctx, label) {
  const url = ctx.config.sourceUrl;
  const repo = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return `<a class="btn btn-ghost github-link" href="${esc(url)}" rel="noopener">${githubMark()}<span>${label}</span><span class="muted github-repo">${esc(repo)}</span></a>`;
}

/** What Apensum does for the Working Hours Act (page `law`): each card a claim the app keeps. */
const LAW = [
  ['recording', 'clock'],
  ['mobile', 'phone'],
  ['retention', 'history'],
  ['checks', 'scale'],
  ['overtime', 'sliders'],
  ['night', 'calendar'],
  ['timesheets', 'check'],
  ['simplified', 'doc'],
];

export function law(ctx) {
  const { t } = ctx;
  const source = ctx.config.lawSourceUrl;
  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow"><a href="${ctx.link('security')}">${t('nav.security')}</a> › ${t('nav.law')}</p>
    <h1>${t('law.title')}</h1>
    <p class="lead">${t('law.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <h2>${t('law.rules.title')}</h2>
    <div class="card">${checklist(t.list('law.rules.items'))}</div>
    <p class="muted small">${t('law.rules.source')}${source ? ` <a href="${esc(source)}" rel="noopener">${t('law.rules.sourceLink')}</a>` : ''}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <h2>${t('law.app.title')}</h2>
  </div>
  <div class="wrap grid grid-2">
  ${LAW.map(
    ([k, ic]) => `<article class="card feature">
      <div class="feature-icon">${icon(ic)}</div>
      <h3 class="h3">${t(`law.${k}.title`)}</h3>
      <p>${t(`law.${k}.text`)}</p>
    </article>`,
  ).join('\n  ')}
  </div>
  <div class="wrap"><p class="muted small note-block">${t('law.note')}</p></div>
</section>
${ctaBand(ctx)}`;
  return layout(ctx, { title: t('law.meta.title'), description: t('law.meta.description'), body });
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
  <div class="wrap">
    <a class="card feature law-teaser" href="${ctx.link('law')}">
      <div class="feature-icon">${icon('scale')}</div>
      <div>
        <h2 class="h3">${t('security.law.title')}</h2>
        <p>${t('security.law.text')}</p>
        <span class="link-arrow">${t('security.law.link')}${icon('arrow')}</span>
      </div>
    </a>
  </div>
  <div class="wrap grid grid-2">
  ${SECURITY.filter(([k]) => k !== 'opensource' || ctx.config.sourceUrl).map(
    ([k, ic]) => `<article class="card feature">
      <div class="feature-icon">${k === 'opensource' ? githubMark() : icon(ic)}</div>
      <h2 class="h3">${t(`security.${k}.title`)}</h2>
      <p>${t(`security.${k}.text`)}</p>${k === 'opensource' ? `\n      ${githubButton(ctx, t('home.oss.link'))}` : ''}
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
 * A plain HTML form posted to the API, which mails it and redirects back to the thank-you or error
 * page. `website` is a honeypot: hidden from people, filled in by bots. contact.js sends it in the
 * background (showing that it is sending) and adds a time trap (`elapsed`); without JavaScript the
 * form works the same.
 */
function contactForm(ctx) {
  const { t, config, lang, dicts } = ctx;
  const field = (name, label, attrs) => `<label class="field"><span>${t(label)}</span>${attrs}</label>`;
  const topics = CONTACT_TOPICS.map((k) => `<option value="${k}">${t(`contact.topic.${k}`)}</option>`).join('');
  return `<form id="contact-form" class="card contact-card contact-form" method="post" action="${esc(config.contactUrl)}">
        <div class="feature-icon">${icon('mail')}</div>
        <h2 class="h3">${t('contact.form.title')}</h2>
        <p>${t('contact.form.text')}</p>
        ${field('topic', 'contact.form.topic', `<select name="topic">${topics}</select>`)}
        ${field('name', 'contact.form.name', '<input name="name" required maxlength="120" autocomplete="name">')}
        ${field('email', 'contact.form.email', '<input name="email" type="email" required maxlength="200" autocomplete="email">')}
        ${field('organization', 'contact.form.organization', '<input name="organization" maxlength="200" autocomplete="organization">')}
        ${field('message', 'contact.form.message', '<textarea name="message" required minlength="2" maxlength="5000" rows="6"></textarea>')}
        <label class="hp" aria-hidden="true">${t('contact.form.honeypot')}<input name="website" tabindex="-1" autocomplete="off"></label>
        <input type="hidden" name="lang" value="${lang}">
        <input type="hidden" name="elapsed" value="">
        <input type="hidden" name="ok" value="${contactResultPath(dicts, lang, 'thanks')}">
        <input type="hidden" name="fail" value="${contactResultPath(dicts, lang, 'failed')}">
        <button class="btn btn-primary" type="submit" data-sending="${esc(t('contact.form.sending'))}">${t('contact.form.send')}</button>
        <p class="muted small">${t('contact.form.note')}</p>
        <p class="muted small">${t('contact.emailLabel')} ${ctx.email}</p>
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
    <p class="lead">${ok ? t('contact.thanks.text') : t('contact.failed.text', { email: ctx.config.email })}</p>
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
        <p class="contact-address">${icon('mail')}${ctx.email}</p>
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
  return layout(ctx, { title: t('contact.meta.title'), description: t('contact.meta.description'), body, reveal: true, form: !!config.contactUrl });
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
      ${row(t('impressum.email'), ctx.email)}
      ${c.phone ? row(t('impressum.phone'), phoneReveal(ctx)) : ''}
      ${c.uid ? row(t('impressum.uid'), esc(c.uid)) : ''}
    </dl>
    <h2>${t('impressum.liabilityTitle')}</h2>
    ${t.list('impressum.liability').map((p) => `<p>${p}</p>`).join('\n    ')}
  </div>
</section>`;
  return layout(ctx, { title: t('impressum.meta.title'), description: t('impressum.meta.description'), body, reveal: true });
}

export const PRIVACY_SECTIONS = ['controller', 'visit', 'contact', 'newsletter', 'app', 'rights', 'changes'];

export function privacy(ctx) {
  const { t, config, locale } = ctx;
  const updated = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15)));
  const sections = PRIVACY_SECTIONS.map(
    (s) => `<h2 id="${s}">${t(`privacy.${s}.title`)}</h2>
    ${t.list(`privacy.${s}.text`).map((p) => `<p>${p.replace('{{email}}', ctx.email)}</p>`).join('\n    ')}`,
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
          <a class="btn btn-primary" href="${ctx.contactLink('pricing')}">${icon('mail')}${t('pricing.custom.cta')}</a>
          <button type="button" class="btn btn-ghost" popovertarget="rate" popovertargetaction="hide">${t('pricing.custom.close')}</button>
        </div>
      </div>
      ${checklist(t.list('pricing.custom.items'))}
      <a class="btn btn-ghost" href="${ctx.contactLink('pricing')}">${icon('mail')}${t('pricing.custom.cta')}</a>
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
        <a href="${ctx.contactLink()}">${icon('mail')}${t('cta.contact')}</a>
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
        <a class="btn btn-primary" href="${ctx.contactLink('invest')}">${icon('mail')}${t('about.invest.cta')}</a>
      </div>
    </div>
  </div>
</section>`;
  return layout(ctx, { title: t('about.meta.title'), description: t('about.meta.description'), body, reveal: true });
}

export function cases(ctx) {
  const { t, assets, lang } = ctx;
  const cards = [
    ['dossier', 'lock'],
    ['evidence', 'doc'],
    ['interviews', 'chat'],
    ['templates', 'layers'],
    ['security', 'shield'],
    ['export', 'check'],
  ];

  const video = assets.media?.['demo-cases.mp4'];
  const poster = assets.media?.['demo-cases.jpg'];
  const videoBlock = video
    ? `<figure class="shot feature-video">
        <video controls preload="none" playsinline${poster ? ` poster="${poster}"` : ''} width="1440" height="900" aria-label="${t('cases.videoTitle')}">
          <source src="${video}" type="video/mp4">
        </video>
        <figcaption>${t('cases.videoTitle')}${lang === 'de' ? '' : ` · ${t('roles.videoNote')}`}</figcaption>
      </figure>`
    : '';

  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('cases.hero.eyebrow')} · <span class="chip chip-ok"><b></b>${t('common.freeBadge')}</span></p>
    <h1>${t('cases.hero.title')}</h1>
    <p class="lead">${t('cases.hero.lead')}</p>
    <div class="actions" style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
      <a class="btn btn-primary" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
      <a class="btn btn-ghost" href="${ctx.contactLink('demo')}">${icon('mail')}${t('cta.contact')}</a>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    ${videoBlock}
    <div class="card pricing-teaser" style="margin-bottom: 40px;">
      <div>
        <p class="eyebrow">${icon('shield')}${t('common.includedInFramework')}</p>
        <h2>${t('cases.freeBox.title')}</h2>
        <p class="lead">${t('cases.freeBox.text')}</p>
      </div>
      <div class="price-badge"><strong>CHF&nbsp;0</strong><span>${t('common.freeBadge')}</span></div>
    </div>
  </div>

  <div class="wrap">
    <div class="section-head">
      <h2>${t('cases.features.title')}</h2>
      <p class="lead">${t('cases.features.lead')}</p>
    </div>
    <div class="grid grid-3">
    ${cards.map(([k, ic]) => `<article class="card feature">
        <div class="feature-icon">${icon(ic)}</div>
        <h3>${t(`cases.cards.${k}.title`)}</h3>
        <p>${t(`cases.cards.${k}.text`)}</p>
      </article>`).join('\n    ')}
    </div>
  </div>
</section>

<section class="section band">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${icon('shield')}${t('cases.hero.eyebrow')}</p>
      <h2>${t('cases.features.title')}</h2>
      <p class="lead">${t('cases.features.lead')}</p>
      ${checklist(t.list('cases.checkItems'))}
    </div>
    <div class="card">
      <div class="feature-icon">${icon('lock')}</div>
      <h3>${t('cases.cards.security.title')}</h3>
      <p class="muted" style="margin-bottom: 20px;">${t('cases.cards.security.text')}</p>
      <div class="actions">
        <a class="btn btn-primary btn-sm" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
      </div>
    </div>
  </div>
</section>
${ctaBand(ctx)}`;

  return layout(ctx, { title: t('cases.meta.title'), description: t('cases.meta.description'), body });
}

export function expenses(ctx) {
  const { t } = ctx;
  const cards = [
    ['mobile', 'phone'],
    ['ocr', 'sparkle'],
    ['currencies', 'scale'],
    ['mileage', 'briefcase'],
    ['approval', 'inbox'],
    ['payroll', 'sync'],
  ];

  const shotExpenses = shot(ctx, 'expenses-1', t('features.shot.expenses-1'));
  const shotMobile = shot(ctx, 'mobile-2', t('features.shot.mobile-2'));
  const shots = [shotExpenses, shotMobile].filter(Boolean);
  const shotsBlock = shots.length
    ? `<div class="shots${shots.length > 1 ? ' two' : ''}" style="margin-bottom: 40px;">
        ${shots.join('\n        ')}
      </div>`
    : '';

  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${t('expenses.hero.eyebrow')} · <span class="chip chip-ok"><b></b>${t('common.freeBadge')}</span></p>
    <h1>${t('expenses.hero.title')}</h1>
    <p class="lead">${t('expenses.hero.lead')}</p>
    <div class="actions" style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
      <a class="btn btn-primary" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
      <a class="btn btn-ghost" href="${ctx.contactLink('demo')}">${icon('mail')}${t('cta.contact')}</a>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    ${shotsBlock}
    <div class="card pricing-teaser" style="margin-bottom: 40px;">
      <div>
        <p class="eyebrow">${icon('receipt')}${t('common.includedInFramework')}</p>
        <h2>${t('expenses.freeBox.title')}</h2>
        <p class="lead">${t('expenses.freeBox.text')}</p>
      </div>
      <div class="price-badge"><strong>CHF&nbsp;0</strong><span>${t('common.freeBadge')}</span></div>
    </div>
  </div>

  <div class="wrap">
    <div class="section-head">
      <h2>${t('expenses.features.title')}</h2>
      <p class="lead">${t('expenses.features.lead')}</p>
    </div>
    <div class="grid grid-3">
    ${cards.map(([k, ic]) => `<article class="card feature">
        <div class="feature-icon">${icon(ic)}</div>
        <h3>${t(`expenses.cards.${k}.title`)}</h3>
        <p>${t(`expenses.cards.${k}.text`)}</p>
      </article>`).join('\n    ')}
    </div>
  </div>
</section>

<section class="section band">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${icon('receipt')}${t('expenses.hero.eyebrow')}</p>
      <h2>${t('expenses.features.title')}</h2>
      <p class="lead">${t('expenses.features.lead')}</p>
      ${checklist(t.list('expenses.checkItems'))}
    </div>
    <div class="card">
      <div class="feature-icon">${icon('sync')}</div>
      <h3>${t('expenses.cards.payroll.title')}</h3>
      <p class="muted" style="margin-bottom: 20px;">${t('expenses.cards.payroll.text')}</p>
      <div class="actions">
        <a class="btn btn-primary btn-sm" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
      </div>
    </div>
  </div>
</section>
${ctaBand(ctx)}`;

  return layout(ctx, { title: t('expenses.meta.title'), description: t('expenses.meta.description'), body });
}

/** The plugin page's steps: icon, and a short code example (the same in every language). */
const PLUGIN_STEPS = [
  ['folder', 'layers', `plugins/demo/package.json
{
  "name": "@acme/demo",
  "apensum": {
    "id": "demo",
    "apensumApi": 2,
    "dbSchema": "demo",
    "permissions": [
      { "id": "nav.demo", "kind": "nav",
        "scopes": ["own", "all"], "caption": "nav.demo" }
    ],
    "module": { "id": "demo", "caption": "modules.demo",
                "defaultEnabled": false, "objects": ["nav.demo"] },
    "api": "dist/api/index.js",
    "web": "web/index.tsx"
  }
}`],
  ['api', 'sync', `// plugins/demo/api/index.ts
import { defineApiPlugin } from '@worktime3/api/plugin';
import { DemoController } from './demo.controller';

export default defineApiPlugin({
  id: 'demo',
  controllers: [DemoController],
});`],
  ['web', 'phone', `// plugins/demo/web/index.tsx
import { defineWebPlugin, FolderSharedIcon } from '@worktime3/web/plugin';

export default defineWebPlugin({
  id: 'demo',
  texts: DEMO_TEXTS, // en, de, fr, it
  pages: [{
    section: 'demo', hash: '#/demo', object: 'nav.demo',
    nav: { group: 'myWork', label: 'nav.demo', icon: <FolderSharedIcon /> },
    render: (ctx) => <DemoPage orgId={ctx.orgId} authHeaders={ctx.authHeaders} />,
  }],
});`],
  ['database', 'doc', `plugins/demo/changelog/db.changelog-master.xml
plugins/demo/changelog/001-demo-schema.sql

npm run dev:migrate      # the core's changelog, then every plugin's
npm run dev:introspect   # writes plugins/demo/api/db/schema.ts`],
  ['run', 'check', `git clone <your repository> plugins/demo
npm run build --workspace=@worktime3/api
npm run dev:api          # log: "Loaded plugins: ..., demo"
npm run dev:web
npm test                 # the core's tests, then the plugin's`],
  ['ship', 'lock', `plugins/demo/   -> built into the API and web images
                   the core keeps working without it`],
];

/** What a plugin can add to the core (docs/PLUGINS.md). */
const PLUGIN_POINTS = [
  ['pages', 'layers'],
  ['data', 'doc'],
  ['approvals', 'inbox'],
  ['reports', 'scale'],
  ['documents', 'receipt'],
  ['ai', 'sparkle'],
];

export function plugins(ctx) {
  const { t, config } = ctx;
  const docs = config.sourceUrl ? `${config.sourceUrl.replace(/\/$/, '')}/blob/main/docs/PLUGINS.md` : null;
  const steps = PLUGIN_STEPS.map(([k, ic, code], i) => `<li class="card plugin-step">
        <div class="plugin-step-head"><span class="step-no">${i + 1}</span><div class="feature-icon">${icon(ic)}</div></div>
        <div>
          <h3>${t(`plugins.steps.${k}.title`)}</h3>
          <p>${t(`plugins.steps.${k}.text`)}</p>
        </div>
        <pre class="code"><code>${esc(code)}</code></pre>
      </li>`).join('\n      ');
  const points = PLUGIN_POINTS.map(([k, ic]) => `<article class="card feature">
        <div class="feature-icon">${icon(ic)}</div>
        <h3>${t(`plugins.points.${k}.title`)}</h3>
        <p>${t(`plugins.points.${k}.text`)}</p>
      </article>`).join('\n    ');

  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${icon('code')}${t('plugins.hero.eyebrow')}</p>
    <h1>${t('plugins.hero.title')}</h1>
    <p class="lead">${t('plugins.hero.lead')}</p>
    <div class="actions" style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
      ${docs ? `<a class="btn btn-primary" href="${esc(docs)}" rel="noopener">${t('plugins.docsCta')}${icon('arrow')}</a>` : ''}
      <a class="btn btn-ghost" href="${ctx.contactLink('general')}">${icon('mail')}${t('cta.contact')}</a>
    </div>
  </div>
</section>

<section class="section tight">
  <div class="wrap">
    <div class="section-head">
      <h2>${t('plugins.steps.title')}</h2>
      <p class="lead">${t('plugins.steps.lead')}</p>
    </div>
    <ol class="plugin-steps">
      ${steps}
    </ol>
  </div>
</section>

<section class="section band">
  <div class="wrap">
    <div class="section-head">
      <h2>${t('plugins.points.title')}</h2>
      <p class="lead">${t('plugins.points.lead')}</p>
    </div>
    <div class="grid grid-3">
    ${points}
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap split">
    <div>
      <p class="eyebrow">${icon('shield')}${t('plugins.rules.eyebrow')}</p>
      <h2>${t('plugins.rules.title')}</h2>
      <p class="lead">${t('plugins.rules.lead')}</p>
    </div>
    <div>${checklist(t.list('plugins.rules.items'))}</div>
  </div>
</section>
${ctaBand(ctx)}`;

  return layout(ctx, { title: t('plugins.meta.title'), description: t('plugins.meta.description'), body });
}


/**
 * News: subscribe (a confirmation link by e-mail; only a confirmed address counts) and unsubscribe
 * (a link by e-mail). The forms post to the API (site-newsletter.controller.ts); without a contact
 * URL there is no API, and the page says how to ask by e-mail instead.
 */
export function references(ctx) {
  const { t } = ctx;
  const steps = t.list('references.steps.items');
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <p class="eyebrow">${icon('handshake')}${t('nav.references')}</p>
    <h1>${t('references.title')}</h1>
    <p class="lead">${t('references.lead')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap grid grid-2">
    <article class="card">
      <div class="feature-icon">${icon('building')}</div>
      <h2 class="h3">${t('references.offer.title')}</h2>
      ${checklist(t.list('references.offer.items'))}
      <p class="muted small">${t('references.offer.note')} <a href="${ctx.link('pricing')}">${t('references.pricingLink')}</a></p>
    </article>
    <article class="card">
      <div class="feature-icon">${icon('chat')}</div>
      <h2 class="h3">${t('references.feedback.title')}</h2>
      <p>${t('references.feedback.text')}</p>
      ${checklist(t.list('references.feedback.items'))}
    </article>
  </div>
</section>
<section class="section tight">
  <div class="wrap narrow">
    <h2>${t('references.steps.title')}</h2>
    <ol class="plugin-steps references-steps">
      ${steps.map((s, i) => `<li><span class="step-no">${i + 1}</span><p>${s}</p></li>`).join('\n      ')}
    </ol>
    <p class="actions">
      <a class="btn btn-primary" href="${ctx.contactLink('pilot')}">${icon('mail')}${t('cta.contact')}</a>
      <a class="btn btn-ghost" href="${ctx.demo}">${t('cta.demo')}${icon('arrow')}</a>
    </p>
  </div>
</section>`;
  return layout(ctx, { title: t('references.meta.title'), description: t('references.meta.description'), body });
}

export function news(ctx) {
  const { t, lang, locale } = ctx;
  // The posts come from the API when the page opens (assets/news.js): written in the app as public
  // product news, so a new one is here without a deploy. `?post=<id>` shows one post.
  const list = ctx.newsApiUrl
    ? `<section class="section tight">
  <div class="wrap narrow">
    <div id="news-posts" class="news-posts" data-api="${esc(ctx.newsApiUrl)}" data-lang="${lang}" data-locale="${locale}"
      data-back="${t('news.post.back')}" data-empty="${t('news.posts.empty')}" data-failed="${t('news.posts.failed')}"
      data-only-german="${t('news.post.onlyGerman')}" data-read="${t('news.posts.read')}" aria-live="polite"></div>
    <noscript><p class="muted">${t('news.posts.noscript')}</p></noscript>
  </div>
</section>`
    : '';
  const forms = ctx.newsletterUrl('subscribe')
    ? `<div class="grid grid-2">
      <div class="card">
        <h2>${t('news.subscribe.title')}</h2>
        <p class="muted">${t('news.subscribe.text')}</p>
        ${newsletterForm(ctx, 'subscribe')}
      </div>
      <div class="card">
        <h2>${t('news.unsubscribe.title')}</h2>
        <p class="muted">${t('news.unsubscribe.text')}</p>
        ${newsletterForm(ctx, 'unsubscribe')}
      </div>
    </div>`
    : `<div class="card"><p>${t('news.noForm', { email: ctx.config.email })}</p></div>`;
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <p class="eyebrow">${icon('mail')}${t('nav.news')}</p>
    <h1>${t('news.title')}</h1>
    <p class="lead">${t('news.lead')}</p>
  </div>
</section>
${list}
<section class="section tight" id="subscribe">
  <div class="wrap">
    ${forms}
    <p class="muted news-privacy">${t('news.privacy')} <a href="${ctx.link('privacy')}#newsletter">${t('nav.privacy')}</a></p>
  </div>
</section>`;
  return layout(ctx, { title: t('news.meta.title'), description: t('news.meta.description'), body, news: !!ctx.newsApiUrl });
}

/** Where the news forms send the visitor back to: check your inbox, unsubscribe link sent, or an error. */
export function newsResult(ctx, kind) {
  const { t } = ctx;
  const body = `
<section class="page-head">
  <div class="wrap narrow">
    <p class="eyebrow">${t('nav.news')}</p>
    <h1>${t(`news.${kind}.title`)}</h1>
    <p class="lead">${t(`news.${kind}.text`, { email: ctx.config.email })}</p>
    <p class="actions">${kind === 'failed' ? `<a class="btn btn-primary" href="${ctx.link('news')}">${t('contact.retry')}</a>` : ''}<a class="btn btn-ghost" href="${ctx.link('home')}">${t('contact.back')}</a></p>
  </div>
</section>`;
  return layout(ctx, { title: `${t(`news.${kind}.title`)} – Apensum`, description: t('news.meta.description'), body, noindex: true });
}

export const RENDER = { home, features, cases, expenses, plugins, pricing, security, law, about, references, contact, news, impressum, privacy };
