// Takes the screenshots of the website's features page (feature-<shot>-<lang>.jpg in apps/site/media,
// not in git), from the dev stack with demo data, in each of the site's four languages.
//
//   npm run dev:seed                          # demo data up to yesterday
//   npm run site:screens [-- time-1 admin-2]  # all shots, or some; needs the dev API and web running
//   npm run site:videos:publish               # upload them with the videos, then deploy the site
//
// Before the shots it creates what the pages should show and the seed lacks: a pending vacation
// request and a request thread between Ueli and Marco (once; reruns find them). The shot ids are
// the ones src/pages.mjs FEATURE_SHOTS names; each one is the app's content area (no navbar).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(ROOT, '..', 'media');
const OUT = join(ROOT, 'out');
const BASE = process.env.RECORD_BASE || 'http://localhost:3001';
const API = process.env.RECORD_API || 'http://localhost:8001/api/v1';
const LANGS = ['de', 'fr', 'it', 'en'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
async function api(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
async function apiLogin(user) {
  const r = await api(null, 'POST', '/auth/login', { email: `${user}@acme.com`, password: user });
  if (!r.ok) throw new Error(`login ${user}: ${r.error}`);
  return { token: r.token, orgId: r.memberships[0].organizationId };
}

/** First Monday after the first of next month and that week's Friday (yyyy-mm-dd). */
function nextMonthWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const fri = new Date(d);
  fri.setUTCDate(d.getUTCDate() + 4);
  return [d.toISOString().slice(0, 10), fri.toISOString().slice(0, 10)];
}

async function prepare() {
  const ueli = await apiLogin('ueli');
  const marco = await apiLogin('marco');
  const [from, to] = nextMonthWeek();
  const absences = await api(ueli.token, 'GET', `/organizations/${ueli.orgId}/absences`);
  const list = Array.isArray(absences) ? absences : (absences.absences ?? absences.items ?? []);
  if (!list.some((a) => String(a.dateStart ?? a.date_start).startsWith(from))) {
    const r = await api(ueli.token, 'POST', `/organizations/${ueli.orgId}/absences`, { dateStart: from, dateEnd: to, absenceType: 'vacation', note: 'Skiferien in Arosa' });
    console.log('screens: vacation request', r.ok ? 'created' : r.error);
  }
  const subject = 'Änderung Arbeitspensum ab Januar';
  const requests = await api(ueli.token, 'GET', `/organizations/${ueli.orgId}/requests`);
  const reqs = Array.isArray(requests) ? requests : (requests.requests ?? requests.items ?? []);
  if (!reqs.some((r) => r.subject === subject)) {
    const r = await api(ueli.token, 'POST', `/organizations/${ueli.orgId}/requests`, {
      target: 'manager',
      type: 'other',
      subject,
      message: 'Hallo Marco, ich möchte ab Januar auf 80 % reduzieren, freitags frei. Wäre das möglich?',
    });
    console.log('screens: request', r.ok ? 'created' : r.error);
    const id = r.request?.id ?? r.id;
    if (id) await api(marco.token, 'POST', `/organizations/${marco.orgId}/requests/${id}/messages`, { body: 'Grundsätzlich ja. Ich bespreche es mit HR und melde mich bis Ende Woche.' });
  }
}

// ---------------------------------------------------------------------------------------------
/** Each shot: who, which page (hash route), what to do there, and optionally a region to keep. */
const SHOTS = {
  'time-1': { user: 'ueli', hash: '#/home' },
  'time-2': { user: 'ulla', hash: '#/work-time', tab: 1 },
  // The entry dialog of an existing session: the day under it (other sessions, absences, hints).
  'time-3': { user: 'ueli', hash: '#/work-time', dialog: true, async go(p) {
    // an afternoon session after lunch: the morning one shows as the same day's entry
    const row = p.locator('main tbody tr').filter({ hasText: /1[23]:\d\d.*1[67]:\d\d/ }).first();
    await row.getByRole('button', { name: /^(Bearbeiten|Modifier|Modifica|Edit)$/ }).click();
    await p.getByRole('dialog').waitFor();
  } },
  'project-1': { user: 'ueli', hash: '#/time', async go(p) {
    await p.getByRole('button', { name: /^(Monat|Mois|Mese|Month)$/ }).first().click();
    await sleep(1200);
    await p.mouse.wheel(0, 430);
  } },
  'absences-1': { user: 'ulla', hash: '#/absences', tab: 1, async go(p) {
    await p.mouse.wheel(0, 300);
  } },
  'balances-1': { user: 'ulla', hash: '#/balances' },
  'balances-2': { user: 'ueli', hash: '#/timesheet' },
  'balances-3': { user: 'ulla', hash: '#/balances', tab: 1 },
  'timesheets-1': { user: 'marco', hash: '#/approvals' },
  'expenses-1': { user: 'ueli', hash: '#/expenses' },
  'requests-1': { user: 'marco', hash: '#/requests', tab: 1, async go(p) {
    await p.getByText('Änderung Arbeitspensum ab Januar').first().click();
  } },
  'documents-1': { user: 'ueli', hash: '#/documents' },
  'admin-1': { user: 'admin', hash: '#/admin/roles' },
  'admin-2': { user: 'admin', hash: '#/org-settings' },
  'tenants-1': { user: 'admin', hash: '#/home', full: true, async go(p) {
    await p.getByRole('combobox').first().click();
  } },
  // The installed app on a phone: the whole screen, no clipping.
  'mobile-1': { user: 'ueli', hash: '#/home', phone: true },
  'mobile-2': { user: 'ueli', hash: '#/expenses', phone: true, async go(p) {
    // down to the receipt: its drop zone, with the camera button
    await p.evaluate(() => document.querySelector('main input[type=file]')?.parentElement?.scrollIntoView({ block: 'center' }));
  } },
  // The login screen itself (nobody signed in): its first tab, then Register.
  'access-1': { signedOut: 0 },
  'access-2': { signedOut: 1 },
};

const CONTEXT = { viewport: { width: 1320, height: 820 }, deviceScaleFactor: 2, locale: 'de-CH', timezoneId: 'Europe/Zurich' };
/** An iPhone-sized screen (390 x 844 points) with touch, for the `phone` shots. */
const PHONE = { ...CONTEXT, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** The login card in `lang` (the app keeps the language in localStorage), on tab `tab`. */
async function shootSignedOut(browser, lang, tab, file) {
  const context = await browser.newContext(CONTEXT);
  try {
    await context.addInitScript((l) => localStorage.setItem('worktime.locale', l), lang);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(BASE);
    await page.getByRole('tab').nth(tab).click();
    await sleep(1500); // the SSO check settles
    await page.mouse.move(2, 2);
    const card = await page.getByRole('tablist').locator('xpath=ancestor::div[contains(@class,"MuiPaper-root")][1]').boundingBox();
    const m = 24;
    await page.screenshot({ path: file, type: 'jpeg', quality: 82, clip: { x: card.x - m, y: card.y - m, width: card.width + 2 * m, height: card.height + 2 * m } });
  } finally {
    await context.close();
  }
}

async function login(browser, user, lang, phone = false) {
  const context = await browser.newContext(phone ? PHONE : CONTEXT);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  // The demo users' saved languages differ: show the app in the page's language.
  await page.route(/\/api\/v1\/(auth\/login|users\/me)$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object') {
      if ('locale' in body) body.locale = lang;
      if (body.user && typeof body.user === 'object') body.user.locale = lang;
    }
    await route.fulfill({ response: res, json: body ?? undefined });
  });
  await page.goto(BASE);
  await page.getByRole('textbox').first().fill(`${user}@acme.com`);
  await page.locator('input[type=password]').first().fill(user);
  await page.keyboard.press('Enter');
  await page.locator('header').first().waitFor(); // on a phone the navbar is a hidden drawer
  await sleep(1200);
  return { context, page };
}

