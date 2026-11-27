import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cursorOf, foldText, likePattern, parseCursor, parseLimit, parseListFilters } from '../../apps/api/src/list-filters';

const ID = '3f0c8a2e-1b2c-4d5e-8f90-123456789abc';

test('the filters: what is malformed is left out', () => {
  assert.deepEqual(parseListFilters({}), { since: null, person: null, words: [] });
  assert.deepEqual(parseListFilters({ since: '2026-02-30', person: 'x', q: '   ' }), { since: null, person: null, words: [] });
  assert.deepEqual(parseListFilters({ since: '2026-10-28', person: ID, q: 'Zoë  MÜLLER zoe' }), { since: '2026-10-28', person: ID, words: ['zoe', 'muller'] });
  assert.equal(parseListFilters({ q: 'a b c d e f g h' }).words.length, 6, 'at most six words');
});

test('the search folds case and accents, and takes LIKE characters literally', () => {
  assert.equal(foldText('Élodie Çelik-Größe'), 'elodie celik-große');
  assert.equal(likePattern('50%_a\\b'), '%50\\%\\_a\\\\b%');
});

test('a cursor reads back, a malformed one is none', () => {
  const c = cursorOf({ id: ID, at: '2026-11-27 08:15:00.123456+00' });
  assert.equal(c, `2026-11-27T08:15:00.123Z|${ID}`);
  assert.deepEqual(parseCursor(c), { at: '2026-11-27T08:15:00.123Z', id: ID });
  for (const bad of [undefined, '', 'x|y', `nope|${ID}`, "2026-11-27T08:15:00Z|1'; DROP TABLE x;--"]) assert.equal(parseCursor(bad), null);
});

test('limit: none when missing, at most 1000', () => {
  assert.equal(parseLimit(undefined), 0);
  assert.equal(parseLimit('abc'), 0);
  assert.equal(parseLimit('-5'), 0);
  assert.equal(parseLimit('201'), 201);
  assert.equal(parseLimit('99999'), 1000);
});
