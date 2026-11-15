#!/usr/bin/env node
// Waits until an API started *after* this script answers on /health (its `startedAt`), so the
// "Development Web" launch opens Chrome only once the freshly built API is up, never against a
// leftover one. Gives up after the timeout without failing, so Chrome still opens.
// Usage: node scripts/wait-for-api.mjs [url] [timeoutSeconds]
const url = process.argv[2] ?? 'http://localhost:8001/api/v1/health';
const timeoutMs = Number(process.argv[3] ?? 240) * 1000;
const since = Date.now() - 2000; // tolerate a little clock skew between the two processes

const deadline = Date.now() + timeoutMs;
let said = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    const started = Date.parse(data?.startedAt ?? '');
    if (res.ok && started >= since) {
      console.log(`API is up (${url})`);
      process.exit(0);
    }
  } catch {
    // not up yet
  }
  if (!said) {
    console.log(`waiting for the API to start (${url}) ...`);
    said = true;
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.warn(`the API did not come up within ${timeoutMs / 1000}s; opening the browser anyway`);
