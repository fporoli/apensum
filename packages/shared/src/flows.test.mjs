import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDueDate, cleanFlowLink, isFlowOverdue, flowTypeConfidential, flowTypeKeys, flowTypeLabel, flowTypeOptions } from './flows.ts';

test('cleanFlowLink accepts http(s) links and adds https to a bare host', () => {
  assert.equal(cleanFlowLink('https://jira.example.com/browse/IT-42'), 'https://jira.example.com/browse/IT-42');
  assert.equal(cleanFlowLink('  http://intranet.acme.ch/x  '), 'http://intranet.acme.ch/x');
  assert.equal(cleanFlowLink('github.com/fporoli/apensum/issues/1'), 'https://github.com/fporoli/apensum/issues/1');
  assert.equal(cleanFlowLink('http://localhost:3001/#/requests'), 'http://localhost:3001/#/requests');
});

test('cleanFlowLink: empty is null, anything else unusable is undefined', () => {
  assert.equal(cleanFlowLink(''), null);
  assert.equal(cleanFlowLink('   '), null);
  assert.equal(cleanFlowLink(null), null);
  assert.equal(cleanFlowLink(undefined), null);
  assert.equal(cleanFlowLink('javascript:alert(1)'), undefined);
  assert.equal(cleanFlowLink('ftp://example.com/x'), undefined);
  assert.equal(cleanFlowLink('foo'), undefined);
  assert.equal(cleanFlowLink('two words.com'), undefined);
  assert.equal(cleanFlowLink(42), undefined);
  assert.equal(cleanFlowLink(`https://example.com/${'x'.repeat(2000)}`), undefined);
});

const values = { other: { sort: 3 }, service: { sort: 1 }, support: { sort: 2 } };
const translation = {
  en: { service: 'Service request', support: 'Support', other: 'Other' },
  de: { service: 'Serviceanfrage', support: 'Support', other: 'Anderes' },
};

test('flowTypeOptions follows the sort attribute and translates', () => {
  assert.deepEqual(flowTypeOptions(values, translation, 'de').map((o) => o.label), ['Serviceanfrage', 'Support', 'Anderes']);
  // No French labels: English is used.
  assert.deepEqual(flowTypeOptions(values, translation, 'fr').map((o) => o.value), ['service', 'support', 'other']);
});

test('flowTypeOptions: types without sort come last by label, kept values are added', () => {
  const opts = flowTypeOptions({ b: {}, a: {}, first: { sort: 1 } }, {}, 'en', ['legacy', null]);
  assert.deepEqual(opts.map((o) => o.value), ['first', 'a', 'b', 'legacy']);
  assert.deepEqual(flowTypeOptions(null, null, 'en'), []);
});

test('flowTypeKeys and flowTypeLabel', () => {
  assert.deepEqual(flowTypeKeys(values), ['other', 'service', 'support']);
  assert.deepEqual(flowTypeKeys([]), []);
  assert.equal(flowTypeLabel(translation, 'it', 'support'), 'Support');
  assert.equal(flowTypeLabel(undefined, 'de', 'x'), 'x');
});

test('due dates: a real day, empty means none', () => {
  assert.equal(cleanDueDate('2026-12-31'), '2026-12-31');
  assert.equal(cleanDueDate(''), null);
  assert.equal(cleanDueDate(null), null);
  assert.equal(cleanDueDate('2026-02-30'), undefined);
  assert.equal(cleanDueDate('31.12.2026'), undefined);
  assert.equal(cleanDueDate('1999-12-31'), undefined);
  assert.equal(cleanDueDate(20261231), undefined);
});

test('overdue: past the due date and still open', () => {
  assert.equal(isFlowOverdue({ due_date: '2026-11-20', status: 'open' }, '2026-11-21'), true);
  assert.equal(isFlowOverdue({ due_date: '2026-11-21', status: 'open' }, '2026-11-21'), false);
  assert.equal(isFlowOverdue({ due_date: '2026-11-20', status: 'resolved' }, '2026-11-21'), false);
  assert.equal(isFlowOverdue({ due_date: '2026-11-20', status: 'in_progress', archived_at: '2026-11-20T10:00:00Z' }, '2026-11-21'), false);
  assert.equal(isFlowOverdue({ due_date: null, status: 'open' }, '2026-11-21'), false);
});

test('a type is confidential by its attribute', () => {
  const values = { hr: { sort: 4, confidential: true }, service: { sort: 1 }, odd: 'x' };
  assert.equal(flowTypeConfidential(values, 'hr'), true);
  assert.equal(flowTypeConfidential(values, 'service'), false);
  assert.equal(flowTypeConfidential(values, 'odd'), false);
  assert.equal(flowTypeConfidential(values, null), false);
  assert.equal(flowTypeConfidential(undefined, 'hr'), false);
});
