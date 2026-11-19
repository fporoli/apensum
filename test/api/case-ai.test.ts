import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_CASE_AI_SETTINGS, parseCaseAiSettings, validateCaseAiSettings } from '@worktime3/shared/cases';
import {
  azureAllowed, azurePrices, budgetRefusal, chatChf, estimateChatChf, estimateTranscribeChf, instanceBudgetChf, transcribeChf, USER_CALLS_PER_HOUR,
  type BudgetState,
} from '../../apps/api/src/ai-budget.service';
import { AzureCallError, azureTranscribeConfig, azureTranscribe, parseAzureTranscription, providerErrorCode } from '../../apps/api/src/azure-transcribe';
import { azureOpenAiConfig, chatErrorCode } from '../../apps/api/src/ai-client';
import { AI_SUMMARY_CHARS, buildAiSummaryMessages, parseAiSummary } from '../../apps/api/src/case-ai-summary';
import { CaseAiService, draftProviderFor, summaryProviderFor, transcriptionProviderFor } from '../../apps/api/src/case-ai.service';

const PRICED = {
  AI_MONTHLY_BUDGET_CHF: '30',
  AZURE_TRANSCRIBE_CHF_PER_HOUR: '1',
  AZURE_OPENAI_CHF_PER_1M_INPUT: '0.4',
  AZURE_OPENAI_CHF_PER_1M_OUTPUT: '1.6',
};
const prices = azurePrices(PRICED)!;

test('org AI settings: defaults keep everything on the server; reading never fails', () => {
  assert.deepEqual(DEFAULT_CASE_AI_SETTINGS, { transcription: 'whisper', summary: 'local', draft: 'instance', monthlyLimitChf: 10 });
  assert.deepEqual(parseCaseAiSettings(undefined), DEFAULT_CASE_AI_SETTINGS);
  assert.deepEqual(parseCaseAiSettings({ transcription: 'azure', summary: 'bogus', monthlyLimitChf: -1 }),
    { ...DEFAULT_CASE_AI_SETTINGS, transcription: 'azure' });
});

test('org AI settings: validation of what the browser sends', () => {
  const ok = { transcription: 'azure', summary: 'azure', draft: 'azure', monthlyLimitChf: 12.345 };
  assert.deepEqual(validateCaseAiSettings(ok), { ok: true, value: { ...ok, monthlyLimitChf: 12.35 } });
  assert.deepEqual(validateCaseAiSettings({ ...ok, draft: 'local' }), { ok: false, error: 'ai-settings-invalid' });
  assert.deepEqual(validateCaseAiSettings({ ...ok, monthlyLimitChf: 1001 }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateCaseAiSettings({ ...ok, monthlyLimitChf: '5' }), { ok: false, error: 'ai-settings-limit' });
  assert.deepEqual(validateCaseAiSettings(null), { ok: false, error: 'ai-settings-invalid' });
});

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

const AZURE = { AZURE_OPENAI_ENDPOINT: 'https://apensum-openai-ch.openai.azure.com', AZURE_OPENAI_KEY: 'secret', AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1-mini' };
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]);

test('Azure Whisper: config, answer parsing and error mapping', () => {
  assert.equal(azureTranscribeConfig(AZURE), null, 'needs its own deployment');
  assert.equal(azureTranscribeConfig({ ...AZURE, AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: 'a/b' }), null);
  assert.deepEqual(azureTranscribeConfig({ ...AZURE, AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: 'whisper' }), {
    url: 'https://apensum-openai-ch.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01',
    key: 'secret',
  });
  assert.deepEqual(parseAzureTranscription({ text: ' Grüezi Frau Meier. ', duration: 123.06, language: 'german' }), { text: 'Grüezi Frau Meier.', seconds: 123.06 });
  assert.deepEqual(parseAzureTranscription(null), { text: '', seconds: 0 });
  assert.equal(providerErrorCode(401), 'ai-provider-unavailable');
  assert.equal(providerErrorCode(429), 'ai-provider-busy');
  assert.equal(providerErrorCode(503), 'ai-provider-busy');
  assert.equal(providerErrorCode(400), 'interview-transcription-failed');
});

