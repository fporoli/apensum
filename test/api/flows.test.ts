import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canChangeStatus, cleanFlowText } from '../../apps/api/src/flows.controller';
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
  assert.equal(cleanFlowText('  hi  ', 10), 'hi');
  assert.equal(cleanFlowText('   ', 10), null);
  assert.equal(cleanFlowText('x'.repeat(11), 10), null);
  assert.equal(cleanFlowText(42, 10), null);
});

test('permissionIdsOf drops the permissions of a module the organization switched off', async () => {
  const rows = (modules: unknown) => [
    { name: 'member', permission_id: 'nav.flows:edit:own', modules },
    { name: 'member', permission_id: 'nav.time:edit:own', modules },
  ];
  const db = (modules: unknown) => ({ execute: async () => ({ rows: rows(modules) }) }) as any;
  assert.deepEqual([...(await permissionIdsOf(db({ flows: false }), 'o', 'u'))].sort(), ['nav.time:edit:own']);
  assert.deepEqual([...(await permissionIdsOf(db(null), 'o', 'u'))].sort(), ['nav.flows:edit:own', 'nav.time:edit:own']);
});

test('a notification previews the text, else the attached file names', async () => {
  const { messagePreview } = await import('../../apps/api/src/flows.controller');
  assert.equal(messagePreview('Hello', ['a.pdf']), 'Hello');
  assert.equal(messagePreview(null, ['a.pdf', 'b.png']), '📎 a.pdf, b.png');
});

test('validateFlowDetails on create: type required when the org has types, link checked', async () => {
  const { validateFlowDetails } = await import('../../apps/api/src/flows.controller');
  const keys = ['service', 'support', 'other'];
  assert.deepEqual(validateFlowDetails({ type: 'support', urgent: 'true', link: 'jira.example.com/IT-1' }, keys), {
    ok: true,
    value: { flow_type: 'support', urgent: true, link_url: 'https://jira.example.com/IT-1', due_date: null },
  });
  assert.deepEqual(validateFlowDetails({ type: 'service' }, keys), { ok: true, value: { flow_type: 'service', urgent: false, link_url: null, due_date: null } });
  assert.deepEqual(validateFlowDetails({}, keys), { ok: false, error: 'flow-type-required' });
  assert.deepEqual(validateFlowDetails({ type: 'hack' }, keys), { ok: false, error: 'unknown-flow-type' });
  assert.deepEqual(validateFlowDetails({ type: 'service', link: 'javascript:alert(1)' }, keys), { ok: false, error: 'invalid-link' });
  // An org without types sends requests without one.
  assert.deepEqual(validateFlowDetails({}, []), { ok: true, value: { flow_type: null, urgent: false, link_url: null, due_date: null } });
  assert.deepEqual(validateFlowDetails({ dueDate: '2026-12-15' }, []), { ok: true, value: { flow_type: null, urgent: false, link_url: null, due_date: '2026-12-15' } });
  assert.deepEqual(validateFlowDetails({ dueDate: '15.12.2026' }, []), { ok: false, error: 'invalid-due-date' });
});

test('validateFlowDetails on update: only given fields, an older type may stay', async () => {
  const { validateFlowDetails } = await import('../../apps/api/src/flows.controller');
  const keys = ['service', 'support'];
  assert.deepEqual(validateFlowDetails({ urgent: true }, keys, { flow_type: 'retired' }), { ok: true, value: { urgent: true } });
  assert.deepEqual(validateFlowDetails({ type: 'retired' }, keys, { flow_type: 'retired' }), { ok: true, value: { flow_type: 'retired' } });
  assert.deepEqual(validateFlowDetails({ type: 'other' }, keys, { flow_type: 'service' }), { ok: false, error: 'unknown-flow-type' });
  assert.deepEqual(validateFlowDetails({ link: '' }, keys, { flow_type: 'service' }), { ok: true, value: { link_url: null } });
  assert.deepEqual(validateFlowDetails({ dueDate: '' }, keys, { flow_type: 'service' }), { ok: true, value: { due_date: null } });
  assert.deepEqual(validateFlowDetails({ dueDate: '2027-01-04' }, keys, { flow_type: 'service' }), { ok: true, value: { due_date: '2027-01-04' } });
});

test('the overdue alert mail is in the recipient\'s language and links to the request', async () => {
  const { overdueMail } = await import('../../apps/api/src/flows.service');
  const r = { id: 'abc', subject: 'Sperrfrist endet: Uma A', due_date: '2026-12-15' };
  const de = overdueMail(r, 'de');
  assert.equal(de.subject, 'Überfällig: Sperrfrist endet: Uma A');
  assert.match(de.text, /am 15\.12\.2026 fällig/);
  assert.match(de.text, /#\/flows\?id=abc/);
  assert.match(overdueMail(r, 'fr').subject, /^En retard/);
  assert.match(overdueMail(r, null).subject, /^Überfällig/);
});

test('a confidential request keeps its subject out of notification titles and alert mails', async () => {
  const { noticeSubject, overdueMail } = await import('../../apps/api/src/flows.service');
  const r = { id: 'abc', subject: 'Lohnfortzahlung erschöpft: Uma A', confidential: true, due_date: '2026-12-15' };
  assert.equal(noticeSubject(r), 'Confidential flow');
  assert.equal(noticeSubject({ ...r, confidential: false }), r.subject);
  for (const lang of ['en', 'de', 'fr', 'it', null]) {
    const mail = overdueMail(r, lang);
    for (const part of [mail.subject, mail.title, mail.text]) assert.doesNotMatch(part, /Uma|Lohnfortzahlung/);
    assert.match(mail.text, /#\/flows\?id=abc/);
  }
  assert.equal(overdueMail(r, 'de').subject, 'Überfällig: Vertraulicher Flow');
});
