import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, BAD_RESPONSE, CANNOT_REACH_API } from './apiRequest.ts';

const answer = (status, body) => async () => ({ ok: status < 400, status, json: async () => (body === undefined ? JSON.parse('<html>') : body) });

test('an answer becomes ok + data, a refusal its error code', async () => {
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(200, { ok: true, people: [1] }) }), { ok: true, data: { ok: true, people: [1] } });
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(200, [1, 2]) }), { ok: true, data: [1, 2] }, 'a list');
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(200, { ok: false, error: 'forbidden' }) }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(200, { ok: false }) }), { ok: false, error: 'unknown' });
});

test('network, non-JSON and HTTP errors are codes too; an abort still rejects', async () => {
  assert.deepEqual(await apiRequest('/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), { ok: false, error: CANNOT_REACH_API });
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(200, undefined) }), { ok: false, error: BAD_RESPONSE });
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(502, undefined) }), { ok: false, error: 'http-502' });
  assert.deepEqual(await apiRequest('/x', { fetchImpl: answer(401, { message: 'Unauthorized' }) }), { ok: false, error: 'http-401' });
  await assert.rejects(apiRequest('/x', { fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } }), /aborted/);
});

test('a body goes as JSON with its content type; headers are kept', async () => {
  let seen;
  await apiRequest('/x', { method: 'POST', body: { a: 1 }, headers: { Authorization: 'Bearer t' }, fetchImpl: async (url, init) => { seen = init; return answer(200, { ok: true })(); } });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.body, '{"a":1}');
  assert.deepEqual(seen.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer t' });
});