/** Where the page's cards end (empty background below is cut off), at most the viewport. */
async function contentBottom(page, max) {
  const bottom = await page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('main .MuiPaper-root, main table')].map((e) => e.getBoundingClientRect().bottom)),
  );
  return Math.min(max, Math.max(420, Math.ceil(bottom) + 24));
}

async function shoot(page, id, shot, file) {
  await page.evaluate((h) => { window.location.hash = h; }, shot.hash);
  await sleep(1800);
  if (shot.tab !== undefined) {
    await page.locator('main').getByRole('tab').nth(shot.tab).click();
    await sleep(1500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  if (shot.go) {
    await shot.go(page);
    await sleep(1500);
  }
  const vp = page.viewportSize();
  await page.mouse.move(2, vp.height - 2); // no hover effects or tooltips
  await sleep(400);
  // The page without the assistant's tab on the right edge; `full` keeps navbar and app bar.
  const b = await page.locator('main').first().boundingBox();
  const bar = (await page.locator('header').first().boundingBox())?.height ?? 64;
  const right = Math.min(b.x + b.width, vp.width);
  if (shot.phone) {
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    return;
  }
  if (shot.dialog) {
    // The dialog alone, with a margin of the dimmed page around it; closed again afterwards.
    const d = await page.locator('.MuiDialog-paper').first().boundingBox();
    const m = 24;
    await page.screenshot({ path: file, type: 'jpeg', quality: 82, clip: { x: d.x - m, y: Math.max(0, d.y - m), width: d.width + 2 * m, height: Math.min(vp.height, d.height + 2 * m) } });
    await page.keyboard.press('Escape');
    return;
  }
  const clip = shot.full
    ? { x: 0, y: 0, width: right, height: vp.height }
    : { x: b.x, y: bar, width: right - b.x, height: (await contentBottom(page, vp.height)) - bar };
  await page.screenshot({ path: file, type: 'jpeg', quality: 82, clip });
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = wanted.length ? wanted : Object.keys(SHOTS);
for (const id of ids) if (!SHOTS[id]) throw new Error(`unknown shot ${id} (${Object.keys(SHOTS).join(', ')})`);
mkdirSync(MEDIA, { recursive: true });
mkdirSync(OUT, { recursive: true });
await prepare();
const browser = await chromium.launch();
try {
  for (const lang of LANGS) {
    const sessions = new Map();
    for (const id of ids) {
      const shot = SHOTS[id];
      if (shot.signedOut !== undefined) {
        const file = join(MEDIA, `feature-${id}-${lang}.jpg`);
        await shootSignedOut(browser, lang, shot.signedOut, file)
          .then(() => console.log(`screens: ${file}`))
          .catch((err) => console.error(`screens: ${id} (${lang}) failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`));
        continue;
      }
      // One fresh login per user and language; shots that open menus get their own.
      const key = shot.full ? `${shot.user}:${id}` : shot.phone ? `${shot.user}:phone` : shot.user;
      if (!sessions.has(key)) sessions.set(key, await login(browser, shot.user, lang, !!shot.phone));
      const { page } = sessions.get(key);
      const file = join(MEDIA, `feature-${id}-${lang}.jpg`);
      try {
        await shoot(page, id, shot, file);
        console.log(`screens: ${file}`);
      } catch (err) {
        await page.screenshot({ path: join(OUT, `screen-${id}-${lang}-error.png`) }).catch(() => {});
        console.error(`screens: ${id} (${lang}) failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      }
      if (shot.full) await page.keyboard.press('Escape').catch(() => {});
    }
    for (const { context } of sessions.values()) await context.close();
  }
} finally {
  await browser.close();
}
