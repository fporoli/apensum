import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_MAX_MONTHLY_LIMIT_CHF, DEFAULT_AI_SETTINGS, parseAiSettings, validateAiSettings } from './ai.ts';

test('reading the AI limit never fails; anything invalid falls back to the default', () => {
  assert.deepEqual(DEFAULT_AI_SETTINGS, { monthlyLimitChf: 10, maxLevel: 'standard' });
  assert.deepEqual(parseAiSettings(undefined), DEFAULT_AI_SETTINGS);
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: -1 }), DEFAULT_AI_SETTINGS);
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: 0 }), { monthlyLimitChf: 0, maxLevel: 'standard' });
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: 25 }), { monthlyLimitChf: 25, maxLevel: 'standard' });
});

test('saving checks the limit: 0 to the maximum, rounded to cents', () => {
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: 12.345 }), { ok: true, value: { monthlyLimitChf: 12.35 } });
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: AI_MAX_MONTHLY_LIMIT_CHF + 1 }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: '5' }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateAiSettings(null), { ok: false, error: 'ai-settings-invalid' });
});

test('levels: an operator sets the maximum; the instance levels above it are not allowed', async () => {
  const { levelAllowed, isAiLevel } = await import('./ai.ts');
  assert.deepEqual(parseAiSettings({ monthlyLimitChf: 5, maxLevel: 'advanced' }), { monthlyLimitChf: 5, maxLevel: 'advanced' });
  assert.equal(parseAiSettings({ maxLevel: 'turbo' }).maxLevel, 'standard');
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: 5, maxLevel: 'max' }), { ok: true, value: { monthlyLimitChf: 5, maxLevel: 'max' } });
  assert.deepEqual(validateAiSettings({ monthlyLimitChf: 5, maxLevel: 'turbo' }), { ok: false, error: 'ai-settings-invalid' });
  assert.equal(levelAllowed('standard', 'standard'), true);
  assert.equal(levelAllowed('advanced', 'standard'), false);
  assert.equal(levelAllowed('advanced', 'max'), true);
  assert.equal(isAiLevel('max'), true);
});

test('an own Azure resource: an Azure endpoint, a standard deployment, and only when checked in Switzerland', async () => {
  const { validateOwnAzure } = await import('./ai.ts');
  const ok = { endpoint: 'https://acme-ai.openai.azure.com/', deployments: { standard: 'gpt-4.1-mini', advanced: 'o4-mini', max: '' }, reasoning: { advanced: 'high' } };
  assert.deepEqual(validateOwnAzure(ok), { ok: true, value: { endpoint: 'https://acme-ai.openai.azure.com', deployments: { standard: 'gpt-4.1-mini', advanced: 'o4-mini' }, reasoning: { advanced: 'high' } } });
  assert.deepEqual(validateOwnAzure({ ...ok, endpoint: 'https://evil.example.com' }), { ok: false, error: 'ai-own-endpoint' });
  assert.deepEqual(validateOwnAzure({ ...ok, deployments: { advanced: 'x' } }), { ok: false, error: 'ai-own-deployment' });
  assert.deepEqual(validateOwnAzure({ ...ok, reasoning: { advanced: 'extreme' } }), { ok: false, error: 'ai-own-invalid' });
  const stored = { endpoint: 'https://acme-ai.openai.azure.com', deployments: { standard: 'm' }, reasoning: {}, region: 'Switzerland North', checkedAt: '2026-11-28T08:00:00Z' };
  assert.deepEqual(parseAiSettings({ own: stored }).own, stored);
  assert.equal(parseAiSettings({ own: { ...stored, region: 'East US' } }).own, undefined, 'a resource outside Switzerland is ignored');
});
