// The brochures' two A4 pages, as HTML for Chromium's print (../videos/brochures.mjs): the layout of the design
// "Apensum Broschüre für Treuhänder" (claude.ai, pages Treuhänder, Endkunden, IT-Partner), filled from text.mjs. This
// is the online version: without the box on becoming a co-owner and without the phone number (both only in print);
// the logo, the contact page, the e-mail address, the demo and GitHub are links.
import { BROCHURE_TEXT } from './text.mjs';

const ACCENT = '#1E3A8A';
const RED = '#D52B1E';
const SOFT = '#F2B8B2';
const ON_ACCENT = '#DBE4F5';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const link = (href, text, style = '') => `<a href="${esc(href)}" style="color: inherit; text-decoration: none; ${style}">${esc(text)}</a>`;

const eyebrowStyle = 'font-size: 12px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase';
const sectionLabel = (text) => `<h2 style="${eyebrowStyle}; color: #475569">${esc(text)}</h2>`;
const bigTitle = (text) => `<h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -0.6px">${esc(text)}</h2>`;

function page(body) {
  return `<section class="page"><div style="width: 794px; height: 1122px; box-sizing: border-box; padding: 52px 56px 48px; background: #FFFFFF; font-family: Inter, sans-serif; color: #0F172A; display: flex; flex-direction: column; gap: 24px; overflow: hidden">
${body}
</div></section>`;
}

function frontHeader(tagline) {
  return `<div style="display: flex; justify-content: space-between; align-items: center">
    <a href="https://apensum.ch/" style="display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none">
      <div style="width: 26px; height: 19px; border-radius: 6px; background: ${ACCENT}; display: flex; align-items: center; justify-content: center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg>
      </div>
      <span style="font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: -0.5px">apensum</span>
    </a>
    <span style="font-size: 12px; font-weight: 500; color: #475569; letter-spacing: 1.2px; text-transform: uppercase">${esc(tagline)}</span>
  </div>`;
}

function backHeader(t) {
  return `<div style="display: flex; justify-content: space-between; align-items: center">
    ${link('https://apensum.ch/', 'apensum', `font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.4px; color: ${ACCENT}`)}
    <span style="font-size: 12px; font-weight: 500; color: #475569; letter-spacing: 1.2px; text-transform: uppercase">${esc(t.back)}</span>
  </div>`;
}

/** The app as a small picture beside the title: today, the week's bars, three figures, an approved timesheet. */
function appPreview(a) {
  const bars = [['36px', '#5B74C9'], ['42px', '#5B74C9'], ['5px', 'repeating-linear-gradient(135deg, #D6DCE8 0 3px, transparent 3px 6px)'], ['39px', '#5B74C9'], ['26px', `linear-gradient(to top, ${ACCENT}, #A9B8E6)`]];
  const figure = (label, value, unit) => `<div style="background: #FFFFFF; border: 1px solid #D6DCE8; border-radius: 8px; padding: 6px; min-width: 0"><div style="font-size: 8px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${esc(label)}</div><div style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 700; color: #0F172A">${esc(value)}${unit ? `<span style="font-family: Inter, sans-serif; font-size: 9px; font-weight: 500; color: #475569; margin-left: 3px">${esc(unit)}</span>` : ''}</div></div>`;
  return `<div style="position: relative; margin-top: 6px"><div aria-hidden="true" style="position: absolute; left: -4%; right: -4%; top: 25%; bottom: -34px; background: radial-gradient(closest-side, rgba(30, 58, 138, 0.42), rgba(30, 58, 138, 0.20) 50%, rgba(30, 58, 138, 0))"></div><div aria-hidden="true" style="position: relative; border: 1px solid #D6DCE8; border-radius: 14px; overflow: hidden; background: #FFFFFF">
      <div style="display: flex; align-items: center; gap: 5px; padding: 9px 12px; background: ${ACCENT}">
        <span style="width: 8px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.4)"></span><span style="width: 8px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.4)"></span><span style="width: 8px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.4)"></span>
        <span style="margin-left: 8px; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 12px">apensum</span>
      </div>
      <div style="padding: 10px; display: flex; flex-direction: column; gap: 7px; background: #F3F5FA">
        <div style="background: #FFFFFF; border: 1px solid #D6DCE8; border-radius: 10px; padding: 8px">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px">
            <span style="font-size: 12px; font-weight: 600; color: #0F172A">${esc(a.today)}</span>
            <span style="font-size: 9px; font-weight: 600; color: #12805C; background: #E3F6EE; border-radius: 999px; padding: 2px 7px; white-space: nowrap">${esc(a.clockedIn)}</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; height: 58px; margin-top: 8px">
            ${bars.map(([h, bg], i) => `<div style="display: flex; flex-direction: column; align-items: stretch; gap: 4px; height: 100%"><div style="flex: 1; display: flex; align-items: flex-end"><div style="width: 100%; height: ${h}; border-radius: 4px 4px 2px 2px; background: ${bg}"></div></div><span style="font-size: 9px; color: #475569; text-align: center">${esc(a.days[i])}</span></div>`).join('')}
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 10px; color: #475569"><span>${esc(a.week)}</span><span><b style="color: #0F172A">27:40</b> / 32:00 h</span></div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px">${figure(a.pensum, '80 %')}${figure(a.vacationLeft, '14.5', a.daysUnit)}${figure(a.overtime, '+6:45', 'h')}</div>
        <div style="display: flex; align-items: center; gap: 7px; background: #0F172A; color: #FFFFFF; border-radius: 8px; padding: 8px 10px; font-size: 10.5px; font-weight: 500">
          <span style="width: 14px; height: 14px; border-radius: 7px; background: #12805C; display: flex; align-items: center; justify-content: center; flex-shrink: 0"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg></span>
          ${esc(a.approved)}
        </div>
      </div>
    </div></div>`;
}

