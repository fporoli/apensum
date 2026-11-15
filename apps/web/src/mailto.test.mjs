import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MAILTO_BODY, mailtoHref } from './mailto.ts';

test('mailtoHref encodes recipients, subject and body for mail programs', () => {
  const href = mailtoHref({ to: ['a@x.ch', 'b@x.ch', 'a@x.ch', '', null], subject: 'Anfrage: Ferien & Lohn', body: 'Hallo\nzweite Zeile' });
  assert.equal(href, 'mailto:a%40x.ch,b%40x.ch?subject=Anfrage%3A%20Ferien%20%26%20Lohn&body=Hallo%0D%0Azweite%20Zeile');
});

test('mailtoHref works without recipients and adds cc', () => {
  assert.equal(mailtoHref({ cc: ['c@x.ch'], subject: 's', body: 'b' }), 'mailto:?cc=c%40x.ch&subject=s&body=b');
});

test('mailtoHref shortens long bodies', () => {
  const body = decodeURIComponent(mailtoHref({ subject: 's', body: 'x'.repeat(5000) }).split('body=')[1]);
  assert.equal(body.length, MAX_MAILTO_BODY);
  assert.ok(body.endsWith('…'));
});
