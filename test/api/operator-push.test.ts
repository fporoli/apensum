import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ntfyRequest, pushToOperator } from '../../apps/api/src/operator-push';
import { contactPush } from '../../apps/api/src/site-contact.controller';

test('the request ntfy takes: the server, and the topic in a JSON body (UTF-8 titles intact)', () => {
  assert.deepEqual(ntfyRequest('https://ntfy.sh/apensum-7f3k9q', { title: 'Neue Registrierung', message: 'Über die Website', tags: ['tada'] }), {
    url: 'https://ntfy.sh/',
    body: { topic: 'apensum-7f3k9q', title: 'Neue Registrierung', message: 'Über die Website', tags: ['tada'] },
  });
  assert.equal(ntfyRequest('https://ntfy.example.ch/a/b', { title: 't', message: 'm' }), null);
  assert.equal(ntfyRequest('ftp://ntfy.sh/topic', { title: 't', message: 'm' }), null);
  assert.equal(ntfyRequest('not a url', { title: 't', message: 'm' }), null);
});

test('nothing without NTFY_TOPIC_URL; a failing ntfy fails nothing', async () => {
  let calls = 0;
  const fetchOk = (async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://ntfy.sh/');
    assert.equal(JSON.parse(String(init.body)).topic, 'apensum-x');
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await pushToOperator({ title: 't', message: 'm' }, {}, fetchOk), false);
  assert.equal(calls, 0);
  assert.equal(await pushToOperator({ title: 't', message: 'm' }, { NTFY_TOPIC_URL: 'https://ntfy.sh/apensum-x' }, fetchOk), true);
  assert.equal(calls, 1);
  const fetchDown = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await pushToOperator({ title: 't', message: 'm' }, { NTFY_TOPIC_URL: 'https://ntfy.sh/apensum-x' }, fetchDown), false);
  const fetch500 = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await pushToOperator({ title: 't', message: 'm' }, { NTFY_TOPIC_URL: 'https://ntfy.sh/apensum-x' }, fetch500), false);
});

test('a contact message\'s push names its topic only, never who wrote or what', () => {
  assert.match(contactPush('pilot').message, /Erste Kunden \/ Pilot/);
  assert.match(contactPush('<script>').message, /Allgemeine Frage/);
  const text = JSON.stringify(contactPush('demo'));
  assert.doesNotMatch(text, /@|Name/);
});
