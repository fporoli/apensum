import { Injectable, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { DbService, type Db } from './db.service';
import { DocumentsService } from './documents.service';
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

@Injectable()
export class CasesService {
  constructor(
    private readonly dbService: DbService,
    private readonly documentsService: DocumentsService,
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
    const leadId = dto.lead_user_id ?? callerId;
    const [row] = await this.db
      .insert(casesInCases)
      .values({
        organization_id: orgId,
        reference_number: dto.reference_number.trim(),
        title: dto.title.trim(),
        domain: dto.domain ?? 'kesb',
        subject_name: dto.subject_name.trim(),
        subject_dob: dto.subject_dob ?? null,
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

    const values: Record<string, unknown> = {
      updated_at: sql`now()`,
    };
    if (dto.reference_number !== undefined) values.reference_number = dto.reference_number.trim();
    if (dto.title !== undefined) values.title = dto.title.trim();
    if (dto.domain !== undefined) values.domain = dto.domain;
    if (dto.subject_name !== undefined) values.subject_name = dto.subject_name.trim();
    if (dto.subject_dob !== undefined) values.subject_dob = dto.subject_dob;
    if (dto.status !== undefined) values.status = dto.status;
    if (dto.lead_user_id !== undefined) values.lead_user_id = dto.lead_user_id;
    if (dto.confidentiality !== undefined) values.confidentiality = dto.confidentiality;
    if (dto.metadata !== undefined) values.metadata = dto.metadata;

    await this.db.execute(sql`
      UPDATE cases.cases
      SET
        reference_number = COALESCE(${dto.reference_number?.trim() ?? null}, reference_number),
        title = COALESCE(${dto.title?.trim() ?? null}, title),
        domain = COALESCE(${dto.domain ?? null}, domain),
        subject_name = COALESCE(${dto.subject_name?.trim() ?? null}, subject_name),
        subject_dob = CASE WHEN ${dto.subject_dob !== undefined} THEN ${dto.subject_dob ?? null}::date ELSE subject_dob END,
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
    await this.db.execute(sql`DELETE FROM cases.cases WHERE organization_id = ${orgId}::uuid AND id = ${caseId}::uuid`);
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

  async listInterviews(caseId: string): Promise<CaseInterview[]> {
    const rows = await this.db.execute(sql`
      SELECT
        ci.id,
        ci.case_id,
        ci.interviewee_name,
        ci.interviewee_role,
        ci.interview_date::text AS interview_date,
        ci.duration_minutes,
        ci.interviewer_user_id,
        u.display_name AS interviewer_name,
        ci.audio_document_id,
        ci.transcript_text,
        ci.summary,
        ci.tags,
        ci.created_at::text AS created_at
      FROM cases.case_interviews ci
      LEFT JOIN public.users u ON u.id = ci.interviewer_user_id
      WHERE ci.case_id = ${caseId}::uuid
      ORDER BY ci.interview_date DESC, ci.created_at DESC
    `);
    return rows.rows as unknown as CaseInterview[];
  }

  async createInterview(
    orgId: string,
    caseId: string,
    callerId: string,
    dto: CreateCaseInterviewDto,
  ): Promise<CaseInterview> {
    const [row] = await this.db
      .insert(case_interviewsInCases)
      .values({
        case_id: caseId,
        interviewee_name: dto.interviewee_name.trim(),
        interviewee_role: dto.interviewee_role ?? 'subject',
        interview_date: dto.interview_date ?? sql`CURRENT_DATE`,
        duration_minutes: dto.duration_minutes ?? 0,
        interviewer_user_id: dto.interviewer_user_id ?? callerId,
        audio_document_id: dto.audio_document_id ?? null,
        transcript_text: dto.transcript_text,
        summary: dto.summary ?? null,
        tags: dto.tags ?? [],
      })
      .returning();

    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);

    const interviews = await this.listInterviews(caseId);
    const created = interviews.find((i) => i.id === row.id);
    if (!created) throw new NotFoundException('interview-not-found');
    return created;
  }

  async updateInterview(
    caseId: string,
    interviewId: string,
    dto: Partial<CreateCaseInterviewDto>,
  ): Promise<CaseInterview> {
    await this.db.execute(sql`
      UPDATE cases.case_interviews
      SET
        interviewee_name = COALESCE(${dto.interviewee_name?.trim() ?? null}, interviewee_name),
        interviewee_role = COALESCE(${dto.interviewee_role ?? null}, interviewee_role),
        interview_date = CASE WHEN ${dto.interview_date !== undefined} THEN ${dto.interview_date ?? null}::date ELSE interview_date END,
        duration_minutes = COALESCE(${dto.duration_minutes ?? null}, duration_minutes),
        interviewer_user_id = CASE WHEN ${dto.interviewer_user_id !== undefined} THEN ${dto.interviewer_user_id ?? null}::uuid ELSE interviewer_user_id END,
        transcript_text = COALESCE(${dto.transcript_text ?? null}, transcript_text),
        summary = CASE WHEN ${dto.summary !== undefined} THEN ${dto.summary ?? null} ELSE summary END,
        tags = CASE WHEN ${dto.tags !== undefined} THEN ${dto.tags ?? []}::text[] ELSE tags END
      WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid
    `);

    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);

    const interviews = await this.listInterviews(caseId);
    const updated = interviews.find((i) => i.id === interviewId);
    if (!updated) throw new NotFoundException('interview-not-found');
    return updated;
  }

  async deleteInterview(caseId: string, interviewId: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM cases.case_interviews
      WHERE case_id = ${caseId}::uuid AND id = ${interviewId}::uuid
    `);
    await this.db.execute(sql`UPDATE cases.cases SET updated_at = now() WHERE id = ${caseId}::uuid`);
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
      })
      .returning();

    return this.getTemplate(orgId, row.id);
  }

  async updateTemplate(orgId: string, templateId: string, dto: UpdateAssessmentTemplateDto): Promise<AssessmentTemplate> {
    const existing = await this.getTemplate(orgId, templateId);
    if (!existing.organization_id) {
      throw new BadRequestException('global-templates-read-only');
    }

    await this.db.execute(sql`
      UPDATE cases.assessment_templates
      SET
        name = COALESCE(${dto.name?.trim() ?? null}, name),
        domain = COALESCE(${dto.domain ?? null}, domain),
        description = CASE WHEN ${dto.description !== undefined} THEN ${dto.description} ELSE description END,
        sections = CASE WHEN ${dto.sections !== undefined} THEN ${JSON.stringify(dto.sections)}::jsonb ELSE sections END,
        letterhead_config = CASE WHEN ${dto.letterhead_config !== undefined} THEN ${JSON.stringify(dto.letterhead_config)}::jsonb ELSE letterhead_config END,
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
            if (inv.summary) {
              draftText += `  Zusammenfassung: ${inv.summary}\n`;
            }
            if (inv.transcript_text) {
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
          draftText += `Aktenkundige Exploration: Psychopathologischer Status und somatische Verfassung wurden erhoben. Zur Zeit liegen keine anderweitigen Arztberichte vor.`;
        }
      } else if (key.includes('schuld') || key.includes('delict') || key.includes('tat') || key.includes('deduction') || key.includes('rekonstruktion')) {
        draftText =
          `Analyse des Sachverhalts und Handlungsdynamik:\n` +
          `Gestützt auf die vorliegenden Aussagen und Ermittlungsakten zeigt sich der Handlungsablauf wie folgt rekonstruierbar. ` +
          `Die Einvernahmen von ${interviews.map((i) => i.interviewee_name).join(', ') || 'den Beteiligten'} stützen die Feststellung eines konsistenten Geschehensablaufs.`;
      } else if (key.includes('empfehl') || key.includes('recommendation') || key.includes('antrag') || key.includes('referral') || key.includes('schluss')) {
        if (template.domain === 'kesb') {
          draftText =
            `Antrag an die Kindes- und Erwachsenenschutzbehörde (KESB):\n\n` +
            `1. Es wird festgestellt, dass für ${c.subject_name} eine Schutzbedürftigkeit im Sinne von Art. 388 ff. ZGB vorliegt.\n` +
            `2. Gestützt auf das Subsidiaritäts- und Verhältnismässigkeitsprinzip wird die Errichtung einer Beistandschaft nach Art. 391 ff. ZGB beantragt.\n` +
            `3. Aufgabenbereich: Personen- und Vermögenssorge, Vertretung vor Behörden und Rechtsverkehr.\n` +
            `4. Die periodische Berichterstattung wird im ordentlichen Turnus festgelegt.`;
        } else if (template.domain === 'forensic_psychiatry') {
          draftText =
            `Beantwortung der richterlichen Fragestellungen:\n\n` +
            `1. Diagnose: Es liegt eine aktenkundig nachweisbare psychische Störung gemäss ICD vor.\n` +
            `2. Schuldfähigkeit: Die Einsichts- und Steuerungsfähigkeit zum Deliktzeitpunkt wird als erhalten/vermindert beurteilt.\n` +
            `3. Rückfallrisiko & Massnahme: Zur Senkung des Rückfallrisikos wird eine therapeutische Massnahme gemäss Art. 56 ff. StGB befürwortet.`;
        } else if (template.domain === 'police') {
          draftText =
            `Schlussantrag an die Staatsanwaltschaft:\n\n` +
            `Die polizeilichen Ermittlungen in der Untersuchung ${c.reference_number} sind abgeschlossen. ` +
            `Die Akten sowie die sichergestellten Beweismittel und Einvernahmeprotokolle werden der zuständigen Staatsanwaltschaft zur weiteren Verfügung übermittelt.`;
        } else {
          draftText = `Zusammenfassende Beurteilung und Empfehlung der zuständigen Stelle.`;
        }
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
