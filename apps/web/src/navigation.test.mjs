import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavTree, sectionHashes } from './navigation.ts';

const tree = (groups, pages) =>
  buildNavTree(groups, pages).map((g) => ({
    id: g.id,
    items: g.items.map((i) => (i.children.length ? `${i.page.section}[${i.children.map((c) => c.section).join(',')}]` : i.page.section)),
  }));

test('groups keep their order; a group with `after` goes behind that group, an unknown one at the end', () => {
  const groups = [{ id: 'a', header: 'A' }, { id: 'b', header: 'B' }, { id: 'p', header: 'P', after: 'a' }, { id: 'q', header: 'Q', after: 'zz' }];
  assert.deepEqual(buildNavTree(groups, []).map((g) => g.id), ['a', 'p', 'b', 'q']);
});

test('entries go into their group in order, behind `after`, with sub-entries under their parent', () => {
  const pages = [
    { section: 'home', nav: { group: 'a' } },
    { section: 'users', nav: { group: 'a' } },
    { section: 'invitations', nav: { group: 'a', parent: 'users' } },
    { section: 'audit', nav: { group: 'b' } },
    { section: 'hidden' },
    { section: 'lost', nav: { group: 'nowhere' } },
    { section: 'orphan', nav: { group: 'a', parent: 'nobody' } },
    // a plugin's pages, listed after the core's
    { section: 'expenses', nav: { group: 'a', after: 'home' } },
    { section: 'processing', nav: { group: 'b', after: 'audit' } },
    { section: 'guests', nav: { group: 'a', parent: 'users', after: 'nobody' } },
    { section: 'roles', nav: { group: 'a', parent: 'users', after: 'zz' } },
  ];
  assert.deepEqual(tree([{ id: 'a', header: '' }, { id: 'b', header: '' }], pages), [
    { id: 'a', items: ['home', 'expenses', 'users[invitations,guests,roles]'] },
    { id: 'b', items: ['audit', 'processing'] },
  ]);
});

test('`after` works whichever page is listed first; a missing target puts the entry at the end', () => {
  const pages = [
    { section: 'news', nav: { group: 'o', after: 'reports' } },
    { section: 'reports', nav: { group: 'o', after: 'requests' } },
    { section: 'approvals', nav: { group: 'o' } },
    { section: 'lost', nav: { group: 'o', after: 'missing' } },
    { section: 'requests', nav: { group: 'o', after: 'approvals' } },
    { section: 'hr', nav: { group: 'o' } },
  ];
  assert.deepEqual(tree([{ id: 'o', header: '' }], pages), [{ id: 'o', items: ['approvals', 'requests', 'reports', 'news', 'hr', 'lost'] }]);
});

test('sections and hashes map both ways', () => {
  const { toHash, toSection } = sectionHashes([{ section: 'home', hash: '#/home' }, { section: 'expenses', hash: '#/expenses' }]);
  assert.equal(toHash.expenses, '#/expenses');
  assert.equal(toSection['#/home'], 'home');
});
