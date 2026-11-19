import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CASES_TEXTS } from '../web/texts.ts';
import { DICTIONARIES } from '../../../apps/web/src/dictionaries.ts';

const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const en = CASES_TEXTS.en;

test('every language has the same keys and {{placeholders}} as English, none empty', () => {
  for (const [locale, dict] of Object.entries(CASES_TEXTS)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), locale);
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(v.trim(), `${locale}:${k} is empty`);
      assert.deepEqual(placeholders(v), placeholders(en[k]), `${locale}:${k}`);
    }
  }
  assert.deepEqual(Object.keys(CASES_TEXTS).sort(), Object.keys(DICTIONARIES).sort());
});

test('no key overrides a core text', () => {
  assert.deepEqual(Object.keys(en).filter((k) => k in DICTIONARIES.en), []);
});

test('every literal t() key in the plugin pages exists (plugin or core)', () => {
  const dir = new URL('../web/', import.meta.url);
  const missing = [];
  for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && n !== 'texts.ts')) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)) if (!(m[1] in en) && !(m[1] in DICTIONARIES.en)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