function hero(t, eyebrow, title, lead) {
  return `<div style="display: grid; grid-template-columns: minmax(0, 1fr) 232px; gap: 28px; align-items: start">
    <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
      <span style="${eyebrowStyle}; color: ${RED}">${esc(eyebrow)}</span>
      <h1 style="font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 34px; line-height: 1.1; letter-spacing: -1px; text-wrap: balance">${esc(title)}</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #334155; text-wrap: pretty">${esc(lead)}</p>
    </div>
    ${appPreview(t.app)}
  </div>`;
}

/** Three grey cards under a small label (why it matters). */
function threeCards(label, items) {
  return `<div style="display: flex; flex-direction: column; gap: 12px">
    ${sectionLabel(label)}
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px">
      ${items.map(([h, p]) => `<div style="background: #F3F5FA; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 17px; font-weight: 600">${esc(h)}</h3>
        <p style="font-size: 13.5px; line-height: 1.45; color: #334155">${esc(p)}</p>
      </div>`).join('\n      ')}
    </div>
  </div>`;
}

/** Items under a blue line, in `columns` columns (what Apensum does; the partner models). */
function ruledGrid(label, items, columns) {
  return `<div style="display: flex; flex-direction: column; gap: 12px">
    ${sectionLabel(label)}
    <div style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); column-gap: 24px; row-gap: ${columns === 3 ? 16 : 14}px">
      ${items.map(([h, p]) => `<div style="border-top: 2px solid ${ACCENT}; padding-top: 8px; display: flex; flex-direction: column; gap: 3px"><h3 style="font-size: 15px; font-weight: 600">${esc(h)}</h3><p style="font-size: 13.5px; line-height: 1.4; color: #475569">${esc(p)}</p></div>`).join('\n      ')}
    </div>
  </div>`;
}

