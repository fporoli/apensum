import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeTextValid, attributeValue, effectiveRow, keepLabels, propertiesOf, staticAttributes, staticValueLabel, withAttribute } from './staticData.ts';

// The rows an organization sees: the global descriptions (core and plugin migrations), the organization's copy with
// one property of its own (and a try at changing a global one), and the lists the choices come from.
const rows = [
  {
    organization_id: null, entity: 'static_data', enum_name: 'properties',
    values: {
      'absences.absence_type.approval': { type: 'checkbox', default: true, sort: '1' },
      'absences.absence_type.unpaid': { type: 'checkbox', sort: '2' },
      'expenses.expense_category.vat': { type: 'select', list: 'expenses.vat_kind', sort: '1' },
      'expenses.expense_category.account': { type: 'text', pattern: '[0-9]{4}', sort: '2' },
      'static_data.properties.type': { type: 'select', list: 'static_data.property_type' },
      'odd.list.x': { type: 'colour' },
    },
    translation: { en: { 'absences.absence_type.approval': 'Needs approval', 'expenses.expense_category.vat': 'Default VAT' }, de: { 'expenses.expense_category.vat': 'Standard-MWST' } },
  },
  {
    organization_id: 'org-1', entity: 'static_data', enum_name: 'properties',
    values: { 'expenses.expense_category.costCentre': { type: 'text', sort: '3' }, 'expenses.expense_category.account': { type: 'checkbox' } },
    translation: { de: { 'expenses.expense_category.costCentre': 'Kostenstelle' } },
  },
  { organization_id: null, entity: 'expenses', enum_name: 'vat_kind', values: { standard: 'Normal rate', none: 'No VAT' }, translation: { de: { standard: 'Normalsatz' } } },
  { organization_id: null, entity: 'static_data', enum_name: 'property_type', values: { checkbox: 'Checkbox', select: 'Choice', text: 'Text' }, translation: {} },
];

test("a list's properties come from the descriptions, in their order, labelled, with a choice's options", () => {
  const props = propertiesOf(rows, 'expenses', 'expense_category', 'de');
  assert.deepEqual(props, [
    { key: 'vat', type: 'select', label: 'Standard-MWST', options: [{ value: 'standard', label: 'Normalsatz' }, { value: 'none', label: 'No VAT' }] },
    { key: 'account', type: 'text', label: 'expenses.expense_category.account', pattern: '[0-9]{4}' },
    { key: 'costCentre', type: 'text', label: 'Kostenstelle' },
  ], "the organization's own property is added; the global account stays a text");
  assert.deepEqual(propertiesOf(rows, 'absences', 'absence_type', 'en')?.map((a) => [a.key, a.default]), [['approval', true], ['unpaid', false]]);
  assert.equal(propertiesOf(rows, 'expenses', 'currency', 'en'), null, 'a list of labels');
  assert.equal(propertiesOf(rows, 'odd', 'list', 'en'), null, 'an unknown type is left out');
  assert.deepEqual(propertiesOf(rows, 'static_data', 'properties', 'en')?.[0].options?.map((o) => o.value), ['checkbox', 'select', 'text'], 'the descriptions describe themselves');
});

test("a list as an organization sees it: its copy, else the global one", () => {
  assert.equal(effectiveRow([...rows, { organization_id: 'org-1', entity: 'expenses', enum_name: 'vat_kind', values: {} }], 'expenses', 'vat_kind').organization_id, 'org-1');
  assert.equal(effectiveRow(rows, 'expenses', 'vat_kind').organization_id, null);
});

test('a checkbox is stored only when it differs from its default, other fields only with a value', () => {
  const approval = { key: 'approval', type: 'checkbox', label: 'l', default: true };
  const vat = { key: 'vat', type: 'select', label: 'l', options: [{ value: 'standard', label: 's' }] };
  assert.deepEqual(withAttribute({ sort: 2 }, approval, false), { sort: 2, approval: false });
  assert.deepEqual(withAttribute({ sort: 2, approval: false }, approval, true), { sort: 2 });
  assert.deepEqual(withAttribute({}, vat, 'standard'), { vat: 'standard' });
  assert.deepEqual(withAttribute({ vat: 'standard' }, vat, ''), {});
  assert.equal(attributeValue({}, approval), true);
  assert.equal(attributeValue({ sort: 3 }, { key: 'sort', type: 'text', label: 'l' }), '3');
});

test('text properties follow their pattern; a broken pattern allows anything', () => {
  const account = { key: 'account', type: 'text', label: 'l', pattern: '[0-9]{4}' };
  assert.equal(attributeTextValid(account, '5820'), true);
  assert.equal(attributeTextValid(account, '58 20'), false);
  assert.equal(attributeTextValid(account, ''), true);
  assert.equal(attributeTextValid({ ...account, pattern: '[' }, 'x'), true);
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

test('a radio: one value of the list, stored as true on it only', () => {
  // The rows organization org-2 sees: the global ones and its own copy.
  const withRadio = [...rows.filter((r) => r.organization_id !== 'org-1'), {
    organization_id: 'org-2', entity: 'static_data', enum_name: 'properties',
    values: { 'users.locales.usedefault': { type: 'radio' } }, translation: { de: { 'users.locales.usedefault': 'Standard' } },
  }];
  assert.deepEqual(propertiesOf(withRadio, 'users', 'locales', 'de'), [{ key: 'usedefault', type: 'radio', label: 'Standard' }]);
  const radio = { key: 'usedefault', type: 'radio', label: 'Standard' };
  assert.deepEqual(withAttribute({}, radio, true), { usedefault: true });
  assert.deepEqual(withAttribute({ usedefault: true }, radio, false), {});
  assert.equal(attributeValue({ usedefault: true }, radio), true);
  assert.equal(attributeValue({}, radio), false);
});

test('a list of labels that gets properties keeps its labels as English translations', () => {
  assert.deepEqual(
    keepLabels({ de: 'Deutsch', fr: 'Français', it: {} }, { en: { de: 'German' }, de: { fr: 'Französisch' } }),
    { en: { de: 'German', fr: 'Français' }, de: { fr: 'Französisch' } },
  );
  assert.deepEqual(keepLabels({ x: {} }, { de: { x: 'X' } }), { de: { x: 'X' } });
});
