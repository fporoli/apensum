import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileInterceptor, NoFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DbService, type Db } from '@worktime3/api/plugin';
import { DocumentsService, MAX_DOCUMENT_BYTES } from '@worktime3/api/plugin';
import { callerUserId, can, isSuperDeveloper, permissionIdsOf } from '@worktime3/api/plugin';
import { grantedScopes } from '@worktime3/shared/permissions';
import type { AuthenticatedRequest } from '@worktime3/api/plugin';
import { CasesService } from './cases.service';
import { extractPdfText, isPdf, tidyExtractedText } from '@worktime3/api/plugin';
import { CaseAiService, caseAiAvailability } from './case-ai.service';
import { VersionsService } from '@worktime3/api/plugin';
import { MAX_SEALED_INTERVIEW_AUDIO_BYTES, validateCaseAiSettings, validateCustomFieldDefs } from '../shared/cases';
import { checkComputeContent, checkWrite } from './case-encryption';
import { interviewAudioFormat } from './case-interview-processing';
import type {
  CreateCaseDto,
  UpdateCaseDto,
  CreateCaseDocumentDto,
  CreateCaseInterviewDto,
  CreateAssessmentDto,
  UpdateAssessmentDto,
  CreateAssessmentTemplateDto,
  UpdateAssessmentTemplateDto,
} from '../shared/cases';

const interviewUpload = { limits: { fileSize: MAX_SEALED_INTERVIEW_AUDIO_BYTES, files: 1, fields: 2, fieldSize: 1_300_000 } };
const privateCache = 'private, no-store';

function interviewPayload<T extends object>(body: T & { data?: string }): T {
  try {
    const data = typeof body?.data === 'string' ? JSON.parse(body.data) : body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new BadRequestException('interview-invalid-data');
  }
}

function interviewRevision(revision: unknown): string {
  if (typeof revision !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(revision)) {
    throw new BadRequestException('interview-revision-required');
  }
  return revision;
}

@Controller('organizations/:orgId')
export class CasesController {
  constructor(
    private readonly dbService: DbService,
    private readonly casesService: CasesService,
    private readonly documentsService: DocumentsService,
    private readonly caseAi: CaseAiService,
    private readonly versions: VersionsService,
  ) {}

  private get db(): Db {
    const d = this.dbService.getDb();
    if (!d) throw new ServiceUnavailableException('db-unavailable');
    return d;
  }

  private async requireCallerId(req: AuthenticatedRequest): Promise<string> {
    const callerId = req.user ? await callerUserId(this.db, req.user) : null;
    if (!callerId) throw new UnauthorizedException('unauthenticated');
    return callerId;
  }

  /**
   * Features that read the plaintext on the server (file upload, transcription, AI, PDF) are not available for an
   * encrypted case: the server cannot read it. They come back with the browser doing the reading (later phases).
   */
  private requirePlain(caseItem: { encrypted?: boolean }): void {
    if (caseItem.encrypted) throw new BadRequestException('case-encrypted');
  }

  private async checkSeeAccess(orgId: string, callerId: string): Promise<{ onlyLeadUserId: string | null }> {
    const canSee = await can(this.db, orgId, callerId, 'nav.cases', 'see');
    if (!canSee) throw new ForbiddenException('forbidden');

    const held = await permissionIdsOf(this.db, orgId, callerId);
    const scopes = grantedScopes(held, 'nav.cases', 'see');
    return { onlyLeadUserId: scopes.has('all') ? null : callerId };
  }

