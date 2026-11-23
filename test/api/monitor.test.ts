import { strict as assert } from 'node:assert';
import { test } from 'node:test';
// @ts-expect-error plain JavaScript module without types
import { alertMail, evaluate, judgeHealth, judgePage } from '../../scripts/monitor-lib.mjs';

const now = new Date('2026-11-23T10:00:00Z');
const later = new Date('2026-11-23T10:10:00Z');

test('health: up when it says ok; a failing mail relay counts as a failure; pages accept redirects', () => {
  assert.deepEqual(judgeHealth(200, { status: 'ok', smtp: 'ok' }), { ok: true, detail: 'ok' });
  assert.equal(judgeHealth(200, { status: 'ok', smtp: 'failed' }).ok, false);
  assert.equal(judgeHealth(502, null).detail, 'HTTP 502');
  assert.equal(judgePage(302).ok, true);
  assert.equal(judgePage(500).ok, false);
});

test('a check is reported once after two failed runs, and once when it recovers', () => {
  const down = [{ id: 'prod api', ok: false, detail: 'HTTP 502' }];
  const first = evaluate({}, down, [], now);
  assert.deepEqual(first.events, [], 'one failure (a blip or a demo reset) mails nobody');
  const second = evaluate(first.state, down, [], later);
  assert.deepEqual(second.events.map((e: any) => e.kind), ['down']);
  const third = evaluate(second.state, down, [], later);
  assert.deepEqual(third.events, [], 'still down: not mailed again');
  const back = evaluate(third.state, [{ id: 'prod api', ok: true, detail: 'ok' }], [], later);
  assert.deepEqual(back.events.map((e: any) => e.kind), ['recovered']);
  const blip = evaluate(evaluate({}, down, [], now).state, [{ id: 'prod api', ok: true, detail: 'ok' }], [], later);
  assert.deepEqual(blip.events, [], 'a single failure that recovers mails nothing');
});

test('a certificate near its end is reported once a day', () => {
  const soon = [{ host: 'api.apensum.ch', daysLeft: 9 }];
  const first = evaluate({}, [], soon, now);
  assert.deepEqual(first.events.map((e: any) => e.kind), ['certificate']);
  assert.deepEqual(evaluate(first.state, [], soon, later).events, [], 'same day: not again');
  assert.equal(evaluate(first.state, [], soon, new Date('2026-11-24T10:00:00Z')).events.length, 1, 'next day: again');
  assert.deepEqual(evaluate({}, [], [{ host: 'x', daysLeft: 60 }], now).events, []);
});

test('the mail names what is down first', () => {
  const m = alertMail([{ kind: 'down', id: 'prod api', detail: 'HTTP 502' }, { kind: 'recovered', id: 'demo web', detail: 'ok' }], now);
  assert.equal(m.subject, 'Apensum monitor: 1 check(s) failing');
  assert.match(m.text, /DOWN  prod api  HTTP 502\nRECOVERED  demo web  ok/);
});
