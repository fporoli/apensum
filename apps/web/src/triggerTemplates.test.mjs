import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowConfig, MAX_MESSAGE_SUBJECT, MAX_MESSAGE_TEXT } from '@worktime3/shared/workflowConfig';
import { TRIGGER_TEMPLATES, freeTypeKey, templateConfig } from '@worktime3/shared/triggerTemplates';

// The flow types' catalogue as the API registers it (apps/api/src/flow-steps.ts FLOW_CATALOGUE), as far as a template uses it.
const FLOWS = {
  id: 'flows.flow',
  definitionName: 'flow',
  rejectModes: ['none', 'back'],
  each: true,
  facts: { urgent: 'boolean' },
  blocks: {
    compose: { label: 'Write an e-mail', action: 'flow.done', returnAction: 'flow.returned', assignees: ['manager', 'department', 'team', 'person'], message: true, compose: true },
  },
  defaultConfig: { version: 1, steps: [] },
};

test('every template is a valid flow type configuration: one e-mail step to the person, to the department by its code', () => {
  for (const tpl of TRIGGER_TEMPLATES) {
    const config = templateConfig(tpl, 'hr');
    const checked = validateWorkflowConfig(FLOWS, config);
    assert.ok(checked.ok, `${tpl.event}: ${JSON.stringify(checked.errors)}`);
    assert.equal(config.steps[0].assignTo, 'department:hr');
    assert.equal(config.steps[0].mailTo, 'about');
    for (const l of ['de', 'fr', 'it', 'en']) {
      assert.ok(tpl.typeName[l] && tpl.subject[l] && tpl.text[l], `${tpl.event} ${l}`);
      assert.ok(tpl.subject[l].length <= MAX_MESSAGE_SUBJECT && tpl.text[l].length <= MAX_MESSAGE_TEXT, `${tpl.event} ${l}`);
      // German addresses people as Sie, never du.
      if (l === 'de') assert.doesNotMatch(tpl.text[l], /\b(du|dich|dir|dein\w*)\b/i, tpl.event);
    }
  }
  // The core's own events only; HR-Prozesse brings its own (plugins/hr/shared/trigger-templates.ts).
  assert.deepEqual(TRIGGER_TEMPLATES.map((t) => t.event), ['permitExpires']);
});

test('a template takes a free flow type key', () => {
  assert.equal(freeTypeKey('austritt', []), 'austritt');
  assert.equal(freeTypeKey('austritt', ['austritt']), 'austritt_2');
  assert.equal(freeTypeKey('austritt', ['austritt', 'austritt_2']), 'austritt_3');
});
