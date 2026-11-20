import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantController, MAX_ASSISTANT_PROMPT, normalizePrompt } from '../../apps/api/src/assistant.controller';

test('a question is kept trimmed, with its whitespace collapsed, and only within the length limit', () => {
  assert.equal(normalizePrompt('  Log 2h   today\non  internal  '), 'Log 2h today on internal');
  assert.equal(normalizePrompt('   '), null);
  assert.equal(normalizePrompt(42), null);
  assert.equal(normalizePrompt('x'.repeat(MAX_ASSISTANT_PROMPT + 1)), null);
});

test('the saved questions are refused to someone outside the organization, without touching the table', async () => {
  const db = {
    // callerUserId resolves the local user; isOrgMember finds no membership.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    execute: async () => ({ rows: [] }),
    update: () => assert.fail('must not update'),
    delete: () => assert.fail('must not delete'),
  };
  const api = new AssistantController({ getDb: () => db } as never, {} as never);
  const req = { user: { kind: 'local', sub: '22222222-2222-2222-2222-222222222227' } } as never;
  const org = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.deepEqual(await api.prompts(org, req), { ok: false, error: 'forbidden', prompts: [] });
  assert.deepEqual(await api.favorite(id, org, { favorite: true }, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await api.forget(id, org, req), { ok: false, error: 'forbidden' });
  assert.deepEqual(await api.prompts('not-a-uuid', req), { ok: false, error: 'forbidden', prompts: [] });
});
