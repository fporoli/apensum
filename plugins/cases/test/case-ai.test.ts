import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_CASE_AI_SETTINGS, parseCaseAiSettings, validateCaseAiSettings } from '../shared/cases';
import { azurePrices } from '@worktime3/api/plugin';
import { AzureCallError, azureTranscribeConfig, azureTranscribe, parseAzureTranscription, providerErrorCode } from '../api/azure-transcribe';
import { AI_SUMMARY_CHARS, buildAiSummaryMessages, parseAiSummary } from '../api/case-ai-summary';
import { CaseAiService, draftProviderFor, summaryProviderFor, transcriptionProviderFor } from '../api/case-ai.service';

const PRICED = {
  AI_MONTHLY_BUDGET_CHF: '30',
  AZURE_TRANSCRIBE_CHF_PER_HOUR: '1',
  AZURE_OPENAI_CHF_PER_1M_INPUT: '0.4',
  AZURE_OPENAI_CHF_PER_1M_OUTPUT: '1.6',
};
const AZURE = { AZURE_OPENAI_ENDPOINT: 'https://apensum-openai-ch.openai.azure.com', AZURE_OPENAI_KEY: 'secret', AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1-mini' };
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]);

test('org AI settings: defaults transcribe with Azure and summarize without a model; reading never fails', () => {
  assert.deepEqual(DEFAULT_CASE_AI_SETTINGS, { transcription: 'azure', summary: 'local', draft: 'instance' });
  assert.deepEqual(parseCaseAiSettings(undefined), DEFAULT_CASE_AI_SETTINGS);
  assert.deepEqual(parseCaseAiSettings({ transcription: 'off', summary: 'bogus', monthlyLimitChf: 10 }),
    { ...DEFAULT_CASE_AI_SETTINGS, transcription: 'off' });
  // The server Whisper is gone: a stored choice of it reads as the default.
  assert.equal(parseCaseAiSettings({ transcription: 'whisper' }).transcription, 'azure');
});

test('org AI settings: validation of what the browser sends', () => {
  const ok = { transcription: 'azure', summary: 'azure', draft: 'azure' };
  // The monthly limit is the core's (packages/shared/src/ai.ts); a stray one is dropped.
  assert.deepEqual(validateCaseAiSettings({ ...ok, monthlyLimitChf: 12 }), { ok: true, value: ok });
  assert.deepEqual(validateCaseAiSettings({ ...ok, draft: 'local' }), { ok: false, error: 'ai-settings-invalid' });
  assert.deepEqual(validateCaseAiSettings({ ...ok, transcription: 'whisper' }), { ok: false, error: 'ai-settings-invalid' });
  assert.deepEqual(validateCaseAiSettings(null), { ok: false, error: 'ai-settings-invalid' });
});

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
  const none = { azureTranscription: false, azureOpenai: false, instance: null };
  const all = { azureTranscription: true, azureOpenai: true, instance: 'gemini' as const };
  const azure = { transcription: 'azure', summary: 'azure', draft: 'azure' } as const;
  assert.equal(transcriptionProviderFor(azure, { ...all, azureTranscription: false }), null);
  assert.equal(transcriptionProviderFor(azure, all), 'azure');
  assert.equal(transcriptionProviderFor(DEFAULT_CASE_AI_SETTINGS, none), null);
  assert.equal(transcriptionProviderFor(DEFAULT_CASE_AI_SETTINGS, all), 'azure');
  assert.equal(transcriptionProviderFor({ ...DEFAULT_CASE_AI_SETTINGS, transcription: 'off' }, all), null);
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
    const db = { execute: async () => ({ rows: [{ ai: { transcription: 'azure', summary: 'local', draft: 'instance' } }] }) };
    const reserved: unknown[] = [];
    const finished: { result: { ok: boolean; audioSeconds?: number; actualChf: number | null } }[] = [];
    const budget = {
      orgMonthlyLimitChf: async () => 10,
      reserve: async (input: unknown) => { reserved.push(input); return 'usage-1'; },
      finish: async (_id: string, result: { ok: boolean; audioSeconds?: number; actualChf: number | null }) => { finished.push({ result }); },
    };
    const service = new CaseAiService({ getDb: () => db } as never, budget as never);
    assert.equal(await service.transcribe('org', 'user', 'case', MP3), 'Text');
    assert.equal(reserved.length, 1);
    assert.equal((reserved[0] as { orgLimitChf: number }).orgLimitChf, 10);
    assert.deepEqual((reserved[0] as { subject: unknown }).subject, { table: 'cases.cases', id: 'case' });
    assert.equal(finished[0].result.ok, true);
    assert.equal(finished[0].result.audioSeconds, 90);
    assert.ok(Math.abs((finished[0].result.actualChf ?? 0) - 0.025) < 1e-9);

    // A refused reservation means nothing is sent.
    let sent = false;
    globalThis.fetch = (async () => { sent = true; return new Response('{}'); }) as typeof fetch;
    const refusing = new CaseAiService({ getDb: () => db } as never, { orgMonthlyLimitChf: async () => 10, reserve: async () => { throw new Error('ai-budget-exhausted'); } } as never);
    await assert.rejects(refusing.transcribe('org', 'user', 'case', MP3), /ai-budget-exhausted/);
    assert.equal(sent, false);

    // Beyond Azure's 25 MB nothing is reserved or sent.
    await assert.rejects(service.transcribe('org', 'user', 'case', Buffer.alloc(25_000_001)), /interview-audio-too-large/);
    assert.equal(sent, false);
    assert.equal(reserved.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
});

test('the Whisper upload retries a stale connection once', async () => {
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