test('Azure Whisper: one request with key header and a file named by its real format, no retry; errors say whether they were billed', async () => {
  const config = azureTranscribeConfig({ ...AZURE, AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: 'whisper' })!;
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ text: 'Hallo', duration: 2 }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await azureTranscribe(MP3, config, ok), { text: 'Hallo', seconds: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.url);
  assert.equal((calls[0].init.headers as Record<string, string>)['api-key'], 'secret');
  const form = calls[0].init.body as FormData;
  assert.equal((form.get('file') as File).name, 'audio.mp3');
  assert.equal(form.get('response_format'), 'verbose_json');
  await assert.rejects(azureTranscribe(Buffer.from('<html>no audio</html>'), config, ok), /interview-audio-format/);

  const status = (code: number) => (async () => new Response('{}', { status: code })) as unknown as typeof fetch;
  await assert.rejects(azureTranscribe(MP3, config, status(429)), (e: AzureCallError) => e.code === 'ai-provider-busy' && !e.billed);
  await assert.rejects(azureTranscribe(MP3, config, status(401)), (e: AzureCallError) => e.code === 'ai-provider-unavailable' && !e.billed);
  const broken = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
  await assert.rejects(azureTranscribe(MP3, config, broken), (e: AzureCallError) => e.code === 'ai-provider-busy' && e.billed);
  const empty = (async () => new Response(JSON.stringify({ text: '', duration: 5 }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(azureTranscribe(MP3, config, empty), (e: AzureCallError) => e.code === 'interview-transcription-failed' && e.seconds === 5);
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

test('AI summary: transcript in, bullet text out', () => {
  const messages = buildAiSummaryMessages({ name: 'Laura Meier', role: 'parent', date: '2026-11-02', transcript: '  Er schläft schlecht.  ' });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /ausschliesslich Aussagen aus dem Transkript/);
  assert.match(messages[1].content, /Laura Meier \(parent\), 2026-11-02\nTranskript:\nEr schläft schlecht\.$/);
  assert.equal(parseAiSummary('```\n- Punkt eins\n```'), '- Punkt eins');
  assert.equal(parseAiSummary('x'.repeat(AI_SUMMARY_CHARS + 50)).length, AI_SUMMARY_CHARS);
  assert.throws(() => parseAiSummary('  '), /ai-summary-invalid/);
});

test('providers: an unavailable choice is null (never silently another provider)', () => {
  const none = { whisper: false, azureTranscription: false, azureOpenai: false, instance: null };
  const all = { whisper: true, azureTranscription: true, azureOpenai: true, instance: 'gemini' as const };
  const azure = { transcription: 'azure', summary: 'azure', draft: 'azure', monthlyLimitChf: 10 } as const;
  assert.equal(transcriptionProviderFor(azure, { ...all, azureTranscription: false }), null);
  assert.equal(transcriptionProviderFor(azure, all), 'azure');
  assert.equal(transcriptionProviderFor(DEFAULT_CASE_AI_SETTINGS, none), null);
  assert.equal(summaryProviderFor(DEFAULT_CASE_AI_SETTINGS, none), 'local');
  assert.equal(summaryProviderFor(azure, { ...all, azureOpenai: false }), null);
  assert.equal(draftProviderFor(DEFAULT_CASE_AI_SETTINGS, all), 'gemini');
  assert.equal(draftProviderFor(azure, all), 'azure');
});

test('CaseAiService: Azure Whisper transcription reserves, calls Azure once and records the billed seconds', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, PRICED, AZURE, { AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: 'whisper' });
  delete process.env.AI_AZURE_ENABLED;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: 'Text', duration: 90 }), { status: 200 })) as typeof fetch;
  try {
    const db = { execute: async () => ({ rows: [{ ai: { transcription: 'azure', summary: 'local', draft: 'instance', monthlyLimitChf: 10 } }] }) };
    const reserved: unknown[] = [];
    const finished: { result: { ok: boolean; audioSeconds?: number; actualChf: number | null } }[] = [];
    const budget = {
      reserve: async (input: unknown) => { reserved.push(input); return 'usage-1'; },
      finish: async (_id: string, result: { ok: boolean; audioSeconds?: number; actualChf: number | null }) => { finished.push({ result }); },
    };
    const service = new CaseAiService({ getDb: () => db } as never, budget as never);
    assert.equal(await service.transcribe('org', 'user', 'case', MP3), 'Text');
    assert.equal(reserved.length, 1);
    assert.equal((reserved[0] as { orgLimitChf: number }).orgLimitChf, 10);
    assert.equal(finished[0].result.ok, true);
    assert.equal(finished[0].result.audioSeconds, 90);
    assert.ok(Math.abs((finished[0].result.actualChf ?? 0) - 0.025) < 1e-9);

    // A refused reservation means nothing is sent.
    let sent = false;
    globalThis.fetch = (async () => { sent = true; return new Response('{}'); }) as typeof fetch;
    const refusing = new CaseAiService({ getDb: () => db } as never, { reserve: async () => { throw new Error('ai-budget-exhausted'); } } as never);
    await assert.rejects(refusing.transcribe('org', 'user', 'case', MP3), /ai-budget-exhausted/);
    assert.equal(sent, false);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
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

  // The Whisper upload: a stale connection, then the answer.
  const config = azureTranscribeConfig({ ...AZURE, AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT: 'whisper' })!;
  let attempts = 0;
  const flaky = (async () => {
    if (++attempts === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { message: 'other side closed' } });
    return new Response(JSON.stringify({ text: 'Hallo', duration: 2 }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await azureTranscribe(MP3, config, flaky), { text: 'Hallo', seconds: 2 });
  assert.equal(attempts, 2);
});
