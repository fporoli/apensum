import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeTextValid, attributeValue, registerStaticAttributes, staticAttributes, staticAttributesOf, staticValueLabel, withAttribute } from './staticData.ts';

test('the core declares the properties of absence and request types; label lists have none', () => {
  assert.deepEqual(staticAttributesOf('absences', 'absence_type')?.map((a) => a.key), ['approval', 'unpaid']);
  assert.deepEqual(staticAttributesOf(' requests ', 'request_type')?.map((a) => a.key), ['confidential']);
  assert.equal(staticAttributesOf('expenses', 'currency'), null);
});

test("a plugin's list is registered, and declaring it again replaces it", () => {
  registerStaticAttributes({ entity: 'x', enumName: 'y', attributes: [{ key: 'a', type: 'text', label: 'l' }] });
  registerStaticAttributes({ entity: 'x', enumName: 'y', attributes: [{ key: 'b', type: 'text', label: 'l' }] });
  assert.deepEqual(staticAttributesOf('x', 'y')?.map((a) => a.key), ['b']);
});

test('a checkbox is stored only when it differs from its default, other fields only with a value', () => {
  const approval = { key: 'approval', type: 'checkbox', label: 'l', default: true };
  const vat = { key: 'vat', type: 'select', label: 'l', options: [{ value: 'standard', label: 's' }] };
  assert.deepEqual(withAttribute({ sort: 2 }, approval, false), { sort: 2, approval: false });
  assert.deepEqual(withAttribute({ sort: 2, approval: false }, approval, true), { sort: 2 });
  assert.deepEqual(withAttribute({}, vat, 'standard'), { vat: 'standard' });
  assert.deepEqual(withAttribute({ vat: 'standard' }, vat, ''), {});
  assert.equal(attributeValue({}, approval), true);
  assert.equal(attributeValue({ vat: 'standard' }, vat), 'standard');
});

test('text properties follow their pattern and length', () => {
  const account = { key: 'account', type: 'text', label: 'l', pattern: '[0-9]{4}', maxLength: 4 };
  assert.equal(attributeTextValid(account, '5820'), true);
  assert.equal(attributeTextValid(account, '58 20'), false);
  assert.equal(attributeTextValid(account, ''), true);
});

test('labels come from the translations; a property value is never a label', () => {
  const labels = { values: { travel: 'Travel', meals: { vat: 'standard' } }, translation: { de: { travel: 'Reisen' }, en: { meals: 'Meals' } } };
  assert.equal(staticValueLabel(labels, 'de', 'travel'), 'Reisen');
  assert.equal(staticValueLabel(labels, 'fr', 'travel'), 'Travel');
  assert.equal(staticValueLabel(labels, 'fr', 'meals'), 'Meals');
  assert.equal(staticValueLabel(labels, 'fr', 'other'), 'other');
  assert.deepEqual(staticAttributes(labels, 'meals'), { vat: 'standard' });
  assert.deepEqual(staticAttributes(labels, 'travel'), {});
});
