// Renders the website's brochures (apps/site/brochures: two A4 pages each) as PDFs into apps/site/static/downloads, with
// a 476×674 JPG preview of the first page beside each (the Brochures page shows it), in every language and for every
// audience, or only those named:
//
//   npm run site:brochures                 # all
//   npm run site:brochures -- fr en        # some languages
//
// Needs the network for the fonts (Google Fonts). Stops when a page's content does not fit (a translation too long:
// less than 16 px left at the page's foot), naming the page, so nothing is cut off silently.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { brochureHtml } from '../brochures/template.mjs';
import { BROCHURE_AUDIENCES, BROCHURE_FILES } from '../brochures/files.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '..', 'static', 'downloads');
const only = process.argv.slice(2);
const langs = Object.keys(BROCHURE_FILES).filter((l) => !only.length || only.includes(l));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
// 476 px wide previews of the 794 px pages.
const context = await browser.newContext({ viewport: { width: 794, height: 1122 }, deviceScaleFactor: 476 / 794 });
const page = await context.newPage();
const problems = [];
for (const lang of langs) {
  for (const audience of BROCHURE_AUDIENCES) {
    const file = BROCHURE_FILES[lang][audience];
    await page.setContent(brochureHtml(lang, audience), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // A page's content fits when at least 16 px stay free at the page's foot (the German originals reach a little into
    // the 48 px padding; the last block sits at the foot by margin-top: auto).
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.page > div')].map((box, i) => {
      const inner = box.getBoundingClientRect();
      const bottom = Math.max(...[...box.children].map((c) => c.getBoundingClientRect().bottom));
      const gaps = [...box.children].slice(1).map((c, k) => c.getBoundingClientRect().top - box.children[k].getBoundingClientRect().bottom);
      return { page: i + 1, over: Math.round(bottom - (inner.bottom - 16)), tightest: Math.round(Math.min(...gaps)) };
    }));
    for (const o of overflow) if (o.over > 0 || o.tightest < 20) problems.push(`${lang} ${audience} page ${o.page}: ${o.over > 0 ? `${o.over} px too long` : `only ${o.tightest} px between blocks`}`);
    await page.pdf({ path: join(OUT, file), width: '210mm', height: '297mm', printBackground: true, preferCSSPageSize: true });
    await page.locator('.page').first().screenshot({ path: join(OUT, file.replace(/\.pdf$/, '.jpg')), type: 'jpeg', quality: 82 });
    console.log(`${file}: ${overflow.map((o) => `page ${o.page} ${-o.over} px to spare`).join(', ')}`);
  }
}
await browser.close();
if (problems.length) {
  console.error(`\nDoes not fit:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
