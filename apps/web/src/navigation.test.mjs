import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavTree, placeForCaller, sectionHashes } from './navigation.ts';

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

test('an entry with `last` goes to the end of its group, behind the ones that follow others', async () => {
  const { buildNavTree } = await import('./navigation.ts');
  const tree = buildNavTree([{ id: 'g', header: '' }], [
    { section: 'docs', nav: { group: 'g' } },
    { section: 'mine', nav: { group: 'g', last: true } },
    { section: 'notes', nav: { group: 'g', after: 'docs' } },
    { section: 'more', nav: { group: 'g' } },
  ]);
  assert.deepEqual(tree[0].items.map((i) => i.page.section), ['docs', 'notes', 'more', 'mine']);
});

test('a page held only for oneself moves where `ownOnly` says (parent, label, after); the others stay', () => {
  const pages = [
    { section: 'myData', nav: { group: 'p', last: true, label: 'nav.myData' } },
    { section: 'documents', nav: { group: 'p', parent: 'myData', label: 'nav.documents' } },
    { section: 'dash', object: 'o.dash', nav: { group: 'p', after: 'myData', label: 'nav.dash', ownOnly: { parent: 'myData', label: 'nav.myDash' } } },
    { section: 'reviews', object: 'o.dash', nav: { group: 'p', after: 'dash', label: 'nav.reviews', ownOnly: { parent: 'myData', label: 'nav.myReviews', after: 'dash' } } },
  ];
  // A manager (beyond own): as listed.
  assert.deepEqual(tree([{ id: 'p', header: '' }], placeForCaller(pages, () => false)), [{ id: 'p', items: ['dash', 'reviews', 'myData[documents]'] }]);
  // Only their own: under My Data, after Documents, with their own labels.
  const own = placeForCaller(pages, (p) => p.object === 'o.dash');
  assert.deepEqual(tree([{ id: 'p', header: '' }], own), [{ id: 'p', items: ['myData[documents,dash,reviews]'] }]);
  assert.equal(own.find((p) => p.section === 'dash').nav.label, 'nav.myDash');
  assert.equal(own.find((p) => p.section === 'reviews').nav.label, 'nav.myReviews');
  // The input is left as it was.
  assert.equal(pages[2].nav.label, 'nav.dash');
});