/** The blue band at the foot of the first page, with the demo's address as a button. */
function demoBand(title, sub) {
  return `<div style="margin-top: auto; background: ${ACCENT}; color: #FFFFFF; border-radius: 12px; padding: 22px 26px; display: flex; justify-content: space-between; align-items: center; gap: 24px">
    <div style="display: flex; flex-direction: column; gap: 4px">
      <span style="font-family: 'Space Grotesk', sans-serif; font-size: 21px; font-weight: 600">${esc(title)}</span>
      <span style="font-size: 14px; color: ${ON_ACCENT}">${sub}</span>
    </div>
    ${link('https://appdemo.apensum.ch/', 'appdemo.apensum.ch', `font-family: 'Space Grotesk', sans-serif; font-size: 19px; font-weight: 600; background: #FFFFFF; color: ${ACCENT}; padding: 10px 16px; border-radius: 8px; white-space: nowrap`)}
  </div>`;
}

/** Bold lead and sentence with a red dot, in two columns (security; the technology). */
function dots(title, items) {
  return `<div style="display: flex; flex-direction: column; gap: 14px">
    ${bigTitle(title)}
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; row-gap: 12px">
      ${items.map(([b, s]) => `<div style="display: flex; gap: 12px"><span style="width: 8px; height: 8px; border-radius: 4px; background: ${RED}; margin-top: 6px; flex-shrink: 0"></span><p style="font-size: 14px; line-height: 1.45; color: #334155"><b style="color: #0F172A">${esc(b)}</b> ${esc(s)}</p></div>`).join('\n      ')}
    </div>
  </div>`;
}

/** The blue box on the back: an eyebrow, a title and numbered (or plain) items in `columns` columns. */
function blueBox(eyebrow, title, items, columns, numbered = true) {
  return `<div style="background: ${ACCENT}; color: #FFFFFF; border-radius: 14px; padding: 26px 28px; display: flex; flex-direction: column; gap: 18px">
    <div style="display: flex; flex-direction: column; gap: 6px">
      <span style="${eyebrowStyle}; color: ${SOFT}">${esc(eyebrow)}</span>
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; letter-spacing: -0.5px">${esc(title)}</h2>
    </div>
    <div style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); column-gap: ${columns === 2 ? 28 : 24}px; row-gap: 16px">
      ${items.map(([h, p], i) => {
        const text = `<div style="display: flex; flex-direction: column; gap: 3px"><h3 style="font-size: 15px; font-weight: 600">${esc(h)}</h3><p style="font-size: 14px; line-height: 1.45; color: ${ON_ACCENT}">${esc(p)}</p></div>`;
        return numbered ? `<div style="display: flex; gap: 12px"><span style="font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700; color: ${SOFT}; line-height: 1">${i + 1}</span>${text}</div>` : text;
      }).join('\n      ')}
    </div>
  </div>`;
}

const label = (text) => `<h2 style="${eyebrowStyle}; color: #475569">${esc(text)}</h2>`;
const contactLink = (t) => link(`https://apensum.ch/${t.contactPath}/`, `apensum.ch/${t.contactPath}`);
const mailLink = () => link('mailto:info@apensum.ch', 'info@apensum.ch');

/** Price, who is behind it and contact, at the foot of the back (trustees, customers). */
function footer(t) {
  const col = (inner) => `<div style="display: flex; flex-direction: column; gap: 6px">${inner}</div>`;
  return `<div style="margin-top: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">
    ${col(`${label(t.price.label)}
      <span style="font-family: 'Space Grotesk', sans-serif; font-size: 30px; font-weight: 700; color: ${ACCENT}; line-height: 1.1">${esc(t.price.value)}</span>
      <p style="font-size: 13.5px; line-height: 1.45; color: #334155">${t.price.lines.map(esc).join('<br>')}</p>`)}
    ${col(`${label(t.who.label)}
      <p style="font-size: 13.5px; line-height: 1.45; color: #334155"><b style="color: #0F172A">Fabio Poroli</b>${esc(t.who.text)}</p>`)}
    ${col(`${label(t.contact)}
      <p style="font-size: 13.5px; line-height: 1.6; color: #334155">${contactLink(t)}<br>${mailLink()}</p>
      ${link('https://appdemo.apensum.ch/', `${t.demo}: appdemo.apensum.ch`, `font-size: 13.5px; font-weight: 600; color: ${ACCENT}`)}`)}
  </div>`;
}

