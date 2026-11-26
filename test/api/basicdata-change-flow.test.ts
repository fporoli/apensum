import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BASICDATA_FORM, mergeForm } from '@worktime3/shared/fields';
import { validateWorkflowConfig } from '@worktime3/shared/workflowConfig';
import { BASICDATA_CHANGE_CATALOGUE, changedFieldsOf } from '../../apps/api/src/basicdata.controller';

test('a change request names its fields and their sections, an organization\'s own keys included', () => {
  const form = mergeForm(BASICDATA_FORM);
  assert.deepEqual(changedFieldsOf({ street: 'Bahnhofstrasse 1', city: 'Zürich', orgs: { 'org-1': { birthDate: '1990-01-01' } } }, form), {
    fields: ['birthDate', 'city', 'street'],
    sections: ['address', 'personalien'],
  });
  assert.deepEqual(changedFieldsOf({ bankAccounts: [] }, form), { fields: ['bankAccounts'], sections: ['address'] });
});

test('the default configuration of the change flow is valid: HR reviews, rejecting ends it', () => {
  const checked = validateWorkflowConfig(BASICDATA_CHANGE_CATALOGUE, BASICDATA_CHANGE_CATALOGUE.defaultConfig);
  assert.equal(checked.ok, true);
  assert.equal(checked.ok && checked.value.steps[0].reject, 'end');
});
