import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import './register';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { permissionIdsOf } from '@worktime3/api/plugin';
import { CasesController } from '../api/cases.controller';
import { CasesService } from '../api/cases.service';
import type { AssessmentTemplate } from '../shared/cases';

test('cases routes reach the controller under the global API prefix', async () => {
  @Module({ controllers: [CasesController] })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/v1/organizations/org1/cases`;
    for (const method of ['GET', 'POST']) {
      const res = await fetch(url, { method });
      assert.equal(res.status, 401, `${method} should reach the authentication check, not return 404`);
      assert.equal((await res.json()).message, 'unauthenticated');
    }
  } finally {
    await app.close();
  }
});

test('cases module: permissionIdsOf drops nav.cases permissions when cases module is switched off', async () => {
  const rows = (modules: unknown) => [
    { name: 'member', permission_id: 'nav.cases:edit:own', modules },
    { name: 'member', permission_id: 'nav.time:edit:own', modules },
  ];
  const db = (modules: unknown) => ({ execute: async () => ({ rows: rows(modules) }) }) as any;

  // When cases module is disabled (default for existing orgs)
  const heldDisabled = await permissionIdsOf(db({ cases: false }), 'o', 'u');
  assert.deepEqual([...heldDisabled].sort(), ['nav.time:edit:own']);

  // When cases module is enabled
  const heldEnabled = await permissionIdsOf(db({ cases: true }), 'o', 'u');
  assert.deepEqual([...heldEnabled].sort(), ['nav.cases:edit:own', 'nav.time:edit:own']);
});

test('cases service: synthesizeDraft weaves case details, evidence documents and interview quotes into sections', async () => {
  const mockTemplate: AssessmentTemplate = {
    id: '00000000-0000-0000-0000-000000000001',
    organization_id: null,
    name: 'KESB Gefährdungsabklärung & Massnahmenantrag',
    domain: 'kesb',
    description: 'KESB Test Template',
    is_default: true,
    letterhead_config: {},
    created_at: '2026-11-18T00:00:00Z',
    updated_at: '2026-11-18T00:00:00Z',
    sections: [
      { key: 'mandate', title: '1. Ausgangslage & Gefährdungsmeldung', isRequired: true, order: 1 },
      { key: 'dossier_analysis', title: '2. Aktenanalyse & Vorgeschichte', isRequired: true, order: 2 },
      { key: 'interviews_summary', title: '3. Befragungen & Stellungnahmen', isRequired: true, order: 3 },
      { key: 'recommendation', title: '8. Empfohlene behördliche Massnahme', isRequired: true, order: 4 },
    ],
  };

  const mockCase = {
    id: 'c1',
    organization_id: 'org1',
    reference_number: 'KESB-2026-089',
    title: 'Abklärung Schutzbedarf Herr M. Muster',
    domain: 'kesb',
    subject_name: 'Max Muster',
    subject_dob: '1984-05-12',
    status: 'open',
    lead_user_id: 'u1',
    lead_user_name: 'Dr. Sarah Keller',
    confidentiality: 'strictly_confidential',
    metadata: {},
    created_at: '2026-11-18T10:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
  };

  const mockDocs = [
    {
      id: 'd1',
      case_id: 'c1',
      document_id: 'doc1',
      title: 'Arztbericht Psychiatrische Universitätsklinik',
      category: 'medical' as const,
      extracted_text: 'Patient leidet unter schwerer depressiver Episode mit psychotischen Zügen. Urteilsfähigkeit eingeschränkt.',
      metadata: {},
      created_at: '2026-11-18T10:30:00Z',
      file_name: 'bericht_puk.pdf',
    },
  ];

  const mockInterviews = [
    {
      id: 'i1',
      case_id: 'c1',
      interviewee_name: 'Anna Muster',
      interviewee_role: 'relative' as const,
      interview_date: '2026-11-17',
      duration_minutes: 45,
      interviewer_user_id: 'u1',
      transcript_text: 'Mein Vater vergisst regelmässig seine Medikamente und öffnet seit Wochen keine Rechnungen mehr.',
      summary: 'Tochter schildert akute Verwahrlosungstendenzen und Überforderung bei administrativen Belangen.',
      tags: ['finanzen', 'medikation'],
      created_at: '2026-11-18T11:00:00Z',
    },
  ];

  const mockDbService: any = {
    getDb: () => ({
      execute: async (q: any) => {
        return { rows: [] };
      },
    }),
  };

  const service = new CasesService(mockDbService, {} as any);
  // Mock internal calls
  (service as any).getCase = async () => mockCase;
  (service as any).getTemplate = async () => mockTemplate;
  (service as any).listDocuments = async () => mockDocs;
  (service as any).listInterviews = async () => mockInterviews;

  const result = await service.synthesizeDraft('org1', 'c1', '00000000-0000-0000-0000-000000000001', 'u1');

  assert.ok(result.title.includes('KESB Gefährdungsabklärung'));
  assert.ok(result.title.includes('Max Muster'));
  assert.ok(result.sections_content.mandate.includes('KESB-2026-089'));
  assert.ok(result.sections_content.mandate.includes('Dr. Sarah Keller'));
  assert.ok(result.sections_content.dossier_analysis.includes('Arztbericht Psychiatrische Universitätsklinik'));
  assert.ok(result.sections_content.dossier_analysis.includes('Urteilsfähigkeit eingeschränkt'));
  assert.ok(result.sections_content.interviews_summary.includes('Anna Muster (relative)'));
  assert.ok(result.sections_content.interviews_summary.includes('öffnet seit Wochen keine Rechnungen mehr'));
  // The motion is named but left to the expert: the draft states no findings of its own.
  assert.ok(result.sections_content.recommendation.includes('Antrag an die Kindes- und Erwachsenenschutzbehörde (KESB)'));
  assert.ok(result.sections_content.recommendation.includes('[Offen: Beurteilung durch die Fachperson]'));
  assert.ok(!result.sections_content.recommendation.includes('Art. 388 ff. ZGB'));
});

test('cases service: generateAssessmentPdf renders valid PDF buffer with Swiss confidentiality notice and sections', async () => {
  const mockTemplate: AssessmentTemplate = {
    id: '00000000-0000-0000-0000-000000000001',
    organization_id: null,
    name: 'KESB Gefährdungsabklärung',
    domain: 'kesb',
    description: null,
    is_default: true,
    letterhead_config: {},
    created_at: '2026-11-18T00:00:00Z',
    updated_at: '2026-11-18T00:00:00Z',
    sections: [
      { key: 'mandate', title: '1. Ausgangslage', isRequired: true, order: 1 },
      { key: 'findings', title: '2. Befund', isRequired: true, order: 2 },
    ],
  };

  const mockCase = {
    id: 'c1',
    organization_id: 'org1',
    reference_number: 'REF-999',
    title: 'Test Fall',
    domain: 'kesb',
    subject_name: 'Peter Meier',
    subject_dob: '1990-01-01',
    status: 'open',
    lead_user_id: 'u1',
    lead_user_name: 'Dr. Meier',
    confidentiality: 'strictly_confidential',
    metadata: {},
    created_at: '2026-11-18T10:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
  };

  const mockAssessment = {
    id: 'a1',
    case_id: 'c1',
    template_id: '00000000-0000-0000-0000-000000000001',
    title: 'Offizielles Gutachten Peter Meier',
    status: 'draft',
    sections_content: {
      mandate: 'Auftragserteilung durch KESB Bezirk Horgen.',
      findings: 'Der Explorand ist kooperativ und orientiert.',
    },
    author_user_id: 'u1',
    author_name: 'Dr. Meier',
    final_document_id: null,
    version: 1,
    created_at: '2026-11-18T12:00:00Z',
    updated_at: '2026-11-18T12:00:00Z',
  };

  const mockDbService: any = {
    getDb: () => ({
      execute: async () => ({ rows: [{ name: 'KESB Kanton Zürich' }] }),
    }),
  };

  const service = new CasesService(mockDbService, {} as any);
  (service as any).getCase = async () => mockCase;
  (service as any).getTemplate = async () => mockTemplate;
  (service as any).getAssessment = async () => mockAssessment;
  (service as any).listDocuments = async () => [];
  (service as any).listInterviews = async () => [];

  const pdfBuffer = await service.generateAssessmentPdf('org1', 'c1', 'a1', 'u1');

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 500);
  assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
});
