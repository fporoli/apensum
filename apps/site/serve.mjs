// Local preview of the website: builds, serves dist/ on http://localhost:3010 and rebuilds on
// changes. Behaves like the production server (infra/site/Caddyfile): / redirects by browser
// language, folders serve index.html, unknown paths get 404.html.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, DEFAULT_LANG } from './src/layout.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3010);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4' };

/** The first supported language in Accept-Language, as the server does. */
export function preferredLang(header) {
  const first = String(header ?? '').trim().slice(0, 2).toLowerCase();
  return LANGS.includes(first) ? first : DEFAULT_LANG;
}

/** Builds in a child process: a re-import here would keep the cached templates and texts. */
function rebuild() {
  // With the draft news posts: the preview is where they are read before they go out.
  const r = spawnSync(process.execPath, [join(ROOT, 'build.mjs'), '--drafts'], { stdio: 'inherit' });
  if (r.status !== 0) console.error('site: build failed (the previous files are still served)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rebuild();
  let timer;
  for (const dir of ['src', 'static', 'content']) {
    if (!existsSync(join(ROOT, dir))) continue;
    watch(join(ROOT, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    });
  }
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(302, { Location: `/${preferredLang(req.headers['accept-language'])}/` });
      res.end();
      return;
    }
    let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) {
      res.writeHead(400).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${url.pathname}/` }).end();
        return;
      }
      file = join(file, 'index.html');
    }
    const found = existsSync(file) && statSync(file).isFile();
    const path = found ? file : join(DIST, '404.html');
    res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(path));
  }).listen(PORT, () => console.log(`site: http://localhost:${PORT}`));
}
