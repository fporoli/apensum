import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES } from './dictionaries.ts';
import { ACTION_COLORS, buttonActionOfKey, buttonActions, navColor, NAV_COLORS, normalizeLabel } from './colorful.ts';

test('a key says what its button does by its last segment or that segment\'s first word', () => {
  assert.equal(buttonActionOfKey('common.save'), 'save');
  assert.equal(buttonActionOfKey('weekReport.saveAnyway'), 'save');
  assert.equal(buttonActionOfKey('reports.schedule.runNow'), 'start');
  assert.equal(buttonActionOfKey('workflowDesigner.addLabel'), 'add');
  assert.equal(buttonActionOfKey('reset.toLogin'), 'back');
  // A status, a heading or a hint never gives an icon.
  assert.equal(buttonActionOfKey('absences.status.approved'), null);
  assert.equal(buttonActionOfKey('branding.title'), null);
  assert.equal(buttonActionOfKey('save'), 'save');
});

test('the texts of every language find their action; a shared text goes by most of its keys, a tie by none', () => {
  for (const [lang, save, cancel, del] of [['de', 'Speichern', 'Abbrechen', 'Löschen'], ['fr', 'Enregistrer', 'Annuler', null], ['en', 'Save', 'Cancel', 'Delete']]) {
    const map = buttonActions(DICTIONARIES[lang]);
    assert.equal(map.get(normalizeLabel(save)), 'save', lang);
    assert.equal(map.get(normalizeLabel(cancel)), 'cancel', lang);
    if (del) assert.equal(map.get(normalizeLabel(del)), 'delete', lang);
    assert.ok(map.size > 100, `${lang}: ${map.size}`);
  }
  const map = buttonActions({ 'a.save': 'OK', 'b.close': 'OK', 'c.send': 'Senden …', 'd.send': 'Senden', 'e.save': 'Los', 'f.save': 'Los', 'g.add': 'Los' });
  assert.equal(map.get('ok'), undefined, 'a tie');
  assert.equal(map.get('los'), 'save', 'most keys');
  assert.equal(map.get('senden'), 'send', 'an ellipsis does not matter');
});

test('every action has a color; navigation colors are fixed per section and stable for others', () => {
  for (const c of [...Object.values(ACTION_COLORS), ...Object.values(NAV_COLORS)]) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.equal(navColor('workTime'), NAV_COLORS.workTime);
  assert.equal(navColor('somePlugin'), navColor('somePlugin'));
  assert.match(navColor('somePlugin'), /^#[0-9a-f]{6}$/);
});
