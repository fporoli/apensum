import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AssessmentTemplateSection } from '../shared/cases';
import { AI_DOC_CHARS, AI_TOTAL_CHARS, buildAiDraftMessages, parseAiDraft, type AiDraftMaterial } from '../api/case-ai-draft';
import { CasesService } from '../api/cases.service';
import { CaseAiService } from '../api/case-ai.service';

const sections: AssessmentTemplateSection[] = [
  { key: 'mandate', title: '1. Ausgangslage', isRequired: true, order: 1, promptGuidance: 'Fasse den Auftrag zusammen.' },
  { key: 'recommendation', title: '5. Antrag', isRequired: true, order: 5 },
];

const material = (over: Partial<AiDraftMaterial> = {}): AiDraftMaterial => ({
  caseInfo: { reference: 'KESB-2026-001', title: 'Gefährdungsmeldung', subjectName: 'Lea Muster', subjectDob: '2015-04-01', domain: 'kesb', lead: 'Marta A' },
  template: { name: 'KESB Abklärung', description: null, sections },
  documents: [{ title: 'Arztbericht', category: 'medical', fileName: 'bericht.pdf', text: 'Befund: unauffällig.' }],
  interviews: [{ name: 'Anna Muster', role: 'parent', date: '2026-03-02', summary: null, transcript: 'Wir kommen gut zurecht.' }],
  ...over,
});

test('the AI request carries the case, the template sections and the material', () => {
  const [system, user] = buildAiDraftMessages(material());
  assert.equal(system.role, 'system');
  assert.match(system.content, /Erfinde nichts/);
  assert.match(system.content, /\[Offen: Beurteilung durch die Fachperson\]/);
  for (const part of ['Lea Muster', 'KESB-2026-001', 'key: mandate', 'Fasse den Auftrag zusammen.', 'Befund: unauffällig.', 'Wir kommen gut zurecht.', 'Anna Muster']) {
    assert.ok(user.content.includes(part), part);
  }
});

test('long documents are clipped and material beyond the total limit is left out, with a note', () => {
  const long = 'x'.repeat(AI_DOC_CHARS + 500);
  const [, clipped] = buildAiDraftMessages(material({ documents: [{ title: 'Lang', category: 'other', fileName: null, text: long }] }));
  assert.ok(clipped.content.includes('[…gekürzt]'));
  const many = Array.from({ length: Math.ceil(AI_TOTAL_CHARS / AI_DOC_CHARS) + 3 }, (_, i) => ({ title: `D${i}`, category: 'other', fileName: null, text: long }));
  const [, capped] = buildAiDraftMessages(material({ documents: many, interviews: [] }));
  assert.ok(capped.content.length <= AI_TOTAL_CHARS + 200);
  assert.match(capped.content, /weitere Unterlage\(n\) wurden wegen der Grösse nicht mitgeschickt/);
});

test('the AI answer keeps only the template keys, also inside a code fence', () => {
  const answer = '```json\n{"sections": {"mandate": " Auftrag der KESB. ", "recommendation": "[Offen: Beurteilung durch die Fachperson]", "extra": "x"}}\n```';
  assert.deepEqual(parseAiDraft(answer, sections), { mandate: 'Auftrag der KESB.', recommendation: '[Offen: Beurteilung durch die Fachperson]' });
  assert.deepEqual(parseAiDraft('{"mandate": "flach"}', sections), { mandate: 'flach' });
});

test('an unusable AI answer is rejected', () => {
  assert.throws(() => parseAiDraft('Hier ist Ihr Gutachten: ...', sections), /ai-draft-invalid/);
  assert.throws(() => parseAiDraft('{"sections": {"other": "x"}}', sections), /ai-draft-invalid/);
  assert.throws(() => parseAiDraft('{"sections": {"mandate": 42}}', sections), /ai-draft-invalid/);
});

function service(template: Record<string, unknown>) {
  // Default org AI settings (no `ai` stored): the draft goes to Azure OpenAI (Switzerland).
  const caseAi = new CaseAiService({ getDb: () => ({ execute: async () => ({ rows: [] }) }) } as never, {} as never);
  const svc = new CasesService({ getDb: () => ({}) } as never, {} as never, caseAi);
  Object.assign(svc, {
    getTemplate: async () => ({ id: 't1', name: 'KESB Abklärung', domain: 'kesb', description: null, sections, ...template }),
    getCase: async () => ({ id: 'c1', reference_number: 'KESB-2026-001', title: 'Gefährdungsmeldung', subject_name: 'Lea Muster', subject_dob: null, lead_user_name: 'Marta A', domain: 'kesb' }),
    listDocuments: async () => [],
    listInterviews: async () => [{ interviewee_name: 'Anna Muster', interviewee_role: 'parent', interview_date: '2026-03-02', duration_minutes: 30 }],
  });
  return svc;
}

test('an AI draft needs a template that allows it, then Azure OpenAI set up on the server', async () => {
  const names = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  try {
    await assert.rejects(service({ ai_allowed: false }).aiDraft('o1', 'c1', 't1', 'u1'), ForbiddenException);
    await assert.rejects(service({ ai_allowed: true }).aiDraft('o1', 'c1', 't1', 'u1'), ServiceUnavailableException);
  } finally {
    for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
  }
});

test('the rule-based draft leaves findings and motions open instead of stating them', async () => {
  const draft = await service({ ai_allowed: false }).synthesizeDraft('o1', 'c1', 't1', 'u1');
  const text = Object.values(draft.sections_content).join('\n');
  assert.match(draft.sections_content.recommendation, /\[Offen: Beurteilung durch die Fachperson\]/);
  for (const claim of ['Es wird festgestellt', 'wird die Errichtung einer Beistandschaft beantragt', 'psychische Störung', 'konsistenten Geschehensablaufs']) {
    assert.ok(!text.includes(claim), claim);
  }
});
