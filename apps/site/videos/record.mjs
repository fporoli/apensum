// Records the role demo videos for the website (German), from the dev stack with demo data.
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
// admin shows modules and branding; Uma (developer) customizes the basic-data form (her
// changes are undone before each take); Marta works a KESB case (cases); Ulla plans next month's shifts
// (roster). Run them all after a reset, or single ones to retake.
// The employee (receipt reading) and cases scenes call Azure (Switzerland): .env.dev needs the
// AZURE_OPENAI_* values and the budget (`infra/azure/ai-provision.sh local`), the API restarted.
// The cases scene uses the fictitious KESB sample in test/sampledata/cases/
// (arztbericht-jonas-meier.pdf, interview-laura-meier-ch.mp3).
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
    /* Translucent: the app's first screen shows through behind the title. */
    background: radial-gradient(900px 500px at 80% 0%, rgba(255,255,255,.12), transparent 70%), linear-gradient(135deg, rgba(26,86,219,.72), rgba(15,63,168,.80));
    backdrop-filter: blur(3px); text-shadow: 0 2px 12px rgba(0,0,0,.25);
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
    // Off camera: a retake starts checked out, without the expenses an earlier take of today added.
    async prepare(page) {
      const { call, orgId } = await apiAs('ueli');
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
      const { entries = [] } = (await call(`/organizations/${orgId}/expenses`)) ?? {};
      for (const e of entries) {
        if (e.expense_date?.slice(0, 10) === today && !e.expense_report_id && /^(Taxi|Kunde in Winterthur)/.test(e.comment ?? '')) await call(`/expenses/${e.id}`, 'DELETE');
      }
      // An open session from an earlier take is closed (no-op when checked out).
      await call('/work-time/check-out', 'POST', { acknowledgeLongSession: true });
      await page.reload();
      await page.getByRole('button', { name: 'Einstempeln' }).first().waitFor();
      await sleep(1000);
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
      await s.caption('Spesen erfassen: Quittung anhängen – die KI liest Datum, Betrag und Kategorie');
      await p.locator('input[type=file]').first().setInputFiles({ name: 'quittung-taxi.png', mimeType: 'image/png', buffer: await receiptPng(browser) });
      await s.wait(1000);
      await s.click(p.getByRole('button', { name: 'Beleg auslesen' }), 300);
      await p.getByText('Vom Beleg übernommen', { exact: false }).waitFor({ timeout: 60000 });
      await s.wait(600);
      await s.caption('Ein Vorschlag aus der Quittung, verarbeitet in der Schweiz – kurz prüfen und ergänzen');
      await s.moveTo(p.getByLabel(/^Betrag \(Beleg\)/));
      await s.wait(1200);
      const category = p.getByRole('combobox', { name: /^Kategorie/ });
      if (!/Reisen/.test(await category.textContent())) await s.choose(category, 'Reisen');
      await s.choose(p.getByRole('combobox', { name: /^Unterkategorie/ }), 'Taxi/Fahrdienst');
      // The receipt reading filled the item text; the internal note stays the person's own.
      await s.type(p.getByLabel('Interne Bemerkung'), 'Kundentermin in Kloten');
      await s.wait(400);
      await s.click(p.getByRole('button', { name: 'Hinzufügen' }), 2000);

      await s.caption('Kilometerspesen: Strecke in km eintragen – der Betrag rechnet sich mit dem Ansatz der Firma');
      await s.choose(p.getByRole('combobox', { name: /^Kategorie/ }), 'Kilometer');
      await s.type(p.locator('#expense-km'), '84', 300);
      await s.moveTo(p.getByText(/km × .* = /).first());
      await s.wait(1400);
      const text = p.getByLabel(/^Positionstext/);
      await s.click(text, 150);
      await text.fill('');
      await text.pressSequentially('Kunde in Winterthur, hin und zurück', { delay: 55 });
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
      await s.click(p.getByRole('tab', { name: 'Gesamtansicht' }), 1200);
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
      await s.nav('Mitarbeitende');
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
      await s.title('Administration', 'Module und Erscheinungsbild');
      await s.nav('Organisationseinstellungen');
      await s.caption('Module pro Organisation ein- und ausschalten – der Menüpunkt verschwindet sofort');
      // The settings sections are collapsed: open "Module" first.
      await s.click(p.getByText('Module', { exact: true }).first(), 900);
      const toggle = p.getByRole('checkbox', { name: /Anfragen/ }).first();
      await s.click(toggle, 1800);
      await s.moveTo(p.locator('.MuiDrawer-root').getByRole('button', { name: /^Dokumente/ }).first());
      await s.wait(1400);
      await s.click(toggle, 1600);

      await s.caption('Eigenes Logo und eigene Farben für die ganze Organisation');
      await s.click(p.getByText('Erscheinungsbild', { exact: true }).first(), 900);
      await p.mouse.wheel(0, 420);
      await s.wait(3200);
      await s.caption('');
      await s.wait(600);
    },
  },
};

