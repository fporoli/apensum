import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  azureAllowed, azurePrices, budgetRefusal, chatChf, estimateChatChf, estimateTranscribeChf, instanceBudgetChf, transcribeChf, USER_CALLS_PER_HOUR,
  type BudgetState,
} from '../../apps/api/src/ai-budget.service';
import { azureOpenAiConfig, chatErrorCode } from '../../apps/api/src/ai-client';

// The core's AI budget (AiBudgetService) and Azure OpenAI client, used by Cases, receipt reading and any plugin.
const PRICED = {
  AI_MONTHLY_BUDGET_CHF: '30',
  AZURE_TRANSCRIBE_CHF_PER_HOUR: '1',
  AZURE_OPENAI_CHF_PER_1M_INPUT: '0.4',
  AZURE_OPENAI_CHF_PER_1M_OUTPUT: '1.6',
};
const prices = azurePrices(PRICED)!;

test('budget: Azure is off unless budget and all prices are set, and the kill switch wins', () => {
  assert.equal(azureAllowed(PRICED), true);
  assert.equal(azureAllowed({ ...PRICED, AI_AZURE_ENABLED: 'false' }), false);
  assert.equal(azureAllowed({ ...PRICED, AI_AZURE_ENABLED: 'FALSE' }), false);
  assert.equal(azureAllowed({ ...PRICED, AI_MONTHLY_BUDGET_CHF: '' }), false);
  assert.equal(azureAllowed({ ...PRICED, AI_MONTHLY_BUDGET_CHF: '0' }), false);
  assert.equal(azureAllowed({ ...PRICED, AZURE_TRANSCRIBE_CHF_PER_HOUR: undefined }), false);
  assert.equal(instanceBudgetChf({ AI_MONTHLY_BUDGET_CHF: 'abc' }), null);
});

test('budget: estimates err high, actual costs follow what Azure reports', () => {
  // 10 MB at the assumed 32 kbit/s = ~41.7 min of audio
  assert.ok(Math.abs(estimateTranscribeChf(10_000_000, prices) - 0.6944) < 0.001);
  assert.equal(transcribeChf(3600, prices), 1);
  assert.ok(Math.abs(chatChf(1_000_000, 1_000_000, prices) - 2) < 1e-9);
  // 30k chars -> 10'200 tokens in + 8'000 out
  assert.ok(Math.abs(estimateChatChf(30_000, 8000, prices) - (10_200 * 0.4 + 8000 * 1.6) / 1e6) < 1e-12);
});

test('budget: refusals in order (user busy, rate, instance budget, org limit)', () => {
  const base: BudgetState = { instanceSpent: 0, instanceBudget: 30, orgSpent: 0, orgLimit: 10, estimate: 0.5, userCallsLastHour: 0, userPending: 0 };
  assert.equal(budgetRefusal(base), null);
  assert.equal(budgetRefusal({ ...base, userPending: 1 }), 'ai-user-busy');
  assert.equal(budgetRefusal({ ...base, userCallsLastHour: USER_CALLS_PER_HOUR }), 'ai-rate-limited');
  assert.equal(budgetRefusal({ ...base, instanceSpent: 29.6 }), 'ai-budget-exhausted');
  assert.equal(budgetRefusal({ ...base, orgSpent: 9.6 }), 'ai-org-limit-reached');
  assert.equal(budgetRefusal({ ...base, orgSpent: 9.5 }), null, 'exactly at the limit is still allowed');
  assert.equal(budgetRefusal({ ...base, orgLimit: 0 }), 'ai-org-limit-reached', 'limit 0 = no Azure for this org');
});

test('Azure OpenAI: only Azure endpoints, v1 base URL, deployment as model', () => {
  const env = { AZURE_OPENAI_ENDPOINT: 'https://apensum-ai.openai.azure.com/', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'gpt-mini' };
  assert.deepEqual(azureOpenAiConfig(env), { endpoint: 'https://apensum-ai.openai.azure.com', baseURL: 'https://apensum-ai.openai.azure.com/openai/v1/', key: 'k', deployment: 'gpt-mini' });
  assert.ok(azureOpenAiConfig({ ...env, AZURE_OPENAI_ENDPOINT: 'https://apensum-ai.cognitiveservices.azure.com' }));
  assert.equal(azureOpenAiConfig({ ...env, AZURE_OPENAI_ENDPOINT: 'https://evil.example.com' }), null);
  assert.equal(azureOpenAiConfig({ ...env, AZURE_OPENAI_ENDPOINT: 'http://apensum-ai.openai.azure.com' }), null);
  assert.equal(azureOpenAiConfig({ ...env, AZURE_OPENAI_DEPLOYMENT: 'a/b' }), null);
  assert.equal(chatErrorCode(undefined, 'ai-draft-failed'), 'ai-provider-busy');
  assert.equal(chatErrorCode(503, 'ai-draft-failed'), 'ai-provider-busy');
  assert.equal(chatErrorCode(403, 'ai-draft-failed'), 'ai-provider-unavailable');
  assert.equal(chatErrorCode(400, 'ai-draft-failed'), 'ai-draft-failed');
});

test('a stale pooled connection is tried once more; a timeout or HTTP error is not', async () => {
  const { retryStaleConnection, isStaleConnectionError } = await import('../../apps/api/src/ai-client');
  const OpenAI = (await import('openai')).default;
  assert.equal(isStaleConnectionError(new OpenAI.APIConnectionError({ message: 'Connection error.' })), true);
  assert.equal(isStaleConnectionError(new OpenAI.APIConnectionTimeoutError()), false);
  assert.equal(isStaleConnectionError(Object.assign(new TypeError('fetch failed'), { cause: { message: 'other side closed' } })), true);
  assert.equal(isStaleConnectionError(new DOMException('timed out', 'TimeoutError')), false);
  let calls = 0;
  assert.equal(await retryStaleConnection(async () => { if (++calls === 1) throw new OpenAI.APIConnectionError({ message: 'Connection error.' }); return 'ok'; }), 'ok');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryStaleConnection(async () => { calls++; throw new OpenAI.APIConnectionTimeoutError(); }));
  assert.equal(calls, 1, 'a timeout may have been billed: not repeated');
  calls = 0;
  await assert.rejects(retryStaleConnection(async () => { calls++; throw new OpenAI.APIConnectionError({ message: 'down' }); }));
  assert.equal(calls, 2, 'at most one retry');
});