function trustees(t) {
  const a = t.trustees;
  const front = [frontHeader(a.tagline), hero(t, t.eyebrow, a.title, a.lead), threeCards(a.whyTitle, a.why), ruledGrid(t.canTitle, a.can, 3), demoBand(t.tryIt.title, esc(t.tryIt.text))].join('\n\n  ');
  const modules = `<div style="display: flex; flex-direction: column; gap: 12px">
    ${sectionLabel(a.modulesTitle)}
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      ${a.modules.map(([h, p]) => `<div style="border: 1px solid #D6DCE8; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 6px"><h3 style="font-size: 15px; font-weight: 600">${esc(h)}</h3><p style="font-size: 13px; line-height: 1.4; color: #475569">${esc(p)}</p></div>`).join('\n      ')}
    </div>
  </div>`;
  const back = [backHeader(t), dots(t.secure.title, t.secure.items), modules, blueBox(a.together.eyebrow, a.together.title, a.together.steps, 2), footer(t)].join('\n\n  ');
  return [page(front), page(back)];
}

function customers(t) {
  const a = t.customers;
  const front = [frontHeader(a.tagline), hero(t, t.eyebrow, a.title, a.lead), threeCards(a.whyTitle, a.why), ruledGrid(t.canTitle, a.can, 3), demoBand(t.tryIt.title, esc(t.tryIt.text))].join('\n\n  ');
  const roles = `<div style="display: flex; flex-direction: column; gap: 12px">
    ${bigTitle(a.rolesTitle)}
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      ${a.roles.map(([h, p]) => `<div style="background: #F3F5FA; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 6px"><h3 style="font-size: 15px; font-weight: 600">${esc(h)}</h3><p style="font-size: 13px; line-height: 1.4; color: #334155">${esc(p)}</p></div>`).join('\n      ')}
    </div>
  </div>`;
  const back = [backHeader(t), roles, dots(t.secure.title, t.secure.items), blueBox(a.start.eyebrow, a.start.title, a.start.steps, 3), footer(t)].join('\n\n  ');
  return [page(front), page(back)];
}

function partners(t) {
  const a = t.partners;
  const github = link('https://github.com/fporoli/apensum', 'github.com/fporoli/apensum');
  const front = [frontHeader(a.tagline), hero(t, a.eyebrow, a.title, a.lead), threeCards(a.whyTitle, a.why), ruledGrid(a.modelsTitle, a.models, 2), demoBand(a.look.title, `${esc(a.look.text)} · ${github}`)].join('\n\n  ');
  const open = `<div style="display: flex; flex-direction: column; gap: 12px">
    ${sectionLabel(a.openTitle)}
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px">
      ${a.open.map(([h, p]) => `<div style="border: 1px solid #D6DCE8; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px"><h3 style="font-size: 15px; font-weight: 600">${esc(h)}</h3><p style="font-size: 13.5px; line-height: 1.45; color: #475569">${esc(p)}</p></div>`).join('\n      ')}
    </div>
  </div>`;
  const foot = `<div style="margin-top: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px">
    <div style="display: flex; flex-direction: column; gap: 6px">
      ${label(t.who.label)}
      <p style="font-size: 13.5px; line-height: 1.45; color: #334155"><b style="color: #0F172A">Fabio Poroli</b>${esc(a.who)}</p>
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px">
      ${label(t.contact)}
      <p style="font-size: 13.5px; line-height: 1.6; color: #334155">${mailLink()}<br>${contactLink(t)}</p>
      ${link('https://github.com/fporoli/apensum', `${a.code}: github.com/fporoli/apensum`, `font-size: 13.5px; font-weight: 600; color: ${ACCENT}`)}
    </div>
  </div>`;
  const back = [backHeader(t), dots(a.techTitle, a.tech), open, blueBox(a.now.eyebrow, a.now.title, a.now.items, 3, false), foot].join('\n\n  ');
  return [page(front), page(back)];
}

const AUDIENCES = { trustees, customers, partners };

/** The brochure for a language and audience, as one HTML document of two A4 pages. */
export function brochureHtml(lang, audience) {
  const t = BROCHURE_TEXT[lang];
  if (!t || !AUDIENCES[audience]) throw new Error(`no brochure ${lang}/${audience}`);
  const pages = AUDIENCES[audience](t);
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<title>Apensum</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600;700&amp;display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0 }
html, body { margin: 0; padding: 0 }
h1, h2, h3, p { margin: 0 }
.page { width: 794px; height: 1122px; overflow: hidden; break-after: page }
.page:last-child { break-after: auto }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}
