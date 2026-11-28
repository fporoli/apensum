import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiBudgetService, budgetRefusal, chatParams, completionTokens, instanceLevel, instanceLevels, OWN_PROVIDER, targetChf, targetEstimateChf, type ChatTarget,
} from '../../apps/api/src/ai-budget.service';
import { openSecret, parseMasterKey, sealSecret } from '../../apps/api/src/document-crypto';

const env = {
  AI_MONTHLY_BUDGET_CHF: '100', AZURE_TRANSCRIBE_CHF_PER_HOUR: '0.4',
  AZURE_OPENAI_ENDPOINT: 'https://inst.openai.azure.com', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1-mini',
  AZURE_OPENAI_CHF_PER_1M_INPUT: '0.4', AZURE_OPENAI_CHF_PER_1M_OUTPUT: '1.6',
  AZURE_OPENAI_DEPLOYMENT_ADVANCED: 'o4-mini', AZURE_OPENAI_CHF_PER_1M_INPUT_ADVANCED: '1.1', AZURE_OPENAI_CHF_PER_1M_OUTPUT_ADVANCED: '4.4',
  AZURE_OPENAI_REASONING_ADVANCED: 'medium',
} as NodeJS.ProcessEnv;

test('the instance levels come from the env: a level needs its deployment and its prices', () => {
  assert.deepEqual(instanceLevels(env), ['standard', 'advanced']);
  const advanced = instanceLevel('advanced', env)!;
  assert.equal(advanced.config.deployment, 'o4-mini');
  assert.equal(advanced.config.endpoint, 'https://inst.openai.azure.com');
  assert.deepEqual(advanced.prices, { inputPer1M: 1.1, outputPer1M: 4.4 });
  assert.equal(advanced.reasoning, 'medium');
  assert.equal(instanceLevel('max', env), null);
  assert.deepEqual(instanceLevels({ ...env, AZURE_OPENAI_CHF_PER_1M_OUTPUT_ADVANCED: '' }), ['standard'], 'no prices, no level');
  assert.deepEqual(instanceLevels({ ...env, AI_MONTHLY_BUDGET_CHF: '' }), [], 'no budget, no Azure');
});

test('a reasoning model gets room to think, and its effort is sent', () => {
  assert.equal(completionTokens(1000, null), 1000);
  assert.equal(completionTokens(1000, 'high'), 4000);
  const target = { level: 'advanced', own: false, provider: 'azure-openai', reasoning: 'medium', prices: { inputPer1M: 1, outputPer1M: 1 },
    config: { endpoint: 'e', baseURL: 'b', key: 'k', deployment: 'o4-mini' } } as ChatTarget;
  assert.deepEqual(chatParams(target, 500), { model: 'o4-mini', max_completion_tokens: 1500, reasoning_effort: 'medium' });
  assert.ok(targetEstimateChf(target, 3000, 500) > 0);
});

test('the organization\'s own resource costs the instance nothing and only the per-user limits apply', () => {
  const own = { level: 'max', own: true, provider: OWN_PROVIDER, reasoning: null, prices: null, config: { endpoint: 'e', baseURL: 'b', key: 'k', deployment: 'd' } } as ChatTarget;
  assert.equal(targetEstimateChf(own, 100_000, 10_000), 0);
  assert.equal(targetChf(own, 100_000, 10_000), 0);
  const full = { instanceSpent: 100, instanceBudget: 100, orgSpent: 10, orgLimit: 10, estimate: 0, userCallsLastHour: 0, userPending: 0 };
  assert.equal(budgetRefusal({ ...full, estimate: 0.01 }), 'ai-budget-exhausted');
  assert.equal(budgetRefusal({ ...full, own: true }), null);
  assert.equal(budgetRefusal({ ...full, own: true, userPending: 1 }), 'ai-user-busy');
});

test('chatTarget: within the maximum on the instance; the own resource for every level it has', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const svc = new AiBudgetService({ getDb: () => ({}) } as never);
    let settings: Record<string, unknown> = { monthlyLimitChf: 10, maxLevel: 'standard' };
    Object.assign(svc, { aiSettings: async () => settings, ownKey: async () => 'org-key' });
    assert.equal((await svc.chatTarget('o1')).config.deployment, 'gpt-4.1-mini');
    await assert.rejects(svc.chatTarget('o1', 'advanced'), /ai-level-not-allowed/);
    settings = { ...settings, maxLevel: 'max' };
    assert.equal((await svc.chatTarget('o1', 'advanced')).reasoning, 'medium');
    await assert.rejects(svc.chatTarget('o1', 'max'), /ai-level-unavailable/);
    settings = { ...settings, maxLevel: 'standard', own: { endpoint: 'https://acme.openai.azure.com', deployments: { standard: 'mini', max: 'big' }, reasoning: { max: 'high' }, region: 'Switzerland North', checkedAt: '' } };
    const own = await svc.chatTarget('o1', 'max');
    assert.deepEqual([own.own, own.provider, own.config.deployment, own.config.key, own.reasoning, own.prices], [true, OWN_PROVIDER, 'big', 'org-key', 'high', null]);
    assert.equal(own.config.baseURL, 'https://acme.openai.azure.com/openai/v1/');
    await assert.rejects(svc.chatTarget('o1', 'advanced'), /ai-level-unavailable/, 'only the levels deployed there');
    assert.deepEqual(await svc.levels('o1'), { levels: ['standard', 'max'], own: true });
    Object.assign(svc, { ownKey: async () => null });
    await assert.rejects(svc.chatTarget('o1'), /ai-own-key-missing/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('an own key is sealed with the documents master key and opens only with it', () => {
  const master = parseMasterKey(Buffer.alloc(32, 7).toString('base64'));
  const other = parseMasterKey(Buffer.alloc(32, 8).toString('base64'));
  const sealed = sealSecret('azure-key-123', master);
  assert.ok(!sealed.sealed.includes('azure-key'));
  assert.equal(openSecret(sealed.sealed, sealed.keyId, [other, master]), 'azure-key-123');
  assert.throws(() => openSecret(sealed.sealed, sealed.keyId, [other]));
});

test('a stored key is shown by its last four characters only', async () => {
  const { keyHint } = await import('../../apps/api/src/ai-settings.controller');
  assert.equal(keyHint('0123456789abcdefWXYZ'), 'WXYZ');
  assert.equal(keyHint('short'), null, 'a short key would give too much away');
});
