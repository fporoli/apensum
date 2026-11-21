import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDueDate, cleanRequestLink, isRequestOverdue, requestTypeKeys, requestTypeLabel, requestTypeOptions } from './requests.ts';

test('cleanRequestLink accepts http(s) links and adds https to a bare host', () => {
  assert.equal(cleanRequestLink('https://jira.example.com/browse/IT-42'), 'https://jira.example.com/browse/IT-42');
  assert.equal(cleanRequestLink('  http://intranet.acme.ch/x  '), 'http://intranet.acme.ch/x');
  assert.equal(cleanRequestLink('github.com/fporoli/apensum/issues/1'), 'https://github.com/fporoli/apensum/issues/1');
  assert.equal(cleanRequestLink('http://localhost:3001/#/requests'), 'http://localhost:3001/#/requests');
});

test('cleanRequestLink: empty is null, anything else unusable is undefined', () => {
  assert.equal(cleanRequestLink(''), null);
  assert.equal(cleanRequestLink('   '), null);
  assert.equal(cleanRequestLink(null), null);
  assert.equal(cleanRequestLink(undefined), null);
  assert.equal(cleanRequestLink('javascript:alert(1)'), undefined);
  assert.equal(cleanRequestLink('ftp://example.com/x'), undefined);
  assert.equal(cleanRequestLink('foo'), undefined);
  assert.equal(cleanRequestLink('two words.com'), undefined);
  assert.equal(cleanRequestLink(42), undefined);
  assert.equal(cleanRequestLink(`https://example.com/${'x'.repeat(2000)}`), undefined);
});

const values = { other: { sort: 3 }, service: { sort: 1 }, support: { sort: 2 } };
const translation = {
  en: { service: 'Service request', support: 'Support', other: 'Other' },
  de: { service: 'Serviceanfrage', support: 'Support', other: 'Anderes' },
};

test('requestTypeOptions follows the sort attribute and translates', () => {
  assert.deepEqual(requestTypeOptions(values, translation, 'de').map((o) => o.label), ['Serviceanfrage', 'Support', 'Anderes']);
  // No French labels: English is used.
  assert.deepEqual(requestTypeOptions(values, translation, 'fr').map((o) => o.value), ['service', 'support', 'other']);
});

test('requestTypeOptions: types without sort come last by label, kept values are added', () => {
  const opts = requestTypeOptions({ b: {}, a: {}, first: { sort: 1 } }, {}, 'en', ['legacy', null]);
  assert.deepEqual(opts.map((o) => o.value), ['first', 'a', 'b', 'legacy']);
  assert.deepEqual(requestTypeOptions(null, null, 'en'), []);
});

test('requestTypeKeys and requestTypeLabel', () => {
  assert.deepEqual(requestTypeKeys(values), ['other', 'service', 'support']);
  assert.deepEqual(requestTypeKeys([]), []);
  assert.equal(requestTypeLabel(translation, 'it', 'support'), 'Support');
  assert.equal(requestTypeLabel(undefined, 'de', 'x'), 'x');
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
  assert.equal(isRequestOverdue({ due_date: '2026-11-20', status: 'open' }, '2026-11-21'), true);
  assert.equal(isRequestOverdue({ due_date: '2026-11-21', status: 'open' }, '2026-11-21'), false);
  assert.equal(isRequestOverdue({ due_date: '2026-11-20', status: 'resolved' }, '2026-11-21'), false);
  assert.equal(isRequestOverdue({ due_date: '2026-11-20', status: 'in_progress', archived_at: '2026-11-20T10:00:00Z' }, '2026-11-21'), false);
  assert.equal(isRequestOverdue({ due_date: null, status: 'open' }, '2026-11-21'), false);
});
