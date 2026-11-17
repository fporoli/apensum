import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES } from './dictionaries.ts';

const reference = DICTIONARIES.en;
const others = Object.keys(DICTIONARIES).filter((l) => l !== 'en');
const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

for (const locale of others) {
  const dict = DICTIONARIES[locale];

  test(`${locale} has every English key`, () => {
    const missing = Object.keys(reference).filter((k) => !(k in dict));
    assert.deepEqual(missing, [], `missing in ${locale}`);
  });

  test(`${locale} has no keys English lacks`, () => {
    const extra = Object.keys(dict).filter((k) => !(k in reference));
    assert.deepEqual(extra, [], `only in ${locale}`);
  });

  test(`${locale} uses the same {{placeholders}} as English`, () => {
    const mismatched = Object.keys(reference)
      .filter((k) => k in dict)
      .filter((k) => placeholders(reference[k]).join() !== placeholders(dict[k]).join());
    assert.deepEqual(mismatched, [], `placeholder mismatch in ${locale}`);
  });
}

test('no text is empty', () => {
  const empty = Object.entries(DICTIONARIES).flatMap(([locale, dict]) =>
    Object.entries(dict).filter(([, v]) => !v.trim()).map(([k]) => `${locale}:${k}`),
  );
  assert.deepEqual(empty, []);
});

test('standard role descriptions: the English text is what the migrations insert', async () => {
  // roleDescription (roleLabel.ts) translates a standard role's description only while it equals
  // this English default, so a changed changelog text would silently stop the translation.
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../../../infra/liquibase/changelog/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const keys = Object.keys(reference).filter((k) => k.startsWith('roles.builtinDescription.'));
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(sql.includes(reference[key].replace(/'/g, "''")), `${key} not found in the changelogs`);
  }
});