/** Off camera: the basic-data fields the developer scene changes go back to the registry's. */
async function resetDeveloperFields() {
  const api = process.env.RECORD_API || 'http://localhost:8001/api/v1';
  const login = await (await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'uma@acme.com', password: 'uma' }) })).json();
  const orgId = login.memberships?.[0]?.organizationId;
  for (const key of ['middleName', 'personnelNumber']) {
    await fetch(`${api}/organizations/${orgId}/forms/basicdata/fields/${key}`, { method: 'DELETE', headers: { Authorization: `Bearer ${login.token}` } });
  }
  // A saved custom field is only retired through the API (its values are kept): the dev database
  // forgets it, so the scene can add it again.
  const sql = "DELETE FROM field_config WHERE form_id = 'basicdata' AND field_key = 'badgeNumber'";
  const r = spawnSync('npm', ['run', '-s', 'dev:psql', '--', '-c', sql], { cwd: join(ROOT, '..', '..', '..'), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`developer scene: could not reset badgeNumber (${r.stderr || r.stdout})`);
}

SCENES.developer = {
  user: 'uma',
  async prepare(page) {
    await resetDeveloperFields();
    await page.evaluate(() => { window.location.hash = '#/my-data'; });
    await page.reload();
    await page.locator('.MuiDrawer-root').first().waitFor();
    await sleep(1800);
  },
  async run(s) {
    const p = s.page;
    await s.title('Anpassen', 'Uma gestaltet Formulare – ohne Programmierung');
    await s.caption('Mit der Rolle «Developer» lässt sich jedes Formular direkt in der App anpassen');
    await s.click(p.locator('header').getByRole('button').last(), 600);
    await s.click(p.getByRole('menuitem', { name: 'Designmodus' }), 1600);
    const panel = p.locator('.MuiDrawer-paper').filter({ hasText: 'Formulargestaltung' });

    await s.caption('Felder ausblenden oder zu Pflichtfeldern machen – die Vorschau zeigt es sofort');
    await s.click(p.getByText('Zweiter Vorname', { exact: true }).first(), 900);
    await s.click(panel.getByRole('checkbox').nth(1), 1600);

    await s.caption('Die Reihenfolge per Pfeil oder Drag-and-drop ändern');
    const row = panel.locator('div').filter({ has: p.getByText('Personal-Nr.', { exact: true }) }).filter({ has: p.getByRole('button') }).last();
    await s.click(row.getByRole('button').first(), 900);
    await s.click(row.getByRole('button').first(), 1400);

    await s.caption('Eigene Felder hinzufügen: Text, Zahl, Datum, Auswahlliste oder Kontrollkästchen');
    await s.click(panel.getByRole('button', { name: /Feld hinzufügen/ }), 700);
    await s.type(panel.getByLabel('Beschriftung EN', { exact: true }), 'Badge number', 200);
    await s.type(panel.getByLabel('Schlüssel'), 'badgeNumber', 400);
    await s.click(panel.getByRole('button', { name: 'Hinzufügen' }), 1400);

    await s.caption('Beschriftungen in allen vier Sprachen');
    for (const [lang, text] of [['de', 'Badge-Nummer'], ['fr', 'Numéro de badge'], ['it', 'Numero di badge']]) {
      await s.type(panel.getByLabel(`Beschriftung ${lang}`, { exact: true }), text, 250);
    }
    await s.wait(900);
    await s.caption('Speichern – die Änderung gilt sofort für alle in dieser Organisation');
    await s.click(panel.getByRole('button', { name: 'Speichern' }), 1800);
    await s.click(panel.getByRole('button', { name: 'Schliessen' }).first().or(panel.locator('button[aria-label]').first()), 1200);
    await s.moveTo(p.getByText('Badge-Nummer', { exact: true }).first());
    await s.caption('Ab sofort im Formular – für Personaldaten, Spesen und mehr', 2600);
    await s.caption('');
    await s.wait(600);
  },
};

// ---------------------------------------------------------------------------------------------
/** The fictitious KESB sample (not in git): a doctor's letter and the recorded interview with the sister. */
const SAMPLE = join(ROOT, '..', '..', '..', 'test', 'sampledata', 'cases');
const CASE_REF = 'KESB-2026-0517';

