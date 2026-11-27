import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowConfig, MAX_MESSAGE_SUBJECT, MAX_MESSAGE_TEXT } from '@worktime3/shared/workflowConfig';
import { TRIGGER_TEMPLATES, freeTypeKey, templateConfig, templateNeedsDepartment } from '@worktime3/shared/triggerTemplates';

// The flow types' catalogue as the API registers it (apps/api/src/flow-steps.ts FLOW_CATALOGUE), as far as a template uses it.
const FLOWS = {
  id: 'flows.flow',
  definitionName: 'flow',
  rejectModes: ['none', 'back'],
  each: true,
  facts: { urgent: 'boolean' },
  blocks: {
    task: { label: 'Task', action: 'flow.done', returnAction: 'flow.returned', assignees: ['manager', 'department', 'team', 'person', 'permission:section.basicdata.personalien', 'about'] },
    compose: { label: 'Write an e-mail', action: 'flow.done', returnAction: 'flow.returned', assignees: ['manager', 'department', 'team', 'person', 'permission:section.basicdata.personalien'], message: true, compose: true },
  },
  defaultConfig: { version: 1, steps: [] },
};

test('every template is a valid flow type configuration: an e-mail step to the person first, by its handler', () => {
  for (const tpl of TRIGGER_TEMPLATES) {
    const config = templateConfig(tpl, 'hr');
    const checked = validateWorkflowConfig(FLOWS, config);
    assert.ok(checked.ok, `${tpl.event}: ${JSON.stringify(checked.errors)}`);
    assert.equal(config.steps[0].assignTo, templateNeedsDepartment(tpl) ? 'department:hr' : tpl.handler);
    assert.equal(config.steps[0].mailTo, 'about');
    for (const l of ['de', 'fr', 'it', 'en']) {
      assert.ok(tpl.typeName[l] && tpl.subject[l] && tpl.text[l], `${tpl.event} ${l}`);
      assert.ok(tpl.subject[l].length <= MAX_MESSAGE_SUBJECT && tpl.text[l].length <= MAX_MESSAGE_TEXT, `${tpl.event} ${l}`);
      // German addresses people as Sie, never du.
      if (l === 'de') assert.doesNotMatch(tpl.text[l], /\b(du|dich|dir|dein\w*)\b/i, tpl.event);
    }
  }
  // The permit's: whoever keeps everyone's personal data writes, the holder uploads the new one, HR records it; no department asked.
  const tpl = TRIGGER_TEMPLATES[0];
  assert.equal(templateNeedsDepartment(tpl), false);
  const permit = templateConfig(tpl, null);
  const hr = 'permission:section.basicdata.personalien';
  assert.deepEqual(permit.steps.map((s) => [s.key, s.do[0], s.assignTo, s.reject, s.remindDays]), [
    ['mail', 'compose', hr, 'back', undefined], ['upload', 'task', 'about', 'none', 5], ['record', 'task', hr, 'none', 5],
  ]);
  assert.ok(validateWorkflowConfig(FLOWS, permit).ok);
  // The core's own events only; HR-Prozesse brings its own (plugins/hr/shared/trigger-templates.ts).
  assert.deepEqual(TRIGGER_TEMPLATES.map((t) => t.event), ['permitExpires']);
});

test('a template takes a free flow type key', () => {
  assert.equal(freeTypeKey('austritt', []), 'austritt');
  assert.equal(freeTypeKey('austritt', ['austritt']), 'austritt_2');
  assert.equal(freeTypeKey('austritt', ['austritt', 'austritt_2']), 'austritt_3');
});
