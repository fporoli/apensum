// Records the four role demo videos for the website (German), from the dev stack with demo data.
//
//   npm run dev:resetdb                      # fresh demo data: the scenes build on each other
//   npm run site:videos [-- employee manager hr admin]   # installs Playwright + ffmpeg here first
//   npm run site:videos:publish              # upload to the site-media release, then deploy
//
// Each scene logs in as a demo user, then a scripted, visible cursor clicks through the app while
// captions explain it. Chrome's screencast frames (full quality, only when the page changes) are
// turned into an H.264 MP4 at 30 fps plus a poster image, in apps/site/media/ (not in git): the
// website build shows them on the home page; `npm run site:videos:publish` uploads them to the
// `site-media` GitHub release, from which the `site` workflow takes them when it deploys.
// The scenes run in order: Ueli requests vacation, Marco approves it, Ulla files a review, the
// admin shows roles, modules and branding. Run them all after a reset, or single ones to retake.
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const ROOT = dirname(fileURLToPath(import.meta.url));
/** Videos and posters go where the website build picks them up (apps/site/media, not in git). */
const MEDIA = join(ROOT, '..', 'media');
/** Screenshots of failed scenes. */
const OUT = join(ROOT, 'out');
const BASE = process.env.RECORD_BASE || 'http://localhost:3001';
const W = 1440;
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Overlay drawn into the page: cursor, click ripple, caption and title card. Above everything,
// never clickable.
function overlay() {
  const css = `
  #__demo, #__demo * { pointer-events: none !important; box-sizing: border-box; }
  #__demo { position: fixed; inset: 0; z-index: 2147483647; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  #__demo .cursor { position: absolute; left: 0; top: 0; width: 28px; height: 28px; transform: translate(720px, 450px);
    transition-property: transform, opacity; transition-timing-function: cubic-bezier(.4,.0,.2,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
  #__demo .ripple { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
    background: rgba(26,86,219,.35); border: 2px solid rgba(26,86,219,.8); transform: scale(.2); opacity: 0; }
  #__demo .ripple.go { animation: __demo-ripple .55s ease-out; }
  @keyframes __demo-ripple { 0% { transform: scale(.2); opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }
  #__demo .caption { position: absolute; left: 50%; bottom: 40px; max-width: 980px; transform: translate(-50%, 12px);
    padding: 16px 26px; border-radius: 14px; background: rgba(15,23,42,.88); color: #fff; font-size: 24px; line-height: 1.35;
    font-weight: 500; letter-spacing: -.01em; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,.25);
    opacity: 0; transition: opacity .35s ease, transform .35s ease; }
  #__demo .caption.on { opacity: 1; transform: translate(-50%, 0); }
  #__demo .title { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 14px; color: #fff;
    background: radial-gradient(900px 500px at 80% 0%, rgba(255,255,255,.16), transparent 70%), linear-gradient(135deg, #1a56db, #0f3fa8);
    opacity: 0; transition: opacity .6s ease; }
  #__demo .title.on { opacity: 1; }
  #__demo .title.on ~ .cursor { opacity: 0; }
  #__demo .title .brand { font-size: 26px; font-weight: 500; opacity: .85; letter-spacing: -.02em; }
  #__demo .title .brand b { font-weight: 750; }
  #__demo .title h1 { margin: 0; font-size: 76px; letter-spacing: -.035em; font-weight: 750; }
  #__demo .title p { margin: 0; font-size: 30px; opacity: .92; }`;
  const cursorSvg = `<svg viewBox="0 0 28 28" width="28" height="28"><path d="M5 3l17 9.5-7.4 1.8 4.3 8-3.2 1.7-4.3-8L6 21z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const install = () => {
    if (document.getElementById('__demo')) return;
    const root = document.createElement('div');
    root.id = '__demo';
    root.innerHTML = `<style>${css}</style><div class="title"><div class="brand">a<b>pensum</b></div><h1></h1><p></p></div><div class="caption"></div><div class="ripple"></div><div class="cursor">${cursorSvg}</div>`;
    document.documentElement.appendChild(root);
    const s = window.__demoState;
    if (s) {
      root.querySelector('.cursor').style.transform = `translate(${s.x}px, ${s.y}px)`;
      if (s.caption) {
        root.querySelector('.caption').textContent = s.caption;
        root.querySelector('.caption').classList.add('on');
      }
    }
  };
  const q = (sel) => (install(), document.querySelector(`#__demo ${sel}`));
  window.__demoState = window.__demoState || { x: 720, y: 450, caption: '' };
  window.__demo = {
    move(x, y, ms) {
      const c = q('.cursor');
      c.style.transitionDuration = `${ms}ms`;
      c.style.transform = `translate(${x}px, ${y}px)`;
      Object.assign(window.__demoState, { x, y });
    },
    pulse() {
      const r = q('.ripple');
      const { x, y } = window.__demoState;
      r.style.left = `${x + 6}px`;
      r.style.top = `${y + 4}px`;
      r.classList.remove('go');
      void r.offsetWidth;
      r.classList.add('go');
    },
    caption(text) {
      const c = q('.caption');
      window.__demoState.caption = text;
      if (!text) return c.classList.remove('on');
      c.classList.remove('on');
      setTimeout(() => {
        c.textContent = text;
        c.classList.add('on');
      }, c.textContent ? 250 : 0);
    },
    title(h, p) {
      const t = q('.title');
      if (h === null) return t.classList.remove('on');
      t.querySelector('h1').textContent = h;
      t.querySelector('p').textContent = p;
      t.classList.add('on');
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

// ---------------------------------------------------------------------------------------------
class Scene {
  constructor(page) {
    this.page = page;
    this.x = W / 2;
    this.y = H / 2;
  }
  wait(ms) {
    return sleep(ms);
  }
  async caption(text, hold = 0) {
    await this.page.evaluate((t) => window.__demo.caption(t), text);
    if (hold) await sleep(hold);
  }
  async title(h, p, hold = 2600) {
    await this.page.evaluate(([a, b]) => window.__demo.title(a, b), [h, p]);
    await sleep(hold);
    await this.page.evaluate(() => window.__demo.title(null));
    await sleep(700);
  }
  /** Glides the visible cursor (and the real mouse, for hover effects) to a point of the element. */
  async moveTo(locator, fx = 0.5, fy = 0.5) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    if (!b) throw new Error(`not visible: ${locator}`);
    const x = Math.round(b.x + b.width * fx);
    const y = Math.round(b.y + b.height * fy);
    const dist = Math.hypot(x - this.x, y - this.y);
    const ms = Math.round(Math.min(1000, Math.max(350, dist * 0.9)));
    await this.page.evaluate(([a, c, d]) => window.__demo.move(a, c, d), [x, y, ms]);
    await this.page.mouse.move(x, y, { steps: 8 });
    await sleep(ms + 120);
    this.x = x;
    this.y = y;
  }
  /** `fx` = where across the element to click (0..1), e.g. 0.1 for a date field's day section. */
  async click(locator, pause = 700, fx = 0.5) {
    await this.moveTo(locator, fx);
    await this.page.evaluate(() => window.__demo.pulse());
    await sleep(140);
    if (fx === 0.5) await locator.click();
    else {
      const b = await locator.boundingBox();
      await locator.click({ position: { x: Math.max(4, b.width * fx), y: b.height / 2 } });
    }
    await sleep(pause);
  }
  async type(locator, text, pause = 400) {
    await this.click(locator, 200);
    await locator.pressSequentially(text, { delay: 55 });
    await sleep(pause);
  }
  /** MUI select: open it, then click the option. */
  async choose(combo, option) {
    await this.click(combo, 500);
    const name = option instanceof RegExp ? option : new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|$)`);
    await this.click(this.page.getByRole('option', { name }).first(), 600);
  }
  /** A navbar entry (a button; the group headings have the same words but are not clickable). */
  async nav(label) {
    const name = new RegExp(`^${label}(\\s*\\d+)?$`);
    await this.click(this.page.locator('.MuiDrawer-root').getByRole('button', { name }).first(), 1200);
  }
}

// ---------------------------------------------------------------------------------------------
/** First Monday on or after the first of next month, and that week's Friday (dd.mm.yyyy). */
function nextMonthWeek() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const fri = new Date(d);
  fri.setDate(d.getDate() + 4);
  const fmt = (x) => `${String(x.getDate()).padStart(2, '0')}${String(x.getMonth() + 1).padStart(2, '0')}${x.getFullYear()}`;
  return { from: fmt(d), to: fmt(fri), monday: d };
}

/** A small receipt PNG (rendered by the browser) for the expense scene. */
async function receiptPng(browser) {
  const page = await browser.newPage({ viewport: { width: 360, height: 520 } });
  await page.setContent(`<body style="margin:0;background:#fff;font:15px ui-monospace,Menlo,monospace;color:#222;padding:28px">
    <div style="text-align:center;font:700 20px system-ui">TAXI ZÜRICH</div>
    <div style="text-align:center;margin-bottom:18px">Quittung Nr. 4711</div>
    <div>Datum: ${new Date().toLocaleDateString('de-CH')}</div><div>Von: Zürich HB</div><div>Nach: Flughafen ZRH</div>
    <hr style="border:0;border-top:1px dashed #999;margin:16px 0">
    <div style="display:flex;justify-content:space-between"><span>Fahrpreis</span><span>CHF 64.50</span></div>
    <div style="display:flex;justify-content:space-between"><span>MWST 8.1%</span><span>CHF 4.84</span></div>
    <hr style="border:0;border-top:1px dashed #999;margin:16px 0">
    <div style="display:flex;justify-content:space-between;font-weight:700"><span>TOTAL</span><span>CHF 64.50</span></div>
    <div style="margin-top:30px;text-align:center">Vielen Dank!</div></body>`);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

/** A one-page PDF for the personnel-file scene. */
function reviewPdf() {
  const text = 'BT /F1 18 Tf 72 760 Td (Mitarbeiterbeurteilung 2026 - Ueli A) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

// ---------------------------------------------------------------------------------------------
const SCENES = {
  employee: {
    user: 'ueli',
    // Off camera: a retake starts checked out.
    async prepare(page) {
      const out = page.getByRole('button', { name: 'Ausstempeln' }).first();
      if (await out.isVisible().catch(() => false)) {
        await out.click();
        await sleep(1500);
      }
    },
    async run(s, { browser }) {
      const p = s.page;
      await s.title('Mitarbeitende', 'Ueli erfasst Zeit, Ferien und Spesen');
      await s.caption('Die Übersicht: Arbeitszeit, Saldi und Ferien auf einen Blick');
      await s.moveTo(p.getByText('Überstundensaldo').first());
      await s.wait(900);
      await s.moveTo(p.getByText('Feriensaldo').first());
      await s.wait(1300);
      await s.caption('Einstempeln mit einem Klick');
      await s.click(p.getByRole('button', { name: 'Einstempeln' }).first(), 2200);

      const week = nextMonthWeek();
      await s.nav('Absenzen');
      await s.caption('Ferien beantragen – der Antrag geht direkt an Marco, seinen Vorgesetzten');
      await s.click(p.getByLabel('Von', { exact: true }), 250, 0.08);
      await p.keyboard.type(week.from, { delay: 70 });
      // The end date follows the start date; only the day changes (typing a whole date there
      // passes through months before the start, which the field rejects).
      await s.click(p.getByLabel('Bis', { exact: true }), 250, 0.08);
      await p.keyboard.type(week.to.slice(0, 2), { delay: 90 });
      await s.wait(300);
      await s.choose(p.getByRole('combobox', { name: 'Art' }), 'Ferien');
      await s.type(p.getByLabel('Kommentar'), 'Skiferien in Arosa');
      await s.click(p.getByRole('button', { name: 'Beantragen' }), 1800);
      await s.caption('Der Antrag ist eingereicht – Marco wird benachrichtigt', 2000);

      await s.nav('Spesen');
      await s.caption('Spesen erfassen: Kategorie, Betrag und das Foto der Quittung');
      await s.choose(p.getByRole('combobox', { name: /^Kategorie/ }), 'Reisen');
      await s.choose(p.getByRole('combobox', { name: /^Unterkategorie/ }), 'Taxi/Fahrdienst');
      const value = p.getByLabel(/^Wert/);
      await s.click(value, 150);
      await value.fill('');
      await value.pressSequentially('64.50', { delay: 70 });
      await s.type(p.getByLabel('Kommentar'), 'Taxi zum Flughafen, Kundentermin');
      await p.locator('input[type=file]').first().setInputFiles({ name: 'quittung-taxi.png', mimeType: 'image/png', buffer: await receiptPng(browser) });
      await s.wait(1400);
      await s.click(p.getByRole('button', { name: 'Hinzufügen' }), 2000);

      await s.nav('Dokumente');
      await s.caption('Alle persönlichen Dokumente an einem Ort: Zeitblätter, Rapporte, Belege');
      await s.wait(1200);
      await s.moveTo(p.getByText(/Monatsrapport|Zeitblatt/).nth(1), 0.5);
      await s.wait(1000);
      await s.moveTo(p.getByText('Spesen', { exact: true }).last(), 0.5);
      await s.wait(1800);
      await s.caption('');
      await s.wait(600);
    },
  },

  manager: {
    user: 'marco',
    async run(s) {
      const p = s.page;
      await s.title('Vorgesetzte', 'Marco gibt frei und behält sein Team im Blick');
      // The notification texts themselves are still English (stored by the API), so only the bell.
      await s.caption('Eine neue Benachrichtigung: Ueli hat Ferien beantragt');
      await s.moveTo(p.getByRole('button', { name: 'Benachrichtigungen' }));
      await s.wait(2000);
      await s.nav('Workflow');
      await s.caption('Alle Freigaben in einem Eingang – nur für seine eigenen Mitarbeitenden');
      const row = p.locator('tr', { hasText: 'Absenzantrag' }).first();
      await s.moveTo(row, 0.25);
      await s.wait(1400);
      await s.click(row.getByRole('button', { name: 'Genehmigen' }), 1800);
      await s.caption('Genehmigt – Ueli wird automatisch informiert', 2000);

      await s.nav('Absenzen');
      await s.caption('Der Teamkalender zeigt, wer wann fehlt – mit den Feiertagen des Kantons');
      await s.click(p.getByRole('tab', { name: 'Team' }), 1200);
      const next = p.getByRole('button', { name: /nächster monat|weiter/i }).first();
      if (await next.count()) await s.click(next, 1600);
      await s.wait(2000);

      await s.nav('Zeitsalden');
      await s.caption('Saldi des Teams: Überstunden, Überzeit und Ferien');
      await s.wait(3200);
      await s.caption('');
      await s.wait(600);
    },
  },

  hr: {
    user: 'ulla',
    async run(s) {
      const p = s.page;
      await s.title('HR', 'Ulla führt Personaldaten und das Personaldossier');
      await s.nav('Benutzer');
      await s.caption('HR sieht alle Mitarbeitenden mit Abteilung, Funktion und Vorgesetzten');
      await s.wait(2400);
      const ueli = p.locator('tr', { hasText: 'ueli@acme.com' });
      await s.caption('Das Arbeitszeitmodell: Pensum und Wochentage, mit Verlauf');
      await s.click(ueli.getByRole('button', { name: 'Arbeitszeitmodell' }), 2600);
      await s.click(p.getByRole('dialog').getByRole('button', { name: 'Schliessen' }), 600);

      await s.caption('Im Personaldossier legt HR Dokumente ab – vertraulich oder für die Person freigegeben');
      await s.click(ueli.getByRole('button', { name: /Personaldossier/ }), 1200);
      const dlg = p.getByRole('dialog');
      await dlg.locator('input[type=file]').first().setInputFiles({ name: 'Mitarbeiterbeurteilung_2026.pdf', mimeType: 'application/pdf', buffer: reviewPdf() });
      await s.wait(800);
      await s.type(dlg.getByLabel('Titel'), 'Mitarbeiterbeurteilung 2026');
      const date = dlg.getByLabel('Datum des Dokuments');
      await s.click(date, 200, 0.12);
      await date.fill(new Date().toISOString().slice(0, 10));
      await s.wait(400);
      await s.click(dlg.getByRole('checkbox').first(), 800);
      await s.click(dlg.getByRole('button', { name: 'Ins Dossier legen' }), 2000);
      await s.caption('Ueli sieht das Dokument jetzt auf seiner Seite «Dokumente»', 2400);
      await s.click(dlg.getByRole('button', { name: 'Schliessen' }).first(), 600);

      await s.nav('Zeitsalden');
      await s.caption('Monatsbericht mit Warnungen bei zu vielen Über- oder Minusstunden');
      await s.wait(3400);
      await s.caption('');
      await s.wait(600);
    },
  },

  admin: {
    user: 'admin',
    async run(s) {
      const p = s.page;
      await s.title('Administration', 'Rollen, Berechtigungen, Module und Erscheinungsbild');
      await s.nav('Admin-Einstellungen');
      await s.caption('Rollen und Berechtigungen – fein abgestuft nach Bereich und Umfang');
      await s.click(p.getByRole('tab', { name: 'Rollen & Berechtigungen' }), 1800);
      await p.mouse.wheel(0, 380);
      await s.wait(2600);

      await s.nav('Organisationseinstellungen');
      await s.caption('Module pro Organisation ein- und ausschalten – der Menüpunkt verschwindet sofort');
      const toggle = p.getByRole('checkbox', { name: /Anfragen/ }).first();
      await s.click(toggle, 1800);
      await s.moveTo(p.locator('.MuiDrawer-root').getByRole('button', { name: /^Dokumente/ }).first());
      await s.wait(1400);
      await s.click(toggle, 1600);

      await s.caption('Eigenes Logo und eigene Farben für die ganze Organisation');
      await s.moveTo(p.getByText('Erscheinungsbild').first());
      await p.mouse.wheel(0, 420);
      await s.wait(3200);
      await s.caption('');
      await s.wait(600);
    },
  },
};

// ---------------------------------------------------------------------------------------------
async function login(page, user) {
  // The demo users' saved languages differ; the videos are German.
  await page.route(/\/api\/v1\/(auth\/login|users\/me)$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object') {
      if ('locale' in body) body.locale = 'de';
      if (body.user && typeof body.user === 'object') body.user.locale = 'de';
    }
    await route.fulfill({ response: res, json: body ?? undefined });
  });
  await page.goto(BASE);
  await page.getByLabel('E-Mail').fill(`${user}@acme.com`);
  await page.getByLabel('Passwort', { exact: true }).fill(user);
  await page.keyboard.press('Enter');
  await page.locator('.MuiDrawer-root').first().waitFor();
  await sleep(1500);
}

function encode(frames, endTime, file) {
  const dir = join(OUT, '.frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let list = '';
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : endTime;
    list += `file '${name}'\nduration ${Math.max(0.001, next - f.t).toFixed(3)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  writeFileSync(join(dir, 'list.txt'), list);
  const run = (args) => {
    const r = spawnSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}`);
  };
  run(['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-tune', 'stillimage', '-movflags', '+faststart', '-an', `${file}.mp4`]);
  // Poster: the role's title card.
  run(['-ss', '1.6', '-i', `${file}.mp4`, '-frames:v', '1', '-vf', 'scale=1440:-2', '-q:v', '3', `${file}.jpg`]);
  rmSync(dir, { recursive: true, force: true });
}

async function record(id, browser) {
  const scene = SCENES[id];
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'de-CH', timezoneId: 'Europe/Zurich' });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await login(page, scene.user);
  if (scene.prepare) await scene.prepare(page);
  await page.evaluate(() => window.__demo.title('', ''));
  await sleep(400);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  try {
    await scene.run(new Scene(page), { browser });
  } catch (err) {
    await page.screenshot({ path: join(OUT, `${id}-error.png`) }).catch(() => {});
    throw err;
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => {});
  }
  const end = frames.length ? frames[frames.length - 1].t + 0.6 : t0;
  await context.close();
  const file = join(MEDIA, `demo-${id}`);
  encode(frames, end, file);
  const secs = frames.length ? (end - frames[0].t).toFixed(1) : 0;
  console.log(`videos: ${id} -> ${file}.mp4 (${secs}s, ${frames.length} frames)`);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = wanted.length ? wanted : Object.keys(SCENES);
for (const id of ids) if (!SCENES[id]) throw new Error(`unknown scene ${id} (${Object.keys(SCENES).join(', ')})`);
mkdirSync(OUT, { recursive: true });
mkdirSync(MEDIA, { recursive: true });
const browser = await chromium.launch();
try {
  for (const id of ids) await record(id, browser);
} finally {
  await browser.close();
}
if (!existsSync(OUT)) process.exit(1);
