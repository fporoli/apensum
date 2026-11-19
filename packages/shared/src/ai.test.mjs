import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_MAX_MONTHLY_LIMIT_CHF, DEFAULT_AI_SETTINGS, parseAiSettings, validateAiSettings } from './ai.ts';

test('reading the AI limit never fails; anything invalid falls back to the default', () => {
  assert.deepEqual(DEFAULT_AI_SETTINGS, { monthlyLimitChf: 10 });
  assert.deepEqual(parseAiSettings(undefined), DEFAULT_AI_SETTINGS);
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: -1 }), DEFAULT_AI_SETTINGS);
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: 0 }), { monthlyLimitChf: 0 });
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: 25 }), { monthlyLimitChf: 25 });
});

test('saving checks the limit: 0 to the maximum, rounded to cents', () => {
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: 12.345 }), { ok: true, value: { monthlyLimitChf: 12.35 } });
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: AI_MAX_MONTHLY_LIMIT_CHF + 1 }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: '5' }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateAiSettings(null), { ok: false, error: 'ai-settings-invalid' });
});
