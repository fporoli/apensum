import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { CasesController } from '../../apps/api/src/cases.controller';
import { CasesService } from '../../apps/api/src/cases.service';
import { interviewAudioFormat, interviewTranscriptionEnabled, summarizeInterview, transcribeInterviewAudio } from '../../apps/api/src/case-interview-processing';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

const testAudio = Buffer.from('RIFF0000WAVE');
const revision = '00000000-0000-0000-0000-000000000001';
const req = { user: { kind: 'local', sub: 'caller' } } as AuthenticatedRequest;

function controller(services: object, permission: string, lead = 'caller') {
  const db = { getDb: () => ({ execute: async () => ({ rows: [{ name: 'member', permission_id: permission, modules: { cases: true } }] }) }) };
  return new CasesController(db as any, { getCase: async () => ({ lead_user_id: lead }), ...services } as any, {} as any);
}

test('interview playback and replacement authorize the case before accessing audio', async () => {
  let reads = 0;
  const services = { readInterviewAudio: async () => { ++reads; return { content: testAudio, mime: 'audio/wav' }; } };
  const headers: Record<string, string> = {};
  const res = { set: (values: object) => Object.assign(headers, values), send: (value: Buffer) => assert.equal(value, testAudio) } as any;
  await assert.rejects(controller(services, 'nav.cases:see:own', 'other').playInterviewAudio('org', 'case', 'interview', req, res), /forbidden/);
  await assert.rejects(controller(services, 'nav.cases:see:all').replaceInterviewAudio('org', 'case', 'interview', req, revision), /forbidden/);
  assert.equal(reads, 0);
  await controller(services, 'nav.cases:see:own').playInterviewAudio('org', 'case', 'interview', req, res);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['Content-Type'], 'audio/wav');
});

