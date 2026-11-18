import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { INTERVIEW_AUDIO_SOURCE, interviewAudioFormat, MAX_INTERVIEW_TEXT } from './case-interview-processing';
import { AI_DRAFT_MAX_TOKENS, buildAiDraftMessages, parseAiDraft } from './case-ai-draft';
import { CaseAiService } from './case-ai.service';
import {
  casesInCases,
  case_documentsInCases,
  case_interviewsInCases,
  assessment_templatesInCases,
  assessmentsInCases,
  documents,
  users,
} from './db/schema';
import type {
  Case,
  CaseDocument,
  CaseInterview,
  Assessment,
  AssessmentTemplate,
  AssessmentTemplateSection,
  CreateCaseDto,
  UpdateCaseDto,
  CreateCaseDocumentDto,
  CreateCaseInterviewDto,
  CreateAssessmentDto,
  UpdateAssessmentDto,
  CreateAssessmentTemplateDto,
  UpdateAssessmentTemplateDto,
} from '@worktime3/shared/cases';

/** Placeholder for every judgement in a rule-based draft: the draft never states findings itself. */
const OPEN_ASSESSMENT = '[Offen: Beurteilung durch die Fachperson]';

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly documentsService: DocumentsService,
    private readonly caseAi: CaseAiService,
  ) {}

  private get db(): Db {
    const d = this.dbService.getDb();
    if (!d) throw new ServiceUnavailableException('db-unavailable');
    return d;
  }

  /** List cases for an organization, optionally restricted to those led by callerId. */
  async listCases(
    orgId: string,
    filter: { onlyLeadUserId?: string | null; domain?: string; status?: string; search?: string },
  ): Promise<Case[]> {
    const conditions: any[] = [sql`c.organization_id = ${orgId}::uuid`];
    if (filter.onlyLeadUserId) {
      conditions.push(sql`c.lead_user_id = ${filter.onlyLeadUserId}::uuid`);
    }
    if (filter.domain && filter.domain !== 'all') {
      conditions.push(sql`c.domain = ${filter.domain}`);
    }
    if (filter.status && filter.status !== 'all') {
      conditions.push(sql`c.status = ${filter.status}`);
    }
    if (filter.search?.trim()) {
      const q = `%${filter.search.trim()}%`;
      conditions.push(
        sql`(c.reference_number ILIKE ${q} OR c.title ILIKE ${q} OR c.subject_name ILIKE ${q})`,
      );
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const rows = await this.db.execute(sql`
      SELECT
        c.id,
        c.organization_id,
        c.reference_number,
        c.title,
        c.domain,
        c.subject_name,
        c.subject_dob::text AS subject_dob,
        c.status,
        c.lead_user_id,
        u.display_name AS lead_user_name,
        c.confidentiality,
        c.metadata,
        c.created_at::text AS created_at,
        c.updated_at::text AS updated_at,
        (SELECT COUNT(*)::int FROM cases.case_documents cd WHERE cd.case_id = c.id) AS document_count,
        (SELECT COUNT(*)::int FROM cases.case_interviews ci WHERE ci.case_id = c.id) AS interview_count,
        (SELECT COUNT(*)::int FROM cases.assessments ca WHERE ca.case_id = c.id) AS assessment_count
      FROM cases.cases c
      LEFT JOIN public.users u ON u.id = c.lead_user_id
      WHERE ${whereClause}
      ORDER BY c.updated_at DESC
    `);

    return rows.rows as unknown as Case[];
  }

  /** Get a single case by id. */
  async getCase(orgId: string, caseId: string): Promise<Case> {
    const rows = await this.db.execute(sql`
      SELECT
        c.id,
        c.organization_id,
        c.reference_number,
        c.title,
        c.domain,
        c.subject_name,
        c.subject_dob::text AS subject_dob,
        c.status,
        c.lead_user_id,
        u.display_name AS lead_user_name,
        c.confidentiality,
        c.metadata,
        c.created_at::text AS created_at,
        c.updated_at::text AS updated_at,
        (SELECT COUNT(*)::int FROM cases.case_documents cd WHERE cd.case_id = c.id) AS document_count,
        (SELECT COUNT(*)::int FROM cases.case_interviews ci WHERE ci.case_id = c.id) AS interview_count,
        (SELECT COUNT(*)::int FROM cases.assessments ca WHERE ca.case_id = c.id) AS assessment_count
      FROM cases.cases c
      LEFT JOIN public.users u ON u.id = c.lead_user_id
      WHERE c.organization_id = ${orgId}::uuid AND c.id = ${caseId}::uuid
      LIMIT 1
    `);

    if (rows.rows.length === 0) throw new NotFoundException('case-not-found');
    return rows.rows[0] as unknown as Case;
  }

  /** Create a new case. */
  async createCase(orgId: string, callerId: string, dto: CreateCaseDto): Promise<Case> {
    const ref = dto.reference_number?.trim();
    const title = dto.title?.trim();
    const subject = dto.subject_name?.trim();
    if (!ref || !title || !subject) {
      throw new BadRequestException('missing-required-fields');
    }
    const dob = dto.subject_dob && String(dto.subject_dob).trim() ? String(dto.subject_dob).trim() : null;
    const leadId = dto.lead_user_id ?? callerId;
    const [row] = await this.db
      .insert(casesInCases)
      .values({
        organization_id: orgId,
        reference_number: ref,
        title: title,
        domain: dto.domain ?? 'kesb',
        subject_name: subject,
        subject_dob: dob,
        lead_user_id: leadId,
        confidentiality: dto.confidentiality ?? 'standard',
        metadata: dto.metadata ?? {},
      })
      .returning();

    return this.getCase(orgId, row.id);
  }

  /** Update an existing case. */
  async updateCase(orgId: string, caseId: string, dto: UpdateCaseDto): Promise<Case> {
    await this.getCase(orgId, caseId);

    const dob = dto.subject_dob !== undefined
      ? (dto.subject_dob && String(dto.subject_dob).trim() ? String(dto.subject_dob).trim() : null)
      : undefined;

    await this.db.execute(sql`
      UPDATE cases.cases
      SET
        reference_number = COALESCE(${dto.reference_number?.trim() ?? null}, reference_number),
        title = COALESCE(${dto.title?.trim() ?? null}, title),
        domain = COALESCE(${dto.domain ?? null}, domain),
        subject_name = COALESCE(${dto.subject_name?.trim() ?? null}, subject_name),
        subject_dob = CASE WHEN ${dob !== undefined} THEN ${dob ?? null}::date ELSE subject_dob END,
        status = COALESCE(${dto.status ?? null}, status),
        lead_user_id = CASE WHEN ${dto.lead_user_id !== undefined} THEN ${dto.lead_user_id ?? null}::uuid ELSE lead_user_id END,
        confidentiality = COALESCE(${dto.confidentiality ?? null}, confidentiality),
        metadata = COALESCE(${dto.metadata ? JSON.stringify(dto.metadata) : null}::jsonb, metadata),
        updated_at = now()
      WHERE organization_id = ${orgId}::uuid AND id = ${caseId}::uuid
    `);

    return this.getCase(orgId, caseId);
  }

  /** Delete a case. */
  async deleteCase(orgId: string, caseId: string): Promise<void> {
    await this.getCase(orgId, caseId);
    const interviews = await this.db.transaction(async (tx) => {
      await this.lockInterviewCase(tx, orgId, caseId);
      const result = await tx.execute<{ id: string; audio_document_id: string }>(sql`
        SELECT id, audio_document_id FROM cases.case_interviews WHERE case_id = ${caseId}::uuid AND audio_document_id IS NOT NULL
      `);
      await tx.execute(sql`DELETE FROM cases.cases WHERE organization_id = ${orgId}::uuid AND id = ${caseId}::uuid`);
      return result.rows;
    });
    for (const row of interviews) await this.removeInterviewAudio(orgId, row.id, row.audio_document_id);
  }

  // ---------------------------------------------------------------------------
  // Case Documents
  // ---------------------------------------------------------------------------

  async listDocuments(caseId: string): Promise<CaseDocument[]> {
    const rows = await this.db.execute(sql`
      SELECT
        cd.id,
        cd.case_id,
        cd.document_id,
        cd.title,
        cd.category,
        cd.extracted_text,
        cd.metadata,
        cd.created_at::text AS created_at,
        d.file_name,
        d.size_bytes AS file_size,
        d.mime_type
      FROM cases.case_documents cd
      LEFT JOIN public.documents d ON d.id = cd.document_id
      WHERE cd.case_id = ${caseId}::uuid
      ORDER BY cd.created_at DESC
    `);
    return rows.rows as unknown as CaseDocument[];
  }

  async createDocument(orgId: string, caseId: string, dto: CreateCaseDocumentDto): Promise<CaseDocument> {
    const [row] = await this.db
      .insert(case_documentsInCases)
      .values({
        case_id: caseId,
        title: dto.title.trim(),
        category: dto.category ?? 'evidence',
        document_id: dto.document_id ?? null,
        extracted_text: dto.extracted_text ?? null,
        metadata: dto.metadata ?? {},
      })
      .returning();

    // Touch case updated_at
    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);

    const docs = await this.listDocuments(caseId);
    const created = docs.find((d) => d.id === row.id);
    if (!created) throw new NotFoundException('case-doc-not-found');
    return created;
  }

  async deleteDocument(caseId: string, docId: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM cases.case_documents
      WHERE case_id = ${caseId}::uuid AND id = ${docId}::uuid
    `);
    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
  }

  // ---------------------------------------------------------------------------
  // Case Interviews & Transcripts
  // ---------------------------------------------------------------------------

  async listInterviews(caseId: string, interviewId?: string, db: Db = this.db): Promise<CaseInterview[]> {
    const rows = await db.execute(sql`
      SELECT ci.id, ci.case_id, ci.interviewee_name, ci.interviewee_role,
        ci.interview_date::text AS interview_date, ci.duration_minutes, ci.interviewer_user_id,
        u.display_name AS interviewer_name, d.id IS NOT NULL AS has_audio,
        ci.revision, ci.transcript_stale, ci.summary_stale, ci.transcript_text, ci.summary, ci.tags,
        ci.created_at::text AS created_at
      FROM cases.case_interviews ci
      JOIN cases.cases c ON c.id = ci.case_id
      LEFT JOIN public.users u ON u.id = ci.interviewer_user_id
      LEFT JOIN public.documents d ON d.id = ci.audio_document_id AND d.organization_id = c.organization_id
        AND d.source_table = ${INTERVIEW_AUDIO_SOURCE} AND d.source_table_id = ci.id
      WHERE ci.case_id = ${caseId}::uuid ${interviewId ? sql`AND ci.id = ${interviewId}::uuid` : sql``}
      ORDER BY ci.interview_date DESC, ci.created_at DESC
    `);
    return rows.rows as unknown as CaseInterview[];
  }

  async getInterview(caseId: string, interviewId: string, db: Db = this.db) {
    const [row] = await this.listInterviews(caseId, interviewId, db);
    if (!row) throw new NotFoundException('interview-not-found');
    return row;
  }

  private async lockInterviewCase(db: Db, orgId: string, caseId: string) {
    const { rows } = await db.execute(sql`
      SELECT id FROM cases.cases WHERE organization_id = ${orgId}::uuid AND id = ${caseId}::uuid FOR UPDATE
    `);
    if (!rows.length) throw new NotFoundException('case-not-found');
  }

  private async storeInterviewAudio(orgId: string, callerId: string, interviewId: string, file: { buffer: Buffer }) {
    if (file.buffer.length > MAX_DOCUMENT_BYTES) throw new BadRequestException('interview-audio-too-large');
    const { mime, extension } = interviewAudioFormat(file.buffer);
    return this.documentsService.store(this.db, orgId, callerId,
      { name: `interview-audio.${extension}`, mimeType: mime, buffer: file.buffer },
      { table: INTERVIEW_AUDIO_SOURCE, id: interviewId });
  }

  private async removeInterviewAudio(orgId: string, interviewId: string, documentId: string | null) {
    if (!documentId) return;
    try {
      const doc = await this.documentsService.get(this.db, documentId);
      if (doc?.organization_id === orgId && doc.source_table === INTERVIEW_AUDIO_SOURCE && doc.source_table_id === interviewId) {
        await this.documentsService.remove(this.db, documentId);
      }
    } catch {
      console.error('Interview audio cleanup failed');
    }
  }

  async readInterviewAudio(orgId: string, caseId: string, interviewId: string, revision?: string) {
    const { rows } = await this.db.execute<{
      revision: string; mime_type: string; storage_path: string; encrypted_key: string | null; key_id: string | null;
    }>(sql`
      SELECT ci.revision, d.mime_type, d.storage_path, d.encrypted_key, d.key_id
      FROM cases.case_interviews ci JOIN cases.cases c ON c.id = ci.case_id
      JOIN public.documents d ON d.id = ci.audio_document_id AND d.organization_id = c.organization_id
        AND d.source_table = ${INTERVIEW_AUDIO_SOURCE} AND d.source_table_id = ci.id
      WHERE c.organization_id = ${orgId}::uuid AND c.id = ${caseId}::uuid AND ci.id = ${interviewId}::uuid
    `);
    const doc = rows[0];
    if (!doc) throw new NotFoundException('interview-audio-not-found');
    if (revision !== undefined && doc.revision !== revision) throw new ConflictException('interview-changed');
    try {
      return { content: await this.documentsService.read(doc), mime: doc.mime_type };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new NotFoundException('interview-audio-not-found');
      throw new ServiceUnavailableException('interview-audio-unreadable');
    }
  }

  async createInterview(orgId: string, caseId: string, callerId: string, dto: CreateCaseInterviewDto, file?: { buffer: Buffer }) {
    if (typeof dto.interviewee_name !== 'string' || !dto.interviewee_name.trim()) throw new BadRequestException('interview-name-required');
    this.validateInterviewText(dto);
    const id = randomUUID();
    const documentId = file ? await this.storeInterviewAudio(orgId, callerId, id, file) : null;
    try {
      return await this.db.transaction(async (tx) => {
        await this.lockInterviewCase(tx, orgId, caseId);
        await tx.insert(case_interviewsInCases).values({
          id,
          case_id: caseId,
          interviewee_name: dto.interviewee_name.trim(),
          interviewee_role: dto.interviewee_role ?? 'subject',
          interview_date: dto.interview_date ?? sql`CURRENT_DATE`,
          duration_minutes: dto.duration_minutes ?? 0,
          interviewer_user_id: callerId,
          audio_document_id: documentId,
          transcript_text: dto.transcript_text ?? '',
          summary: dto.summary ?? null,
          tags: dto.tags ?? [],
        });
        await tx.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
        return this.getInterview(caseId, id, tx);
      });
    } catch (error) {
      await this.removeInterviewAudio(orgId, id, documentId);
      throw error;
    }
  }

  private validateInterviewText(dto: { transcript_text?: string; summary?: string | null }) {
    for (const text of [dto.transcript_text, dto.summary]) {
      if (text != null && (typeof text !== 'string' || text.length > MAX_INTERVIEW_TEXT || text.includes('\0'))) {
        throw new BadRequestException('interview-invalid-text');
      }
    }
  }

  async updateInterview(orgId: string, caseId: string, interviewId: string, revision: string, dto: { transcript_text?: string; summary?: string | null }) {
    this.validateInterviewText(dto);
    const writesTranscript = typeof dto.transcript_text === 'string';
    const writesSummary = dto.summary !== undefined;
    if (!writesTranscript && !writesSummary) throw new BadRequestException('interview-invalid-data');
    return this.db.transaction(async (tx) => {
      await this.lockInterviewCase(tx, orgId, caseId);
      const { rows } = await tx.execute(sql`
        UPDATE cases.case_interviews
        SET transcript_text = COALESCE(${dto.transcript_text ?? null}, transcript_text),
          summary = CASE WHEN ${writesSummary} THEN ${dto.summary ?? null} ELSE summary END,
          transcript_stale = CASE WHEN ${writesTranscript} THEN false ELSE transcript_stale END,
          summary_stale = CASE
            WHEN ${writesSummary} THEN ${!!dto.summary?.trim()} AND transcript_stale AND NOT ${writesTranscript}
            WHEN ${writesTranscript} AND transcript_text IS DISTINCT FROM ${dto.transcript_text ?? null} THEN COALESCE(btrim(summary), '') <> ''
            ELSE summary_stale
          END,
          revision = uuid_generate_v4()
        WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid AND revision = ${revision}
        RETURNING id
      `);
      if (!rows.length) throw new ConflictException('interview-changed');
      await tx.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
      return this.getInterview(caseId, interviewId, tx);
    });
  }

  async replaceInterviewAudio(orgId: string, caseId: string, interviewId: string, callerId: string, revision: string, file: { buffer: Buffer }) {
    const existing = await this.getInterview(caseId, interviewId);
    if (existing.revision !== revision) throw new ConflictException('interview-changed');
    const documentId = await this.storeInterviewAudio(orgId, callerId, interviewId, file);
    let result;
    try {
      result = await this.db.transaction(async (tx) => {
        await this.lockInterviewCase(tx, orgId, caseId);
        const { rows: [old] } = await tx.execute<{ audio_document_id: string | null }>(sql`
          SELECT audio_document_id FROM cases.case_interviews
          WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid AND revision = ${revision} FOR UPDATE
        `);
        if (!old) throw new ConflictException('interview-changed');
        await tx.execute(sql`
          UPDATE cases.case_interviews SET audio_document_id = ${documentId}::uuid, revision = uuid_generate_v4(),
            transcript_stale = btrim(transcript_text) <> '', summary_stale = COALESCE(btrim(summary), '') <> ''
          WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid
        `);
        await tx.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
        return { oldId: old.audio_document_id, interview: await this.getInterview(caseId, interviewId, tx) };
      });
    } catch (error) {
      await this.removeInterviewAudio(orgId, interviewId, documentId);
      throw error;
    }
    await this.removeInterviewAudio(orgId, interviewId, result.oldId);
    return result.interview;
  }

  async deleteInterview(orgId: string, caseId: string, interviewId: string): Promise<void> {
    const row = await this.db.transaction(async (tx) => {
      await this.lockInterviewCase(tx, orgId, caseId);
      const { rows: [deleted] } = await tx.execute<{ audio_document_id: string | null }>(sql`
        DELETE FROM cases.case_interviews WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid RETURNING audio_document_id
      `);
      await tx.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
      return deleted;
    });
    if (row) await this.removeInterviewAudio(orgId, interviewId, row.audio_document_id);
  }

  // ---------------------------------------------------------------------------
  // Assessment Templates (Client-Changeable)
  // ---------------------------------------------------------------------------

  async listTemplates(orgId: string): Promise<AssessmentTemplate[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id,
        organization_id,
        name,
        domain,
        description,
        sections,
        letterhead_config,
        is_default,
        ai_allowed,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM cases.assessment_templates
      WHERE organization_id = ${orgId}::uuid OR organization_id IS NULL
      ORDER BY is_default DESC, name ASC
    `);
    return rows.rows as unknown as AssessmentTemplate[];
  }

  async getTemplate(orgId: string, templateId: string): Promise<AssessmentTemplate> {
    const rows = await this.db.execute(sql`
      SELECT
        id,
        organization_id,
        name,
        domain,
        description,
        sections,
        letterhead_config,
        is_default,
        ai_allowed,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM cases.assessment_templates
      WHERE id = ${templateId}::uuid AND (organization_id = ${orgId}::uuid OR organization_id IS NULL)
      LIMIT 1
    `);
    if (rows.rows.length === 0) throw new NotFoundException('template-not-found');
    return rows.rows[0] as unknown as AssessmentTemplate;
  }

  async createTemplate(orgId: string, dto: CreateAssessmentTemplateDto): Promise<AssessmentTemplate> {
    const [row] = await this.db
      .insert(assessment_templatesInCases)
      .values({
        organization_id: orgId,
        name: dto.name.trim(),
        domain: dto.domain ?? 'kesb',
        description: dto.description ?? null,
        sections: dto.sections ?? [],
        letterhead_config: dto.letterhead_config ?? {},
        is_default: false,
        ai_allowed: dto.ai_allowed === true,
      })
      .returning();

    return this.getTemplate(orgId, row.id);
  }

  async updateTemplate(orgId: string, templateId: string, dto: UpdateAssessmentTemplateDto): Promise<AssessmentTemplate> {
    const existing = await this.getTemplate(orgId, templateId);
    if (!existing.organization_id) {
      throw new BadRequestException('global-templates-read-only');
    }

    // Unset fields must still be bound (as NULL): drizzle drops an `undefined` parameter from the SQL.
    await this.db.execute(sql`
      UPDATE cases.assessment_templates
      SET
        name = COALESCE(${dto.name?.trim() ?? null}, name),
        domain = COALESCE(${dto.domain ?? null}, domain),
        description = CASE WHEN ${dto.description !== undefined} THEN ${dto.description ?? null} ELSE description END,
        sections = CASE WHEN ${dto.sections !== undefined} THEN ${dto.sections !== undefined ? JSON.stringify(dto.sections) : null}::jsonb ELSE sections END,
        letterhead_config = CASE WHEN ${dto.letterhead_config !== undefined} THEN ${dto.letterhead_config !== undefined ? JSON.stringify(dto.letterhead_config) : null}::jsonb ELSE letterhead_config END,
        ai_allowed = CASE WHEN ${dto.ai_allowed !== undefined} THEN ${dto.ai_allowed === true} ELSE ai_allowed END,
        updated_at = now()
      WHERE id = ${templateId}::uuid AND organization_id = ${orgId}::uuid
    `);

    return this.getTemplate(orgId, templateId);
  }

  // ---------------------------------------------------------------------------
  // Assessments
  // ---------------------------------------------------------------------------

  async listAssessments(caseId: string): Promise<Assessment[]> {
    const rows = await this.db.execute(sql`
      SELECT
        a.id,
        a.case_id,
        a.template_id,
        a.title,
        a.status,
        a.sections_content,
        a.author_user_id,
        u.display_name AS author_name,
        a.final_document_id,
        a.version,
        a.created_at::text AS created_at,
        a.updated_at::text AS updated_at,
        t.name AS template_name,
        t.domain AS template_domain
      FROM cases.assessments a
      LEFT JOIN cases.assessment_templates t ON t.id = a.template_id
      LEFT JOIN public.users u ON u.id = a.author_user_id
      WHERE a.case_id = ${caseId}::uuid
      ORDER BY a.updated_at DESC
    `);
    return rows.rows as unknown as Assessment[];
  }

  async getAssessment(caseId: string, assessmentId: string): Promise<Assessment> {
    const rows = await this.db.execute(sql`
      SELECT
        a.id,
        a.case_id,
        a.template_id,
        a.title,
        a.status,
        a.sections_content,
        a.author_user_id,
        u.display_name AS author_name,
        a.final_document_id,
        a.version,
        a.created_at::text AS created_at,
        a.updated_at::text AS updated_at,
        t.name AS template_name,
        t.domain AS template_domain
      FROM cases.assessments a
      LEFT JOIN cases.assessment_templates t ON t.id = a.template_id
      LEFT JOIN public.users u ON u.id = a.author_user_id
      WHERE a.case_id = ${caseId}::uuid AND a.id = ${assessmentId}::uuid
      LIMIT 1
    `);
    if (rows.rows.length === 0) throw new NotFoundException('assessment-not-found');
    return rows.rows[0] as unknown as Assessment;
  }

  async createAssessment(
    orgId: string,
    caseId: string,
    callerId: string,
    dto: CreateAssessmentDto,
  ): Promise<Assessment> {
    const template = await this.getTemplate(orgId, dto.template_id);

    // Initial section content defaults if not provided
    const initialSections: Record<string, string> = dto.sections_content ?? {};
    if (!dto.sections_content) {
      for (const section of (template.sections as AssessmentTemplateSection[])) {
        initialSections[section.key] = '';
      }
    }

    const [row] = await this.db
      .insert(assessmentsInCases)
      .values({
        case_id: caseId,
        template_id: dto.template_id,
        title: dto.title.trim(),
        status: 'draft',
        sections_content: initialSections,
        author_user_id: callerId,
        version: 1,
      })
      .returning();

    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);

    return this.getAssessment(caseId, row.id);
  }

  async updateAssessment(
    caseId: string,
    assessmentId: string,
    callerId: string,
    dto: UpdateAssessmentDto,
  ): Promise<Assessment> {
    await this.getAssessment(caseId, assessmentId);

    await this.db.execute(sql`
      UPDATE cases.assessments
      SET
        title = COALESCE(${dto.title?.trim() ?? null}, title),
        status = COALESCE(${dto.status ?? null}, status),
        sections_content = CASE WHEN ${dto.sections_content !== undefined} THEN ${JSON.stringify(dto.sections_content)}::jsonb ELSE sections_content END,
        version = version + 1,
        updated_at = now()
      WHERE case_id = ${caseId}::uuid AND id = ${assessmentId}::uuid
    `);

    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);

    return this.getAssessment(caseId, assessmentId);
  }

  /**
   * Synthesize a structured initial draft assessment out of:
   * 1. The case dossier details
   * 2. All related documents & extracted text
   * 3. All interview transcripts and statements
   * 4. The chosen template's sections and prompt guidance
   */
  async synthesizeDraft(
    orgId: string,
    caseId: string,
    templateId: string,
    callerId: string,
  ): Promise<{ title: string; sections_content: Record<string, string> }> {
    const c = await this.getCase(orgId, caseId);
    const template = await this.getTemplate(orgId, templateId);
    const documents = await this.listDocuments(caseId);
    const interviews = await this.listInterviews(caseId);

    const title = `${template.name} — ${c.subject_name} (${c.reference_number})`;
    const sections_content: Record<string, string> = {};

    const sections = template.sections as AssessmentTemplateSection[];

    for (const sec of sections) {
      let draftText = '';
      const key = sec.key.toLowerCase();

      if (key.includes('mandat') || key.includes('ausgangslage') || key.includes('incident') || key.includes('auftrag')) {
        draftText =
          `Dossier: ${c.reference_number}\n` +
          `Betroffene Person: ${c.subject_name}` + (c.subject_dob ? ` (geb. ${c.subject_dob})` : '') + `\n` +
          `Federführende Stelle / Gutachter: ${c.lead_user_name ?? 'Zuständige Fachperson'}\n\n` +
          `Gegenstand der vorliegenden Beurteilung ist die Abklärung betreffend ${c.title}. ` +
          `Die Abklärung erfolgt unter Wahrung des gesetzlichen Verhältnismässigkeitsprinzips sowie der schutzwürdigen Interessen der beteiligten Personen.`;
      } else if (key.includes('akte') || key.includes('dossier') || key.includes('evidence') || key.includes('spuren') || key.includes('vorakten')) {
        if (documents.length === 0) {
          draftText = `Zum aktuellen Zeitpunkt sind im Dossier keine externen Dokumente oder Belege verzeichnet.`;
        } else {
          draftText = `Im vorliegenden Verfahren wurden ${documents.length} Dokument(e) und Beweismittel ausgewertet:\n\n`;
          for (const doc of documents) {
            draftText += `• [${doc.category.toUpperCase()}] ${doc.title} (${doc.file_name ?? 'Aktennotiz'})\n`;
            if (doc.extracted_text) {
              const snippet = doc.extracted_text.slice(0, 300).trim().replace(/\n+/g, ' ');
              draftText += `  Auszug/Erkenntnis: "${snippet}${doc.extracted_text.length > 300 ? '...' : ''}"\n`;
            }
          }
        }
      } else if (key.includes('interview') || key.includes('befragung') || key.includes('einvernahme') || key.includes('exploration') || key.includes('findings')) {
        if (interviews.length === 0) {
          draftText = `Bisher wurden keine Einvernahmen oder Explorationsgespräche protokolliert.`;
        } else {
          draftText = `Die Würdigung stützt sich auf ${interviews.length} durchgeführte Befragung(en):\n\n`;
          for (const inv of interviews) {
            draftText += `• Befragung von ${inv.interviewee_name} (${inv.interviewee_role}) vom ${inv.interview_date} (Dauer: ${inv.duration_minutes} Min.)\n`;
            if (inv.summary && !inv.summary_stale) {
              draftText += `  Zusammenfassung: ${inv.summary}\n`;
            }
            if (inv.transcript_text && !inv.transcript_stale) {
              const preview = inv.transcript_text.slice(0, 250).trim().replace(/\n+/g, ' ');
              draftText += `  Protokollauszug: "${preview}..."\n`;
            }
          }
        }
      } else if (key.includes('gesundheit') || key.includes('health') || key.includes('biography') || key.includes('anamnese') || key.includes('clinical')) {
        const medicalDocs = documents.filter((d) => d.category === 'medical');
        draftText = `Gesundheitliche und anamnestische Abklärung bezüglich ${c.subject_name}:\n\n`;
        if (medicalDocs.length > 0) {
          draftText += `Vorliegende medizinische/psychiatrische Berichte (${medicalDocs.map((m) => m.title).join(', ')}):\n`;
          for (const m of medicalDocs) {
            if (m.extracted_text) {
              draftText += `• ${m.title}: ${m.extracted_text.slice(0, 200).trim()}...\n`;
            }
          }
        } else {
          draftText += `Zurzeit liegen keine Arztberichte im Dossier vor.\n\n${OPEN_ASSESSMENT}`;
        }
      } else if (key.includes('schuld') || key.includes('delict') || key.includes('tat') || key.includes('deduction') || key.includes('rekonstruktion')) {
        draftText =
          `Analyse des Sachverhalts und Handlungsdynamik:\n` +
          `Grundlagen: ${documents.length} Dokument(e); Befragungen von ${interviews.map((i) => i.interviewee_name).join(', ') || '-'}.\n\n` +
          OPEN_ASSESSMENT;
      } else if (key.includes('empfehl') || key.includes('recommendation') || key.includes('antrag') || key.includes('referral') || key.includes('schluss')) {
        // Conclusions, findings and motions are the expert's: the draft names what to decide, never decides it.
        const motions: Record<string, string> = {
          kesb: 'Antrag an die Kindes- und Erwachsenenschutzbehörde (KESB)',
          forensic_psychiatry: 'Beantwortung der richterlichen Fragestellungen',
          police: 'Schlussantrag an die Staatsanwaltschaft',
        };
        draftText = `${motions[template.domain] ?? 'Zusammenfassende Beurteilung und Empfehlung'}:\n\n${OPEN_ASSESSMENT}`;
      } else {
        draftText = sec.promptGuidance
          ? `${sec.promptGuidance}\n\n[Befund für ${c.subject_name} (${c.reference_number}) basierend auf ${documents.length} Dokumenten und ${interviews.length} Befragungen]`
          : `Beurteilung für Abschnitt "${sec.title}".`;
      }

      sections_content[sec.key] = draftText;
    }

    return { title, sections_content };
  }

  /**
   * AI draft of an assessment: sends the case's names, document texts and current transcripts to
   * the organization's AI provider (case-ai.service.ts). Only with a template that allows it (`ai_allowed`).
   * Logged without content, so who sent which case to which provider can be traced.
   */
  async aiDraft(
    orgId: string,
    caseId: string,
    templateId: string,
    callerId: string,
  ): Promise<{ title: string; sections_content: Record<string, string> }> {
    const template = await this.getTemplate(orgId, templateId);
    if (!template.ai_allowed) throw new ForbiddenException('template-ai-not-allowed');
    const c = await this.getCase(orgId, caseId);
    const [documents, interviews] = await Promise.all([this.listDocuments(caseId), this.listInterviews(caseId)]);
    const sections = template.sections as AssessmentTemplateSection[];
    const messages = buildAiDraftMessages({
      caseInfo: { reference: c.reference_number, title: c.title, subjectName: c.subject_name, subjectDob: c.subject_dob ?? null, domain: c.domain, lead: c.lead_user_name ?? null },
      template: { name: template.name, description: template.description, sections },
      documents: documents.map((d) => ({ title: d.title, category: d.category, fileName: d.file_name ?? null, text: d.extracted_text ?? null })),
      // Stale texts no longer match their audio/transcript, so they are not sent (as in synthesizeDraft).
      interviews: interviews.map((i) => ({
        name: i.interviewee_name,
        role: i.interviewee_role,
        date: i.interview_date,
        summary: i.summary && !i.summary_stale ? i.summary : null,
        transcript: i.transcript_text && !i.transcript_stale ? i.transcript_text : null,
      })),
    });
    this.logger.log(`AI draft: case ${caseId}, template ${templateId}, user ${callerId}, ${documents.length} document(s), ${interviews.length} interview(s)`);
    // The organization's provider (instance or Azure), bounded in time; Azure goes through the budget.
    const answer = await this.caseAi.draft(orgId, callerId, caseId, messages, AI_DRAFT_MAX_TOKENS);
    try {
      return { title: `${template.name} — ${c.subject_name} (${c.reference_number})`, sections_content: parseAiDraft(answer, sections) };
    } catch {
      throw new UnprocessableEntityException('ai-draft-invalid');
    }
  }

  /**
   * Generates a formal Swiss Assessment PDF Report.
   */
  async generateAssessmentPdf(
    orgId: string,
    caseId: string,
    assessmentId: string,
    callerId: string,
  ): Promise<Buffer> {
    const c = await this.getCase(orgId, caseId);
    const assessment = await this.getAssessment(caseId, assessmentId);
    const template = await this.getTemplate(orgId, assessment.template_id);
    const documents = await this.listDocuments(caseId);
    const interviews = await this.listInterviews(caseId);

    // Retrieve organization name
    const orgRow = await this.db.execute(sql`SELECT name FROM public.organizations WHERE id = ${orgId}::uuid LIMIT 1`);
    const orgName = (orgRow.rows[0]?.name as string) ?? 'Behörde / Fachstelle';

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 60, left: 55, right: 55 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Colors
      const primaryColor = '#1e3a8a'; // Deep blue
      const secondaryColor = '#475569'; // Slate
      const accentColor = '#b91c1c'; // Crimson for confidential notice

      // 1. Header / Letterhead
      doc.fontSize(10).fillColor(secondaryColor).text(orgName.toUpperCase(), { align: 'right' });
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor('#64748b').text('Fachbereich Fallführung & Abklärungen / Gutachtenwesen', { align: 'right' });
      doc.moveDown(1.5);

      // Confidentiality banner
      const confText =
        c.confidentiality === 'strictly_confidential'
          ? 'STRENG VERTRAULICH — AMTS- UND BERUFSGEHEIMNIS (ART. 321 STGB)'
          : c.confidentiality === 'confidential'
            ? 'VERTRAULICH — DIENSTGEHEIMNIS'
            : 'AMTLICHE BEURTEILUNG';
      doc.fontSize(9).font('Helvetica-Bold').fillColor(accentColor).text(confText, { align: 'center' });
      doc.moveDown(1);

      // Document Main Title
      doc.fontSize(18).font('Helvetica-Bold').fillColor(primaryColor).text(assessment.title, { align: 'left' });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica-Oblique').fillColor(secondaryColor).text(`Vorlage: ${template.name} (Version ${assessment.version})`);
      doc.moveDown(1);

      // 2. Metadata Box
      const boxTop = doc.y;
      doc.rect(55, boxTop, 485, 80).fillAndStroke('#f8fafc', '#cbd5e1');

      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
      doc.text('Geschäfts-Nr. / Referenz:', 65, boxTop + 10);
      doc.font('Helvetica').text(c.reference_number, 200, boxTop + 10);

      doc.font('Helvetica-Bold').text('Betroffene Person / Explorand:', 65, boxTop + 25);
      doc.font('Helvetica').text(`${c.subject_name}${c.subject_dob ? ` (geb. ${c.subject_dob})` : ''}`, 200, boxTop + 25);

      doc.font('Helvetica-Bold').text('Federführung / Gutachter:', 65, boxTop + 40);
      doc.font('Helvetica').text(c.lead_user_name ?? 'Zuständige Amtsstelle', 200, boxTop + 40);

      doc.font('Helvetica-Bold').text('Status & Datum:', 65, boxTop + 55);
      doc.font('Helvetica').text(`${assessment.status.toUpperCase()} — Erstellt am ${assessment.created_at.slice(0, 10)}`, 200, boxTop + 55);

      doc.y = boxTop + 95;
      doc.moveDown(0.5);

      // 3. Evidence & Interviews Index
      doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text('Verzeichnis der berücksichtigten Akten & Einvernahmen:');
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      if (documents.length === 0 && interviews.length === 0) {
        doc.text('Keine gesonderten Aktenanhänge oder Protokolle verzeichnet.');
      } else {
        if (documents.length > 0) {
          doc.font('Helvetica-Bold').text(`Aktenbestand (${documents.length}):`);
          doc.font('Helvetica');
          for (const d of documents) {
            doc.text(`  • [${d.category}] ${d.title}${d.file_name ? ` (${d.file_name})` : ''}`);
          }
          doc.moveDown(0.3);
        }
        if (interviews.length > 0) {
          doc.font('Helvetica-Bold').text(`Einvernahmen & Befragungsprotokolle (${interviews.length}):`);
          doc.font('Helvetica');
          for (const i of interviews) {
            doc.text(`  • ${i.interview_date}: ${i.interviewee_name} (${i.interviewee_role}, ${i.duration_minutes} Min.)`);
          }
        }
      }

      doc.moveDown(1.5);
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(55, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(1.5);

      // 4. Assessment Sections
      const sections = template.sections as AssessmentTemplateSection[];
      const contents = (assessment.sections_content as Record<string, string>) || {};

      for (let idx = 0; idx < sections.length; idx++) {
        const sec = sections[idx];
        const textContent = contents[sec.key] || 'Keine Angaben verfasst.';

        // Prevent orphan headings by checking remaining page space
        if (doc.y > 680) {
          doc.addPage();
        }

        doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryColor).text(sec.title);
        if (sec.description) {
          doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(secondaryColor).text(sec.description);
        }
        doc.moveDown(0.4);

        doc.font('Helvetica').fontSize(9.5).fillColor('#1e293b').text(textContent, {
          align: 'justify',
          lineGap: 2.5,
        });

        doc.moveDown(1.2);
      }

      // 5. Signature Block
      if (doc.y > 650) {
        doc.addPage();
      }

      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a');
      doc.text(`Ort und Datum: ...................................., den ${new Date().toLocaleDateString('de-CH')}`);
      doc.moveDown(2);

      const signY = doc.y;
      doc.text('Unterschrift Gutachter / Fallführung:', 55, signY);
      doc.text('Genehmigung Amtsleitung / KESB:', 320, signY);
      doc.moveDown(3);

      doc.font('Helvetica-Bold').text(c.lead_user_name ?? 'Fachgutachter', 55, doc.y);
      doc.font('Helvetica-Bold').text('Behördenpräsidium / Fachdienst', 320, doc.y);

      // 6. Page Numbers on all pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#94a3b8').text(
          `Dossier ${c.reference_number} — Seite ${i + 1} von ${range.count}`,
          55,
          790,
          { align: 'center', width: 485 },
        );
      }

      doc.end();
    });
  }
}
