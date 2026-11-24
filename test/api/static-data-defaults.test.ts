import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { builtInKeys, checkDefaultValues } from '../../apps/api/src/static-data-defaults';

const row = { values: { sick: { approval: false }, vacation: {}, school: {} }, operator_keys: ['school'] };

test('the built-in keys of a default list are those operators did not add', () => {
  assert.deepEqual(builtInKeys(row), ['sick', 'vacation']);
  assert.deepEqual(builtInKeys({ values: { a: 'A' } }), ['a']);
});

test('operators add values and change or remove their own; built-in values stay as they are', () => {
  assert.deepEqual(checkDefaultValues(row, { vacation: {}, sick: { approval: false }, militia: { unpaid: true } }), {
    ok: true, values: { vacation: {}, sick: { approval: false }, militia: { unpaid: true } }, operatorKeys: ['militia'],
  }, 'school removed, militia added, key order does not matter');
  assert.deepEqual(checkDefaultValues(row, { sick: {}, vacation: {} }), { ok: false, error: 'built-in-value', key: 'sick' });
  assert.deepEqual(checkDefaultValues(row, { sick: { approval: false } }), { ok: false, error: 'built-in-value', key: 'vacation' });
  assert.deepEqual(checkDefaultValues(row, 'x'), { ok: false, error: 'invalid-values' });
});

test('a new list is all the operators\'', () => {
  assert.deepEqual(checkDefaultValues(null, { b: 'B', a: 'A' }), { ok: true, values: { b: 'B', a: 'A' }, operatorKeys: ['a', 'b'] });
});