  private async checkEditAccess(orgId: string, callerId: string, caseItem?: { lead_user_id: string | null }): Promise<void> {
    const canEdit = await can(this.db, orgId, callerId, 'nav.cases', 'edit');
    if (!canEdit) throw new ForbiddenException('forbidden');

    if (caseItem) {
      const held = await permissionIdsOf(this.db, orgId, callerId);
      const scopes = grantedScopes(held, 'nav.cases', 'edit');
      if (!scopes.has('all') && caseItem.lead_user_id !== callerId) {
        throw new ForbiddenException('forbidden');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cases Dossier Endpoints
  // ---------------------------------------------------------------------------

  @Get('cases')
  async listCases(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('domain') domain?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const list = await this.casesService.listCases(orgId, {
      onlyLeadUserId,
      domain,
      status,
      search,
      callerId,
    });
    return { ok: true, cases: list };
  }

  @Post('cases')
  async createCase(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateCaseDto,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkEditAccess(orgId, callerId);
    const held = await permissionIdsOf(this.db, orgId, callerId);
    const scopes = grantedScopes(held, 'nav.cases', 'edit');
    const dto: CreateCaseDto = {
      ...body,
      lead_user_id: scopes.has('all') ? (body.lead_user_id ?? callerId) : callerId,
    };
    const created = await this.casesService.createCase(orgId, callerId, dto);
    return { ok: true, case: created };
  }

  @Get('cases/:caseId')
  async getCase(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const item = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && item.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    return { ok: true, case: item };
  }

  @Patch('cases/:caseId')
  async updateCase(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateCaseDto,
  ) {
    const callerId = await this.requireCallerId(req);
    const existing = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, existing);
    const updated = await this.casesService.updateCase(orgId, caseId, body);
    return { ok: true, case: updated };
  }

  @Delete('cases/:caseId')
  async deleteCase(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const existing = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, existing);
    await this.casesService.deleteCase(orgId, caseId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Case Documents
  // ---------------------------------------------------------------------------

  @Get('cases/:caseId/documents')
  async listDocuments(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    const documents = await this.casesService.listDocuments(caseId);
    return { ok: true, documents };
  }

  @Post('cases/:caseId/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async createDocument(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, any>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);

    if (caseItem.encrypted) {
      // The browser sealed the file and its details: the file is ciphertext, the rest is in `enc`.
      const enc = typeof body.enc === 'string' ? (() => { try { return JSON.parse(body.enc); } catch { return undefined; } })() : undefined;
      checkWrite('document', true, { id: body.id, enc }, { requireEnc: true, requireId: true });
      const stored = file
        ? await this.documentsService.store(this.db, orgId, callerId,
            { name: 'document.bin', mimeType: 'application/octet-stream', buffer: file.buffer },
            { table: 'cases.case_documents', id: caseId })
        : null;
      const sealed = await this.casesService.createDocument(orgId, caseId, {
        id: body.id, enc, title: '', category: body.category || 'evidence', document_id: stored,
      });
      return { ok: true, document: sealed, extraction: null };
    }

    let documentId = body.document_id ?? null;
    let extractedText = body.extracted_text ?? null;
    let extraction: 'pdf' | 'pdf-no-text' | null = null;
    const title = body.title || file?.originalname || 'Evidence Document';
    const category = body.category || 'evidence';

    if (file) {
      documentId = await this.documentsService.upload(this.db, orgId, callerId, file, {
        table: 'cases.case_documents',
        id: caseId,
      });

      // Text the user typed wins; otherwise take it from the file: plain text as is, a PDF's text layer.
      if (!extractedText && (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt'))) {
        extractedText = tidyExtractedText(file.buffer.toString('utf8'));
      } else if (!extractedText && isPdf(file.buffer)) {
        extractedText = await extractPdfText(file.buffer);
        // Tells the page to say so: a PDF without a text layer (a scan) gives nothing.
        extraction = extractedText ? 'pdf' : 'pdf-no-text';
      }
    }

    const doc = await this.casesService.createDocument(orgId, caseId, {
      title,
      category,
      document_id: documentId,
      extracted_text: extractedText,
      metadata: body.metadata ? (typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata) : {},
    });

    return { ok: true, document: doc, extraction };
  }

  /** The stored file as it is: for an encrypted case the ciphertext, which the browser decrypts. */
  @Get('cases/:caseId/documents/:docId/file')
  async downloadDocument(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('docId') docId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    await this.getCase(orgId, caseId, req);
    const file = await this.casesService.documentFile(orgId, caseId, docId);
    res.set({ 'Cache-Control': privateCache, 'X-Content-Type-Options': 'nosniff' });
    await this.documentsService.send(res, file);
  }

  @Delete('cases/:caseId/documents/:docId')
  async deleteDocument(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('docId') docId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    await this.casesService.deleteDocument(caseId, docId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Case Interviews & Transcripts
  // ---------------------------------------------------------------------------

  @Get('cases/:caseId/interviews')
  @Header('Cache-Control', privateCache)
  async listInterviews(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    const interviews = await this.casesService.listInterviews(caseId);
    const editScopes = grantedScopes(await permissionIdsOf(this.db, orgId, callerId), 'nav.cases', 'edit');
    const editable = editScopes.has('all') || (editScopes.size > 0 && caseItem.lead_user_id === callerId);
    // Where transcription and summaries go for this organization (null = chosen but not configured), shown before sending.
    const providers = await this.caseAi.providers(orgId);
    return {
      ok: true, interviews, editable,
      transcriptionEnabled: providers.transcription !== null,
      transcriptionProvider: providers.transcription,
      transcriptionSetting: providers.settings.transcription,
      summaryProvider: providers.summary,
    };
  }

  @Post('cases/:caseId/interviews')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(FileInterceptor('file', interviewUpload))
  async createInterview(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateCaseInterviewDto & { data?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const interview = await this.casesService.createInterview(orgId, caseId, callerId, interviewPayload(body), file);
    return { ok: true, interview };
  }

  @Patch('cases/:caseId/interviews/:interviewId')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(NoFilesInterceptor({ limits: { fields: 1, fieldSize: 1_300_000 } }))
  async updateInterview(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { data?: string; revision: string; transcript_text?: string; summary?: string | null },
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const payload = interviewPayload(body);
    const updated = await this.casesService.updateInterview(orgId, caseId, interviewId, interviewRevision(payload.revision), payload);
    return { ok: true, interview: updated };
  }

  @Get('cases/:caseId/interviews/:interviewId/audio')
  async playInterviewAudio(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    await this.getCase(orgId, caseId, req);
    const { content, mime } = await this.casesService.readInterviewAudio(orgId, caseId, interviewId);
    res.set({ 'Content-Type': mime, 'Cache-Control': privateCache, 'X-Content-Type-Options': 'nosniff' });
    res.send(content);
  }

  @Put('cases/:caseId/interviews/:interviewId/audio')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(FileInterceptor('file', interviewUpload))
  async replaceInterviewAudio(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Body('revision') revision: string,
    @Body('enc') encJson?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    if (!file) throw new BadRequestException('interview-audio-not-found');
    // An encrypted case's audio is ciphertext and its type comes sealed again in `enc` with it.
    let enc: unknown;
    if (encJson !== undefined) { try { enc = JSON.parse(encJson); } catch { throw new BadRequestException('invalid-envelope'); } }
    const interview = await this.casesService.replaceInterviewAudio(orgId, caseId, interviewId, callerId, interviewRevision(revision), file, enc);
    return { ok: true, interview };
  }

  @Post('cases/:caseId/interviews/:interviewId/transcribe')
  @Header('Cache-Control', privateCache)
  async draftInterviewTranscript(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Body('revision') revision: string,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    this.requirePlain(caseItem);
    const { content } = await this.casesService.readInterviewAudio(orgId, caseId, interviewId, interviewRevision(revision));
    const draft = await this.caseAi.transcribe(orgId, callerId, caseId, content);
    await this.checkEditAccess(orgId, callerId, await this.casesService.getCase(orgId, caseId));
    if ((await this.casesService.getInterview(caseId, interviewId)).revision !== revision) throw new ConflictException('interview-changed');
    return { ok: true, draft };
  }

  @Post('cases/:caseId/interviews/:interviewId/summarize')
  @Header('Cache-Control', privateCache)
  async draftInterviewSummary(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Body('revision') revision: string,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    this.requirePlain(caseItem);
    const interview = await this.casesService.getInterview(caseId, interviewId);
    if (interview.revision !== interviewRevision(revision)) throw new ConflictException('interview-changed');
    if (!interview.transcript_text.trim() || interview.transcript_stale) throw new BadRequestException('interview-current-transcript-required');
    const draft = await this.caseAi.summarize(orgId, callerId, caseId, {
      name: interview.interviewee_name, role: interview.interviewee_role, date: interview.interview_date, transcript: interview.transcript_text,
    });
    return { ok: true, draft };
  }

  @Delete('cases/:caseId/interviews/:interviewId')
  async deleteInterview(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    await this.casesService.deleteInterview(orgId, caseId, interviewId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Assessments
  // ---------------------------------------------------------------------------

  @Get('cases/:caseId/assessments')
  async listAssessments(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    const assessments = await this.casesService.listAssessments(caseId);
    return { ok: true, assessments };
  }

  @Post('cases/:caseId/assessments')
  async createAssessment(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateAssessmentDto,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const assessment = await this.casesService.createAssessment(orgId, caseId, callerId, body, !!caseItem.encrypted);
    return { ok: true, assessment };
  }

  @Post('cases/:caseId/assessments/synthesize')
  async synthesizeAssessmentDraft(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { template_id: string },
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    this.requirePlain(caseItem);
    const draft = await this.casesService.synthesizeDraft(orgId, caseId, body.template_id, callerId);
    return { ok: true, draft };
  }

  /** Same as synthesize, written by the AI provider; the template must allow it (see CasesService.aiDraft). */
  @Post('cases/:caseId/assessments/ai-draft')
  async aiAssessmentDraft(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { template_id: string },
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    this.requirePlain(caseItem);
    const draft = await this.casesService.aiDraft(orgId, caseId, body.template_id, callerId);
    return { ok: true, draft };
  }

  @Get('cases/:caseId/assessments/:assessmentId')
  async getAssessment(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('assessmentId') assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    const assessment = await this.casesService.getAssessment(caseId, assessmentId);
    return { ok: true, assessment };
  }

  @Patch('cases/:caseId/assessments/:assessmentId')
  async updateAssessment(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('assessmentId') assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateAssessmentDto,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const updated = await this.casesService.updateAssessment(caseId, assessmentId, callerId, body, !!caseItem.encrypted);
    return { ok: true, assessment: updated };
  }

  @Get('cases/:caseId/assessments/:assessmentId/pdf')
  async downloadAssessmentPdf(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('assessmentId') assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) {
      throw new ForbiddenException('forbidden');
    }
    this.requirePlain(caseItem);
    const pdfBuffer = await this.casesService.generateAssessmentPdf(orgId, caseId, assessmentId, callerId);

    const safeRef = caseItem.reference_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Beurteilung_${safeRef}_v${assessmentId.slice(0, 8)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  // ---------------------------------------------------------------------------
  // Stateless compute for encrypted cases. The server cannot read such a case, so the browser decrypts what a job
  // needs and sends it with that one request; the server works on it in memory, stores nothing and returns the
  // result, which the browser seals before saving. The same access rules, consent and AI budget as the plain paths.
  // ---------------------------------------------------------------------------

  private async computeAccess(orgId: string, caseId: string, req: AuthenticatedRequest) {
    const callerId = await this.requireCallerId(req);
    await this.checkEditAccess(orgId, callerId, await this.casesService.getCase(orgId, caseId));
    return callerId;
  }

  @Post('cases/:caseId/compute/transcribe')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(FileInterceptor('file', interviewUpload))
  async computeTranscribe(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const callerId = await this.computeAccess(orgId, caseId, req);
    if (!file) throw new BadRequestException('interview-audio-not-found');
    interviewAudioFormat(file.buffer);
    return { ok: true, draft: await this.caseAi.transcribe(orgId, callerId, caseId, file.buffer) };
  }

  @Post('cases/:caseId/compute/summarize')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(NoFilesInterceptor({ limits: { fields: 1, fieldSize: 1_300_000 } }))
  async computeSummarize(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { data?: string },
  ) {
    const callerId = await this.computeAccess(orgId, caseId, req);
    const p = interviewPayload(body) as { name?: unknown; role?: unknown; date?: unknown; transcript?: unknown };
    if (typeof p.transcript !== 'string' || !p.transcript.trim() || p.transcript.length > 100_000) throw new BadRequestException('interview-current-transcript-required');
    const draft = await this.caseAi.summarize(orgId, callerId, caseId, {
      name: String(p.name ?? '').slice(0, 300), role: String(p.role ?? '').slice(0, 40), date: String(p.date ?? '').slice(0, 20), transcript: p.transcript,
    });
    return { ok: true, draft };
  }

  @Post('cases/:caseId/compute/ai-draft')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(NoFilesInterceptor({ limits: { fields: 1, fieldSize: 12_000_000 } }))
  async computeAiDraft(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { data?: string },
  ) {
    const callerId = await this.computeAccess(orgId, caseId, req);
    const p = interviewPayload(body) as { template_id?: unknown };
    if (typeof p.template_id !== 'string') throw new BadRequestException('invalid-content');
    const draft = await this.casesService.aiDraftFromContent(orgId, caseId, p.template_id, callerId, checkComputeContent(p));
    return { ok: true, draft };
  }

  @Post('cases/:caseId/compute/pdf/:assessmentId')
  @UseInterceptors(NoFilesInterceptor({ limits: { fields: 1, fieldSize: 12_000_000 } }))
  async computePdf(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('assessmentId') assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Body() body: { data?: string },
  ) {
    const callerId = await this.requireCallerId(req);
    const { onlyLeadUserId } = await this.checkSeeAccess(orgId, callerId);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    if (onlyLeadUserId && caseItem.lead_user_id !== callerId) throw new ForbiddenException('forbidden');
    const p = interviewPayload(body) as { title?: unknown; sections_content?: unknown };
    if (typeof p.title !== 'string' || !p.sections_content || typeof p.sections_content !== 'object') throw new BadRequestException('invalid-content');
    const sections = Object.fromEntries(Object.entries(p.sections_content as Record<string, unknown>).map(([k, v]) => [k.slice(0, 100), typeof v === 'string' ? v.slice(0, 200_000) : '']));
    const pdf = await this.casesService.assessmentPdfFromContent(orgId, caseId, assessmentId, { ...checkComputeContent(p), title: p.title.slice(0, 500), sections_content: sections });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', privateCache);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /** The text of an uploaded PDF or text file (for an encrypted case the browser seals it afterwards); nothing is stored. */
  @Post('cases/:caseId/compute/extract-text')
  @Header('Cache-Control', privateCache)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async computeExtractText(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.computeAccess(orgId, caseId, req);
    if (!file) throw new BadRequestException('invalid-content');
    if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) return { ok: true, text: tidyExtractedText(file.buffer.toString('utf8')), extraction: null };
    if (!isPdf(file.buffer)) return { ok: true, text: null, extraction: null };
    const text = await extractPdfText(file.buffer);
    return { ok: true, text: text || null, extraction: text ? 'pdf' : 'pdf-no-text' };
  }

  // ---------------------------------------------------------------------------
  // AI providers of Cases (organizations.settings.cases.ai); the limit and spend: ai-settings.controller.ts
  // ---------------------------------------------------------------------------

  /**
   * Which providers transcribe, summarize and draft for Cases in this organization, and what this
   * instance offers (Organization settings -> AI and costs). Who sees Organization settings or Cases
   * sees it; only a superdeveloper may change it (canConfigure), since the instance owner pays Azure.
   */
  @Get('case-ai-settings')
  @Header('Cache-Control', privateCache)
  async getAiSettings(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const callerId = await this.requireCallerId(req);
    // Shown in Organization settings (AI and costs): whoever sees those or Cases, and superdevelopers.
    const superdeveloper = await isSuperDeveloper(this.db, callerId);
    if (!superdeveloper && !(await can(this.db, orgId, callerId, 'nav.orgSettings', 'see')) && !(await can(this.db, orgId, callerId, 'nav.cases', 'see'))) {
      throw new ForbiddenException('forbidden');
    }
    const providers = await this.caseAi.providers(orgId);
    return {
      ok: true,
      settings: providers.settings,
      providers: { transcription: providers.transcription, summary: providers.summary, draft: providers.draft },
      available: caseAiAvailability(),
      canConfigure: superdeveloper,
    };
  }

  @Put('case-ai-settings')
  async putAiSettings(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const callerId = await this.requireCallerId(req);
    if (!(await isSuperDeveloper(this.db, callerId))) throw new ForbiddenException('forbidden');
    const checked = validateCaseAiSettings(body);
    if (!checked.ok) throw new BadRequestException(checked.error);
    const available = caseAiAvailability();
    if ((checked.value.transcription === 'azure' && !available.azureTranscription)
      || ((checked.value.summary === 'azure' || checked.value.draft === 'azure') && !available.azureOpenai)) {
      throw new BadRequestException('ai-provider-not-configured');
    }
    await this.caseAi.saveSettings(orgId, checked.value);
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { cases: { ai: checked.value } } }).catch(() => {});
    return { ok: true, settings: checked.value };
  }

  // ---------------------------------------------------------------------------
  // Custom fields: the organization's own fields on cases and assessments
  // ---------------------------------------------------------------------------

  @Get('case-custom-fields')
  @Header('Cache-Control', privateCache)
  async getCustomFields(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const callerId = await this.requireCallerId(req);
    if (!(await can(this.db, orgId, callerId, 'nav.cases', 'see')) && !(await can(this.db, orgId, callerId, 'nav.orgSettings', 'see'))) throw new ForbiddenException('forbidden');
    return { ok: true, fields: await this.casesService.customFields(orgId), canEdit: await can(this.db, orgId, callerId, 'nav.orgSettings', 'edit') };
  }

  @Put('case-custom-fields')
  async putCustomFields(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: { fields?: unknown }) {
    const callerId = await this.requireCallerId(req);
    if (!(await can(this.db, orgId, callerId, 'nav.orgSettings', 'edit'))) throw new ForbiddenException('forbidden');
    const checked = validateCustomFieldDefs(body?.fields);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.casesService.saveCustomFields(orgId, checked.value);
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { cases: { customFields: checked.value } } }).catch(() => {});
    return { ok: true, fields: checked.value };
  }

  // ---------------------------------------------------------------------------
  // Assessment Templates (Client-Changeable)
  // ---------------------------------------------------------------------------

  @Get('assessment-templates')
  async listTemplates(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkSeeAccess(orgId, callerId);
    const templates = await this.casesService.listTemplates(orgId);
    // Which provider an AI draft goes to (null = none configured), shown before anything is sent.
    return { ok: true, templates, aiProvider: (await this.caseAi.providers(orgId)).draft };
  }

  @Get('assessment-templates/:templateId')
  async getTemplate(
    @Param('orgId') orgId: string,
    @Param('templateId') templateId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkSeeAccess(orgId, callerId);
    const template = await this.casesService.getTemplate(orgId, templateId);
    return { ok: true, template };
  }

  @Post('assessment-templates')
  async createTemplate(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateAssessmentTemplateDto,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkEditAccess(orgId, callerId);
    const template = await this.casesService.createTemplate(orgId, body);
    return { ok: true, template };
  }

  @Patch('assessment-templates/:templateId')
  async updateTemplate(
    @Param('orgId') orgId: string,
    @Param('templateId') templateId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateAssessmentTemplateDto,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkEditAccess(orgId, callerId);
    const template = await this.casesService.updateTemplate(orgId, templateId, body);
    return { ok: true, template };
  }
}
