import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, formDefinitionProblems, formFields, writableKeys } from './fields.ts';


for (const form of Object.values(FORMS)) {
  test(`${form.id}: the definition is consistent (keys, groups, orders, types, widths, storage)`, () => {
    assert.deepEqual(formDefinitionProblems(form), []);
  });
}

test('formDefinitionProblems names what is wrong', () => {
  const field = { key: 'a', storage: { kind: 'column', table: 't', column: 'a' }, type: 'text', caption: 'A', group: 'g', order: 1, width: 'm', optional: true, editableBy: 'hr' };
  const form = {
    id: 'x',
    groups: [{ key: 'g', caption: 'G', order: 1 }],
    fields: [field, { ...field, group: 'nope', order: 2 }, { ...field, key: 'b', type: 'select', width: 'huge', caption: '' }],
  };
  assert.deepEqual(formDefinitionProblems(form), [
    'duplicate key a',
    'a: unknown group nope',
    'g: duplicate order',
    'b: width huge',
    'b: select without options',
    'b: no caption',
    'two fields write t.a',
    'two fields write t.a',
  ]);
});

test('writableKeys leaves out read-only fields and keeps display order', () => {
  const keys = writableKeys(FORMS.basicdata, 'personalien');
  assert.ok(!keys.includes('companyEmail'));
  assert.equal(keys[0], 'displayName');
  assert.equal(keys.at(-1), 'residencePermitValidUntil');
});