test('interview routes accept an optional audio upload and independently save text', async () => {
  const api = controller({
    createInterview: async (_org: string, _caseId: string, _caller: string, body: object, file: { buffer: Buffer }) => {
      assert.deepEqual(body, { interviewee_name: 'Synthetic interview' });
      assert.deepEqual(file.buffer, testAudio);
      return { id: 'interview' };
    },
    updateInterview: async (_org: string, _caseId: string, id: string, expected: string, body: object) => {
      assert.equal(expected, revision);
      assert.deepEqual(body, { revision, summary: 'Manual summary' });
      return { id };
    },
  }, 'nav.cases:edit:own');
  @Module({ controllers: [CasesController] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  try {
    Object.assign(app.get(CasesController), api);
    app.use((request: Request, _res: Response, next: NextFunction) => {
      (request as AuthenticatedRequest).user = req.user;
      next();
    });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/v1/organizations/org/cases/case/interviews`;
    const create = new FormData();
    create.append('data', JSON.stringify({ interviewee_name: 'Synthetic interview' }));
    create.append('file', new Blob([Uint8Array.from(testAudio)]), 'synthetic.wav');
    assert.equal((await fetch(url, { method: 'POST', body: create })).status, 201);
    const edit = new FormData();
    edit.append('data', JSON.stringify({ revision, summary: 'Manual summary' }));
    const result = await fetch(`${url}/interview`, { method: 'PATCH', body: edit });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, interview: { id: 'interview' } });
  } finally {
    await app.close();
  }
});

test('interview audio does not decrypt a changed revision or an unlinked document', async () => {
  let rows: object[] = [{ revision: 'old' }];
  const service = new CasesService({ getDb: () => ({ execute: async () => ({ rows }) }) } as any,
    { read: async () => assert.fail('must not decrypt') } as any);
  await assert.rejects(service.readInterviewAudio('org', 'case', 'interview', revision), /interview-changed/);
  rows = [];
  await assert.rejects(service.readInterviewAudio('org', 'case', 'interview'), /interview-audio-not-found/);
});

test('summary only drafts from a saved current revision and quotes existing text', async () => {
  const interview = { revision, transcript_stale: true, transcript_text: 'The bicycle was inspected. The bicycle was repaired. The report lists two details. A final discussion followed. The end.' };
  const api = controller({ getInterview: async () => interview, updateInterview: () => assert.fail('drafts must not write') }, 'nav.cases:edit:own');
  await assert.rejects(api.draftInterviewSummary('org', 'case', 'interview', req, revision), /interview-current-transcript-required/);
  interview.transcript_stale = false;
  await assert.rejects(api.draftInterviewSummary('org', 'case', 'interview', req, '00000000-0000-0000-0000-000000000002'), /interview-changed/);
  const { draft } = await api.draftInterviewSummary('org', 'case', 'interview', req, revision);
  assert.equal(draft.split('\n').length, 4);
  assert.ok(draft.split('\n').every((sentence) => interview.transcript_text.includes(sentence)));
  assert.equal(summarizeInterview('One repeated item.\nOne repeated item.'), 'One repeated item.');
});

test('transcription is opt-in and sends synthetic audio only to a local endpoint', async (t) => {
  const old = process.env.CASES_WHISPER_URL;
  t.after(() => { if (old === undefined) delete process.env.CASES_WHISPER_URL; else process.env.CASES_WHISPER_URL = old; });
  process.env.CASES_WHISPER_URL = 'https://example.invalid';
  assert.equal(interviewTranscriptionEnabled(), false);
  await assert.rejects(transcribeInterviewAudio(testAudio), /interview-transcription-disabled/);
  assert.throws(() => interviewAudioFormat(Buffer.from('<html>not audio</html>')), /interview-audio-format/);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.url, '/transcribe');
    assert.equal(req.headers['x-audio-format'], 'wav');
    assert.deepEqual(Buffer.concat(chunks), testAudio);
    res.end('Synthetic test result.');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.CASES_WHISPER_URL = `http://127.0.0.1:${address.port}`;
  assert.equal(await transcribeInterviewAudio(testAudio), 'Synthetic test result.');
});

// Opt in only against the disposable database named here, never an application database.
test('interview revisions preserve edits, invalidate downstream text and replace only owned audio', {
  skip: !process.env.CASES_INTERVIEW_SCHEMA_TEST,
}, async (t) => {
  const { DbService } = await import('../../apps/api/src/db.service');
  const { sql } = await import('drizzle-orm');
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.hostname, /^(localhost|127\.0\.0\.1)$/);
  assert.equal(url.pathname, '/apensum_interview_schema_check');
  const dbService = new DbService();
  t.after(async () => { await dbService.pool?.end(); });
  const db = dbService.getDb()!;
  const { rows: [user] } = await db.execute<{ id: string }>(sql`
    INSERT INTO users (email, display_name) VALUES ('interview-fixture@example.invalid', 'Synthetic User') RETURNING id
  `);
  const { rows: [org] } = await db.execute<{ id: string }>(sql`
    INSERT INTO organizations (name, slug, created_by_user_id) VALUES ('Synthetic Org', 'interview-fixture', ${user.id}) RETURNING id
  `);
  const { rows: [caseItem] } = await db.execute<{ id: string }>(sql`
    INSERT INTO cases.cases (organization_id, reference_number, title, subject_name)
    VALUES (${org.id}, 'FIXTURE', 'Synthetic dossier', 'Synthetic subject') RETURNING id
  `);
  t.after(async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url.href });
    await client.connect();
    try {
      await client.query('DELETE FROM organizations WHERE id = $1', [org.id]);
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    } finally { await client.end(); }
  });
  const deleted: string[] = [];
  const service = new CasesService(dbService, {
    store: async (_db: unknown, orgId: string, userId: string, file: { mimeType: string }, source: { table: string; id: string }) => {
      const { rows: [row] } = await db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, uploaded_by_user_id, file_name, mime_type, size_bytes, storage_path, source_table, source_table_id)
        VALUES (${orgId}, ${userId}, 'synthetic.wav', ${file.mimeType}, 12, 'synthetic.wav', ${source.table}, ${source.id}) RETURNING id
      `);
      return row.id;
    },
    get: async (_db: unknown, id: string) => (await db.execute(sql`SELECT * FROM documents WHERE id = ${id}`)).rows[0],
    read: async () => testAudio,
    remove: async (_db: unknown, id: string) => { await db.execute(sql`DELETE FROM documents WHERE id = ${id}`); deleted.push(id); },
  } as any);
  const file = { buffer: testAudio } as Express.Multer.File;
  const initial = await service.createInterview(org.id, caseItem.id, user.id, { interviewee_name: 'Synthetic interviewee' }, file);
  assert.equal(initial.has_audio, true);
  assert.equal(initial.transcript_text, '');
  let current = await service.updateInterview(org.id, caseItem.id, initial.id, initial.revision, { transcript_text: 'Manual text', summary: 'Manual summary' });
  await assert.rejects(service.updateInterview(org.id, caseItem.id, initial.id, initial.revision, { transcript_text: 'Old editor' }), /interview-changed/);
  current = await service.replaceInterviewAudio(org.id, caseItem.id, initial.id, user.id, current.revision, file);
  assert.equal(deleted.length, 1);
  assert.equal(current.transcript_text, 'Manual text');
  assert.equal(current.summary, 'Manual summary');
  assert.equal(current.transcript_stale, true);
  assert.equal(current.summary_stale, true);
  await assert.rejects(service.readInterviewAudio(user.id, caseItem.id, initial.id), /interview-audio-not-found/);
  assert.equal((await service.readInterviewAudio(org.id, caseItem.id, initial.id)).content, testAudio);
  current = await service.updateInterview(org.id, caseItem.id, initial.id, current.revision, { transcript_text: 'Corrected manual text' });
  assert.equal(current.transcript_stale, false);
  assert.equal(current.summary_stale, true);
  assert.equal(current.summary, 'Manual summary');
  current = await service.updateInterview(org.id, caseItem.id, initial.id, current.revision, { summary: 'Manual summary' });
  assert.equal(current.summary_stale, false);
  await service.deleteInterview(org.id, caseItem.id, initial.id);
  assert.equal(deleted.length, 2);
});
