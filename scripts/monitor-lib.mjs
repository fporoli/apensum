// The outside monitor's logic (scripts/monitor.mjs, .github/workflows/monitor.yml), pure so it is tested
// (test/api/monitor.test.ts): what a check's result means, and which mails the change since the last run gives.

/** Failed runs in a row before a check is reported (a demo reset or a blip must not mail anyone). */
export const FAILS_BEFORE_ALERT = 2;
/** A certificate this close to its end is reported, once a day. */
export const CERT_WARN_DAYS = 14;

/** A health endpoint's answer: up when it says so; the mail relay's state is a warning of its own. */
export function judgeHealth(httpStatus, body) {
  if (httpStatus !== 200 || !body || body.status !== 'ok') return { ok: false, detail: `HTTP ${httpStatus}${body?.status ? `, status ${body.status}` : ''}` };
  if (body.smtp === 'failed') return { ok: false, detail: 'mail relay failing (smtp: failed)' };
  return { ok: true, detail: 'ok' };
}

/** A page: any 2xx or a redirect. */
export function judgePage(httpStatus) {
  return httpStatus >= 200 && httpStatus < 400 ? { ok: true, detail: 'ok' } : { ok: false, detail: `HTTP ${httpStatus}` };
}

/**
 * The new state and the events to mail, from the last state and this run's results.
 * results: [{ id, ok, detail }]; certs: [{ host, daysLeft }]; state: { checks: {id: {fails, alerted}}, certs: {host: 'YYYY-MM-DD'} }.
 */
export function evaluate(previous, results, certs, now) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const checks = { ...(prev.checks ?? {}) };
  const certState = { ...(prev.certs ?? {}) };
  const events = [];
  for (const r of results) {
    const before = checks[r.id] ?? { fails: 0, alerted: false };
    if (r.ok) {
      if (before.alerted) events.push({ kind: 'recovered', id: r.id, detail: r.detail });
      checks[r.id] = { fails: 0, alerted: false };
    } else {
      const fails = before.fails + 1;
      const alert = !before.alerted && fails >= FAILS_BEFORE_ALERT;
      if (alert) events.push({ kind: 'down', id: r.id, detail: r.detail });
      checks[r.id] = { fails, alerted: before.alerted || alert };
    }
  }
  const today = now.toISOString().slice(0, 10);
  for (const c of certs) {
    if (c.daysLeft === null || c.daysLeft > CERT_WARN_DAYS) { delete certState[c.host]; continue; }
    if (certState[c.host] !== today) events.push({ kind: 'certificate', id: c.host, detail: `expires in ${c.daysLeft} day(s)` });
    certState[c.host] = today;
  }
  return { state: { checks, certs: certState }, events };
}

/** The alert mail's subject and text. */
export function alertMail(events, now) {
  const down = events.filter((e) => e.kind === 'down').length;
  const subject = down
    ? `Apensum monitor: ${down} check(s) failing`
    : events.some((e) => e.kind === 'certificate') ? 'Apensum monitor: certificate expiring' : 'Apensum monitor: all recovered';
  const label = { down: 'DOWN', recovered: 'RECOVERED', certificate: 'CERTIFICATE' };
  const lines = events.map((e) => `${label[e.kind]}  ${e.id}  ${e.detail}`);
  return { subject, text: `${lines.join('\n')}\n\nChecked ${now.toISOString()} by .github/workflows/monitor.yml.\n` };
}