/** Calls the dev API as the given demo user; returns [json, orgId, token]. */
async function apiAs(user) {
  const api = process.env.RECORD_API || 'http://localhost:8001/api/v1';
  const login = await (await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${user}@acme.com`, password: user }) })).json();
  const orgId = login.memberships?.find((m) => /acme/i.test(m.organizationName ?? m.name ?? ''))?.organizationId ?? login.memberships?.[0]?.organizationId;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${login.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return res.json().catch(() => null);
  };
  return { call, orgId };
}

/**
 * Off camera, as the admin: Cases on for Acme, its transcription, summaries and
 * drafts on Azure (Switzerland), a KESB template that allows AI drafts, and no demo case left
 * from an earlier take.
 */
async function prepareCases() {
  for (const f of ['arztbericht-jonas-meier.pdf', 'interview-laura-meier-ch.mp3']) {
    if (!existsSync(join(SAMPLE, f))) throw new Error(`cases scene: ${join(SAMPLE, f)} is missing`);
  }
  const { call, orgId } = await apiAs('admin');
  const org = `/organizations/${orgId}`;
  await call(`${org}/modules`, 'PUT', { cases: true });
  const ai = await call(`${org}/case-ai-settings`, 'PUT', { transcription: 'azure', summary: 'azure', draft: 'azure', monthlyLimitChf: 10 });
  if (!ai?.ok) throw new Error(`cases scene: Azure is not set up on the dev API (${ai?.message ?? ai?.error ?? 'no answer'}); see infra/azure/ai-provision.sh local`);
  const { templates = [] } = (await call(`${org}/assessment-templates`)) ?? {};
  if (!templates.some((t) => t.organization_id === orgId && t.domain === 'kesb' && t.ai_allowed)) {
    const base = templates.find((t) => t.organization_id === null && t.domain === 'kesb');
    const created = await call(`${org}/assessment-templates`, 'POST', {
      name: `${base.name} (KI)`, domain: 'kesb', description: base.description, sections: base.sections, ai_allowed: true,
    });
    if (!created?.ok) throw new Error(`cases scene: could not create the AI template (${created?.message ?? created?.error})`);
  }
  const { cases = [] } = (await call(`${org}/cases?search=${CASE_REF}`)) ?? {};
  for (const c of cases.filter((c) => c.reference_number === CASE_REF)) await call(`${org}/cases/${c.id}`, 'DELETE');
}

SCENES.cases = {
  user: 'marta',
  async prepare(page) {
    await prepareCases();
    await page.reload();
    await page.locator('.MuiDrawer-root').first().waitFor();
    await sleep(1500);
  },
  async run(s) {
    const p = s.page;
    await s.title('Fallführung', 'Eine KESB-Abklärung: von den Akten zum Gutachtenentwurf');
    // An entry with sub-entries: its name includes the nested expand button.
    await s.click(p.locator('.MuiDrawer-root').getByRole('button', { name: /^Gutachten/ }).first(), 1200);
    // Cases are end-to-end encrypted: Marta unlocks them with her passphrase (the seed's demo one).
    await s.caption('Jeder Fall ist Ende-zu-Ende verschlüsselt – entsperrt mit der eigenen Passphrase');
    await s.click(p.getByText('Gesperrt', { exact: true }).first(), 900);
    const unlock = p.getByRole('dialog');
    await s.type(unlock.getByLabel('Passphrase'), 'marta-cases-demo', 300);
    await s.click(unlock.getByRole('button', { name: 'Entsperren' }), 300);
    await p.getByText('Entsperrt', { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {});
    await s.wait(1200);
    await s.caption('Ein neues Falldossier: Geschäftsnummer, betroffene Person und Vertraulichkeit');
    await s.click(p.getByRole('button', { name: 'Neuer Fall' }).first(), 900);
    const dlg = p.getByRole('dialog');
    await s.type(dlg.getByLabel(/^Geschäfts-Nr/), CASE_REF, 200);
    await s.type(dlg.getByLabel('Fallbezeichnung'), 'Gefährdungsmeldung Erwachsenenschutz', 200);
    await s.type(dlg.getByLabel(/^Betroffene Person/), 'Jonas Meier', 200);
    await s.choose(dlg.getByRole('combobox', { name: /^Vertraulichkeit/ }), 'Streng vertraulich');
    await s.click(dlg.getByRole('button', { name: 'Erstellen' }), 2000);

    await s.caption('Der Arztbericht als PDF – sein Text wird automatisch ausgelesen');
    await s.click(p.getByRole('tab', { name: /^Akten & Beweismittel/ }), 900);
    await s.click(p.getByRole('button', { name: 'Beweismittel hochladen' }).first(), 900);
    const up = p.getByRole('dialog');
    await up.locator('#case-doc-file-input').setInputFiles(join(SAMPLE, 'arztbericht-jonas-meier.pdf'));
    await s.wait(700);
    await s.choose(up.getByRole('combobox', { name: /^Kategorie/ }), 'Medizinisch / Psychiatrisch');
    await s.click(up.getByRole('button', { name: 'Hochladen' }), 2000);
    await s.click(p.getByRole('button', { name: 'Text anzeigen' }).first(), 1200);
    await s.wait(2600);
    await s.click(p.getByRole('dialog').getByRole('button', { name: 'Schliessen' }), 800);

    await s.caption('Die Befragung der Schwester – mit der Tonaufnahme des Gesprächs');
    await s.click(p.getByRole('tab', { name: /^Einvernahmen/ }), 900);
    await s.click(p.getByRole('button', { name: 'Einvernahme erfassen' }).first(), 900);
    const iv = p.getByRole('dialog');
    await s.type(iv.getByLabel('Name der befragten Person'), 'Laura Meier', 200);
    await s.choose(iv.getByRole('combobox', { name: /^Rolle im Verfahren/ }), 'Angehörige Person');
    await iv.locator('input[type=file]').first().setInputFiles(join(SAMPLE, 'interview-laura-meier-ch.mp3'));
    await s.wait(900);
    // Saving with the audio starts the transcription in the same dialog.
    await s.caption('Transkribiert in der Schweiz (Microsoft Azure) – in Sekunden statt Minuten');
    await s.click(iv.getByRole('button', { name: 'Speichern und transkribieren' }), 300);
    const ed = p.getByRole('dialog');
    // An empty field is filled directly (a draft to accept only replaces existing text).
    const filled = async (label, timeout) => {
      const box = ed.getByLabel(label);
      for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(500)) if ((await box.inputValue().catch(() => '')).trim()) return box;
      throw new Error(`${label} stayed empty`);
    };
    const transcript = await filled('Vollständiges Transkript / Protokoll', 300000);
    await s.wait(800);
    await s.caption('Die Fachperson prüft das Transkript, bevor sie es speichert');
    await s.moveTo(transcript, 0.5, 0.3);
    await s.wait(2600);
    await s.click(ed.getByRole('button', { name: 'Speichern', exact: true }), 1800);

    await s.caption('Die Zusammenfassung: nur Aussagen aus dem Transkript, Unklares bleibt offen');
    await s.click(ed.getByRole('button', { name: 'Zusammenfassung entwerfen' }), 300);
    const summary = await filled('Zusammenfassung / Kernaussagen', 120000);
    await s.moveTo(summary, 0.5, 0.3);
    await s.wait(2800);
    await s.click(ed.getByRole('button', { name: 'Speichern', exact: true }), 1600);
    await s.click(ed.getByRole('button', { name: 'Schliessen' }), 1200);

    await s.caption('Das Gutachten nach der Vorlage der Organisation – als KI-Entwurf aus den Akten');
    await s.click(p.getByRole('tab', { name: /^Beurteilungen/ }), 900);
    await s.click(p.getByRole('button', { name: 'Neues Gutachten anlegen' }).first(), 900);
    const ga = p.getByRole('dialog');
    await s.choose(ga.getByRole('combobox', { name: /^Gutachten-Vorlage/ }), /\(KI\)/);
    const title = ga.getByLabel('Titel der Beurteilung');
    if (!(await title.inputValue())) await s.type(title, 'Abklärungsbericht Jonas Meier', 200);
    await s.caption('Vor dem Versand sagt Apensum, wohin die Daten gehen – hier: Azure in der Schweiz');
    await s.moveTo(ga.getByText('Microsoft Azure (Schweiz)', { exact: false }).first());
    await s.wait(1600);
    await s.click(ga.getByRole('checkbox', { name: /Versand dieser Daten/ }), 600);
    await s.click(ga.getByRole('button', { name: 'KI-Entwurf generieren' }), 300);
    await p.getByRole('button', { name: /Zurück zu Beurteilungen/ }).waitFor({ timeout: 180000 });
    await s.wait(1000);
    await s.caption('Die KI gibt nur wieder, was in den Akten steht – mit Quelle; jede Beurteilung bleibt «[Offen]»');
    await p.mouse.move(720, 500);
    for (let i = 0; i < 4; i++) {
      await p.mouse.wheel(0, 320);
      await s.wait(1300);
    }
    const open = p.getByText(/\[Offen/).first();
    if (await open.count()) await s.moveTo(open);
    await s.wait(1800);
    await s.caption('Prüfen, ergänzen, beurteilen – und als PDF exportieren');
    await s.moveTo(p.getByRole('button', { name: 'PDF exportieren' }).first());
    await s.wait(2400);
    await s.caption('');
    await s.wait(600);
  },
};

/** The month after the current one, YYYY-MM (the roster scene plans it). */
function nextMonth() {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// Shift planning (the roster plugin, licensed; the seed turns it on for Acme): Ulla (HR) plans next month.
// Reading the wish calls Azure (Switzerland), like the employee scene.
SCENES.roster = {
  user: 'ulla',
  // Off camera: next month starts empty of automatic shifts, unpublished, without wishes from an earlier take.
  async prepare(page) {
    const { call, orgId } = await apiAs('ulla');
    const month = nextMonth();
    await call(`/organizations/${orgId}/roster/publish?month=${month}`, 'DELETE');
    await call(`/organizations/${orgId}/roster/auto-plan?month=${month}`, 'DELETE');
    const data = (await call(`/organizations/${orgId}/roster?month=${month}`)) ?? {};
    for (const w of data.wishes ?? []) await call(`/organizations/${orgId}/roster/wishes/${w.id}`, 'DELETE');
    await page.reload();
    await page.locator('.MuiDrawer-root').first().waitFor();
    await sleep(1500);
  },
  async run(s) {
    const p = s.page;
    await s.title('Dienstplan', 'Schichten planen – mit Regelprüfung, Wünschen und Vorschlag');
    await s.nav('Dienstplan');
    await s.click(p.getByRole('button', { name: 'Nächster Monat' }), 1400);

    await s.caption('Schichten und Bedarf pro Wochentag – mit Qualifikationen wie Pflegefachperson');
    await s.click(p.getByRole('tab', { name: 'Schichten und Bedarf' }), 2600);
    await s.click(p.getByRole('tab', { name: 'Plan' }), 1200);

    await s.caption('Marta wünscht sich etwas – in ihren eigenen Worten');
    const marta = p.getByRole('row').filter({ hasText: 'Marta' }).first();
    await s.click(marta.getByRole('button', { name: 'Wünsche' }), 900);
    const dlg = p.getByRole('dialog');
    await s.type(dlg.getByPlaceholder(/vor dem 10/i), 'Bitte vor dem 10. keine Nachtdienste, und am 24. und 25. möchte ich frei haben.', 300);
    await s.caption('Die KI (Azure, Schweiz) liest daraus Regeln – geprüft, bevor sie gelten');
    await s.click(dlg.getByRole('button', { name: 'Mit KI auslesen' }), 300);
    // The rules read from the text, shown before they are saved.
    const rule = dlg.locator('.MuiChip-outlinedPrimary').first();
    await rule.waitFor({ timeout: 60000 });
    await s.wait(500);
    await s.moveTo(rule);
    await s.wait(2800);
    await s.click(dlg.getByRole('button', { name: 'Wunsch speichern' }), 1800);
    const close = p.getByRole('dialog').getByRole('button', { name: /Schliessen|Abbrechen/ });
    if (await close.count()) await s.click(close.first(), 900);

    await s.caption('Ein Vorschlag für den ganzen Monat: Ruhezeiten, Wochenhöchstzeit, Wünsche und Fairness');
    await s.click(p.getByRole('button', { name: 'Automatisch planen' }), 2200);
    await s.caption('Was offen bleibt, sagt warum: wer abwesend ist, wem die Qualifikation fehlt …');
    const alert = p.locator('.MuiAlert-root').filter({ hasText: /vorgeschlagen/ }).first();
    await s.moveTo(alert, 0.3, 0.6);
    await s.wait(3200);
    await s.click(p.getByRole('button', { name: 'Übernehmen' }), 2000);

    await s.caption('Die Regelprüfung und die Besetzung pro Schicht laufen beim Planen mit');
    await p.mouse.move(720, 500);
    for (let i = 0; i < 3; i++) {
      await p.mouse.wheel(0, 300);
      await s.wait(1100);
    }
    await s.wait(1200);
    await p.mouse.wheel(0, -900);
    await s.wait(900);

    await s.caption('Veröffentlicht: Alle sehen ihre Schichten – und der Plan wird ihre Sollzeit');
    await s.click(p.getByRole('button', { name: 'Veröffentlichen' }).first(), 1000);
    await s.click(p.getByRole('dialog').getByRole('button', { name: 'Veröffentlichen' }), 2200);
    await s.moveTo(p.getByText(/^Veröffentlicht/).first());
    await s.wait(2400);
    await s.caption('');
    await s.wait(600);
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
