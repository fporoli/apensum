// LinkedIn images for Apensum: a 400×400 logo (the mark filling the square) and a 1128×191 cover (rendered at 2×),
// light and dark, in German and English. From the repo root, after `npm --prefix apps/site/videos install`:
//   node apps/site/social/linkedin/render.cjs   (writes the PNGs beside this script)
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../../videos')] }));

const OUT = process.argv[2] ?? __dirname;
const BLUE = '#1a56db';
const NAVY = '#0F1B3D';
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">`;

// The mark's "a" (apps/site/static/brand/apensum-mark.svg), without its rounded square.
// Its outline spans x 7.2–22.8 and y 9.7–25.3: the viewBox centers it (+1 right, 1.5 up).
const glyph = (size, hand = '#9ec0ff') => `<svg width="${size}" height="${size}" viewBox="-1 1.5 32 32" aria-hidden="true"><circle cx="15" cy="17.5" r="6.5" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M21.5 11v13" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M15 14.2v3.5l2.3 1.4" fill="none" stroke="${hand}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const logo = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>
<div style="width:400px;height:400px;overflow:hidden;background:${BLUE};display:flex;align-items:center;justify-content:center">${glyph(420)}</div>
</body></html>`;

/** The cover's words per language. */
const TEXT = {
  de: { eyebrow: 'Zeit · Absenzen · Spesen · HR', title: 'Zeiterfassung, Gutachten, HR-Prozesse … für Sie oder Ihre Kunden – ein Framework auf offenem Fundament.', today: 'Heute', clockedIn: '● Eingestempelt seit 07:58', days: ['Mo', 'Di', 'Mi', 'Do', 'Fr'], week: 'Diese Woche' },
  en: { eyebrow: 'Time · Absences · Expenses · HR', title: 'Time tracking, assessments, HR processes … for you or your customers – a framework on an open foundation.', today: 'Today', clockedIn: '● Checked in since 07:58', days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], week: 'This week' },
};

/** The week as the app shows it: five bars, Wednesday off, Friday still running. */
function week(dark, t) {
  const card = dark ? 'rgba(255,255,255,0.07)' : '#FFFFFF';
  const border = dark ? 'rgba(255,255,255,0.14)' : '#D6DCE8';
  const text = dark ? '#C9D5F2' : '#475569';
  const strong = dark ? '#FFFFFF' : '#0F172A';
  const bar = dark ? '#5B7FE0' : '#5B74C9';
  const bars = [['46px', bar], ['54px', bar], ['7px', `repeating-linear-gradient(135deg, ${border} 0 3px, transparent 3px 6px)`], ['50px', bar], ['33px', `linear-gradient(to top, ${BLUE}, #A9C1F5)`]];
  const days = t.days;
  return `<div style="width:236px;background:${card};border:1px solid ${border};border-radius:14px;padding:12px 14px;box-shadow:${dark ? 'none' : '0 12px 32px rgba(26,86,219,0.16)'};font-family:Inter,sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;font-weight:600;color:${strong}">${t.today}</span>
      <span style="font-size:9px;font-weight:600;color:#12805C;background:#E3F6EE;border-radius:999px;padding:2px 7px">${t.clockedIn}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;height:74px;margin-top:10px">
      ${bars.map(([h, bg], i) => `<div style="display:flex;flex-direction:column;gap:4px"><div style="flex:1;display:flex;align-items:flex-end"><div style="width:100%;height:${h};border-radius:4px 4px 2px 2px;background:${bg}"></div></div><span style="font-size:9px;color:${text};text-align:center">${days[i]}</span></div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:${text}"><span>${t.week}</span><span><b style="color:${strong}">27:40</b> / 32:00 h</span></div>
  </div>`;
}

function cover(dark, lang) {
  const t = TEXT[lang];
  const bg = dark
    ? `radial-gradient(520px 260px at 88% 40%, rgba(26,86,219,0.55), rgba(26,86,219,0) 70%), ${NAVY}`
    : `radial-gradient(520px 260px at 88% 45%, rgba(26,86,219,0.20), rgba(26,86,219,0) 70%), #F3F5FA`;
  const title = dark ? '#FFFFFF' : '#0F172A';
  const sub = dark ? '#C9D5F2' : '#475569';
  const eyebrow = dark ? '#F2B8B2' : '#D52B1E';
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>html,body{margin:0}h1,p{margin:0}</style></head><body>
<div style="position:relative;width:1128px;height:191px;overflow:hidden;background:${bg};font-family:Inter,sans-serif">
  <!-- a fine grid on the right, fading out to the left -->
  <div aria-hidden="true" style="position:absolute;inset:0;background-image:linear-gradient(${dark ? 'rgba(255,255,255,0.06)' : 'rgba(26,86,219,0.07)'} 1px, transparent 1px),linear-gradient(90deg, ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(26,86,219,0.07)'} 1px, transparent 1px);background-size:24px 24px;-webkit-mask-image:linear-gradient(90deg, transparent 35%, #000 75%)"></div>
  <!-- left: the space LinkedIn puts the logo on stays free; the text starts after it -->
  <div style="position:absolute;left:250px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:8px">
    <span style="font-size:11px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${eyebrow}">${t.eyebrow}</span>
    <h1 style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:25px;line-height:1.15;letter-spacing:-0.6px;color:${title};text-wrap:balance">${t.title}</h1>
    <p style="font-size:13px;font-weight:500;color:${sub}">Swiss made in Stein am Rhein · apensum.ch</p>
  </div>
  <div style="position:absolute;right:56px;top:50%;transform:translateY(-50%)">${week(dark, t)}</div>
</div>
</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shoot = async (html, w, h, scale, file) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })).newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h } });
  };
  await shoot(logo, 400, 400, 1, 'apensum-linkedin-logo-400.png');
  await shoot(logo, 400, 400, 2, 'apensum-linkedin-logo-800.png');
  await shoot(cover(false, 'de'), 1128, 191, 2, 'apensum-linkedin-cover-hell.png');
  await shoot(cover(true, 'de'), 1128, 191, 2, 'apensum-linkedin-cover-dunkel.png');
  await shoot(cover(false, 'en'), 1128, 191, 2, 'apensum-linkedin-cover-light-en.png');
  await shoot(cover(true, 'en'), 1128, 191, 2, 'apensum-linkedin-cover-dark-en.png');
  await browser.close();
})();
