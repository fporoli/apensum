import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationText } from './notificationText.ts';

const dict = {
  'notice.workflow.step': 'Ein Flow wartet auf Ihren Schritt: {{step}}',
  'notice.flow.reply': '{{who}} hat geantwortet: {{subject}}',
  'notice.confidentialFlow': 'Vertraulicher Flow',
  'workflowDesigner.block.review': 'Prüfen',
};
const t = (key, vars = {}) => (dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

test('a text key is shown in the reader\'s language, with its values', () => {
  const n = { title: 'A flow needs your step: Finance review', body: null, data: { text: { key: 'notice.workflow.step', vars: { step: { en: 'Finance review', de: 'Prüfung Finanzen' } } } } };
  assert.equal(notificationText(n, t, 'de').title, 'Ein Flow wartet auf Ihren Schritt: Prüfung Finanzen');
  assert.equal(notificationText({ ...n, data: { text: { key: 'notice.workflow.step', vars: { step: { t: 'workflowDesigner.block.review' } } } } }, t, 'de').title, 'Ein Flow wartet auf Ihren Schritt: Prüfen');
  assert.equal(notificationText({ ...n, data: { text: { key: 'notice.workflow.step', vars: { step: { en: 'Finance review' } } } } }, t, 'fr').title, 'Ein Flow wartet auf Ihren Schritt: Finance review');
});

test('a confidential subject, a body someone wrote, and the stored title when the key is unknown', () => {
  const n = { title: 'Ueli replied: Confidential flow', body: 'Hallo', data: { text: { key: 'notice.flow.reply', vars: { who: 'Ueli', subject: { t: 'notice.confidentialFlow' } } } } };
  assert.deepEqual(notificationText(n, t, 'de'), { title: 'Ueli hat geantwortet: Vertraulicher Flow', body: 'Hallo' });
  assert.deepEqual(notificationText({ title: 'Old', body: null, data: { text: { key: 'notice.unknown' } } }, t, 'de'), { title: 'Old', body: null });
  assert.deepEqual(notificationText({ title: 'Old', body: 'b', data: {} }, t, 'de'), { title: 'Old', body: 'b' });
});
