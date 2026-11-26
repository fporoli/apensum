import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canChangeStatus, cleanRequestText } from '../../apps/api/src/requests.controller';
import { permissionIdsOf } from '../../apps/api/src/access';

test('handlers move a request freely; the requester only resolves or reopens it', () => {
  const handler = { handler: true, requester: false };
  const requester = { handler: false, requester: true };
  assert.equal(canChangeStatus('open', 'in_progress', handler, false), true);
  assert.equal(canChangeStatus('resolved', 'open', handler, false), true);
  assert.equal(canChangeStatus('open', 'resolved', requester, false), true);
  assert.equal(canChangeStatus('resolved', 'open', requester, false), true);
  assert.equal(canChangeStatus('open', 'in_progress', requester, false), false);
  assert.equal(canChangeStatus('in_progress', 'open', requester, false), false);
  assert.equal(canChangeStatus('open', 'open', handler, false), false);
  assert.equal(canChangeStatus('open', 'resolved', { handler: false, requester: false }, false), false);
});

test('archived requests are read-only', () => {
  assert.equal(canChangeStatus('resolved', 'open', { handler: true, requester: true }, true), false);
});

test('request text is trimmed and bounded', () => {
  assert.equal(cleanRequestText('  hi  ', 10), 'hi');
  assert.equal(cleanRequestText('   ', 10), null);
  assert.equal(cleanRequestText('x'.repeat(11), 10), null);
  assert.equal(cleanRequestText(42, 10), null);
});

test('permissionIdsOf drops the permissions of a module the organization switched off', async () => {
  const rows = (modules: unknown) => [
    { name: 'member', permission_id: 'nav.requests:edit:own', modules },
    { name: 'member', permission_id: 'nav.time:edit:own', modules },
  ];
  const db = (modules: unknown) => ({ execute: async () => ({ rows: rows(modules) }) }) as any;
  assert.deepEqual([...(await permissionIdsOf(db({ requests: false }), 'o', 'u'))].sort(), ['nav.time:edit:own']);
  assert.deepEqual([...(await permissionIdsOf(db(null), 'o', 'u'))].sort(), ['nav.requests:edit:own', 'nav.time:edit:own']);
});

test('a notification previews the text, else the attached file names', async () => {
  const { messagePreview } = await import('../../apps/api/src/requests.controller');
  assert.equal(messagePreview('Hello', ['a.pdf']), 'Hello');
  assert.equal(messagePreview(null, ['a.pdf', 'b.png']), '📎 a.pdf, b.png');
});

test('validateRequestDetails on create: type required when the org has types, link checked', async () => {
  const { validateRequestDetails } = await import('../../apps/api/src/requests.controller');
  const keys = ['service', 'support', 'other'];
  assert.deepEqual(validateRequestDetails({ type: 'support', urgent: 'true', link: 'jira.example.com/IT-1' }, keys), {
    ok: true,
    value: { request_type: 'support', urgent: true, link_url: 'https://jira.example.com/IT-1', due_date: null },
  });
  assert.deepEqual(validateRequestDetails({ type: 'service' }, keys), { ok: true, value: { request_type: 'service', urgent: false, link_url: null, due_date: null } });
  assert.deepEqual(validateRequestDetails({}, keys), { ok: false, error: 'request-type-required' });
  assert.deepEqual(validateRequestDetails({ type: 'hack' }, keys), { ok: false, error: 'unknown-request-type' });
  assert.deepEqual(validateRequestDetails({ type: 'service', link: 'javascript:alert(1)' }, keys), { ok: false, error: 'invalid-link' });
  // An org without types sends requests without one.
  assert.deepEqual(validateRequestDetails({}, []), { ok: true, value: { request_type: null, urgent: false, link_url: null, due_date: null } });
  assert.deepEqual(validateRequestDetails({ dueDate: '2026-12-15' }, []), { ok: true, value: { request_type: null, urgent: false, link_url: null, due_date: '2026-12-15' } });
  assert.deepEqual(validateRequestDetails({ dueDate: '15.12.2026' }, []), { ok: false, error: 'invalid-due-date' });
});

test('validateRequestDetails on update: only given fields, an older type may stay', async () => {
  const { validateRequestDetails } = await import('../../apps/api/src/requests.controller');
  const keys = ['service', 'support'];
  assert.deepEqual(validateRequestDetails({ urgent: true }, keys, { request_type: 'retired' }), { ok: true, value: { urgent: true } });
  assert.deepEqual(validateRequestDetails({ type: 'retired' }, keys, { request_type: 'retired' }), { ok: true, value: { request_type: 'retired' } });
  assert.deepEqual(validateRequestDetails({ type: 'other' }, keys, { request_type: 'service' }), { ok: false, error: 'unknown-request-type' });
  assert.deepEqual(validateRequestDetails({ link: '' }, keys, { request_type: 'service' }), { ok: true, value: { link_url: null } });
  assert.deepEqual(validateRequestDetails({ dueDate: '' }, keys, { request_type: 'service' }), { ok: true, value: { due_date: null } });
  assert.deepEqual(validateRequestDetails({ dueDate: '2027-01-04' }, keys, { request_type: 'service' }), { ok: true, value: { due_date: '2027-01-04' } });
});

test('the overdue alert mail is in the recipient\'s language and links to the request', async () => {
  const { overdueMail } = await import('../../apps/api/src/requests.service');
  const r = { id: 'abc', subject: 'Sperrfrist endet: Uma A', due_date: '2026-12-15' };
  const de = overdueMail(r, 'de');
  assert.equal(de.subject, 'Überfällig: Sperrfrist endet: Uma A');
  assert.match(de.text, /am 15\.12\.2026 fällig/);
  assert.match(de.text, /#\/requests\?id=abc/);
  assert.match(overdueMail(r, 'fr').subject, /^En retard/);
  assert.match(overdueMail(r, null).subject, /^Überfällig/);
});

test('a confidential request keeps its subject out of notification titles and alert mails', async () => {
  const { noticeSubject, overdueMail } = await import('../../apps/api/src/requests.service');
  const r = { id: 'abc', subject: 'Lohnfortzahlung erschöpft: Uma A', confidential: true, due_date: '2026-12-15' };
  assert.equal(noticeSubject(r), 'Confidential flow');
  assert.equal(noticeSubject({ ...r, confidential: false }), r.subject);
  for (const lang of ['en', 'de', 'fr', 'it', null]) {
    const mail = overdueMail(r, lang);
    for (const part of [mail.subject, mail.title, mail.text]) assert.doesNotMatch(part, /Uma|Lohnfortzahlung/);
    assert.match(mail.text, /#\/requests\?id=abc/);
  }
  assert.equal(overdueMail(r, 'de').subject, 'Überfällig: Vertraulicher Flow');
});
