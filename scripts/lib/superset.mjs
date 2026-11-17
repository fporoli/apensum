// Talking to Superset's REST API as its admin, for scripts/superset-setup.mjs and superset-export.mjs:
// waits until it answers, logs in (JWT), keeps the session cookie and CSRF token that write calls need.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectSuperset({ url, user = 'admin', password }) {
  for (let i = 0; ; i++) {
    const ok = await fetch(`${url}/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i === 90) throw new Error(`Superset does not answer on ${url}`);
    if (i % 10 === 0) console.log('superset: waiting for Superset to start …');
    await sleep(2000);
  }

  let cookie = '';
  let token = '';
  let csrf = '';
  const headers = (extra = {}) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrf ? { 'X-CSRFToken': csrf, Referer: url } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  });
  const keepCookie = (res) => {
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  };

  /** A JSON call; 404 is returned (callers check `status`), other failures throw. */
  async function call(method, path, body) {
    const res = await fetch(url + path, {
      method,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    keepCookie(res);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return { status: res.status, json };
  }

  /** The raw bytes of a GET (exports are ZIP files). */
  async function download(path) {
    const res = await fetch(url + path, { headers: headers() });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** A multipart POST (imports). */
  async function upload(path, form) {
    const res = await fetch(url + path, { method: 'POST', headers: headers(), body: form });
    keepCookie(res);
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${text.slice(0, 600)}`);
    return JSON.parse(text);
  }

  token = (await call('POST', '/api/v1/security/login', { username: user, password, provider: 'db', refresh: false })).json.access_token;
  if (!token) throw new Error('Superset login failed');
  csrf = (await call('GET', '/api/v1/security/csrf_token/')).json.result;
  return { call, download, upload };
}
