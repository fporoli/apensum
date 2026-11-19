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
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isSuperDeveloper, permissionIdsOf } from './access';
import { grantedScopes } from '@worktime3/shared/permissions';
import type { AuthenticatedRequest } from './jwt.guard';
import { CasesService } from './cases.service';
import { extractPdfText, isPdf, tidyExtractedText } from './case-document-text';
import { CaseAiService, caseAiAvailability } from './case-ai.service';
import { AiBudgetService, instanceBudgetChf } from './ai-budget.service';
import { VersionsService } from './versions.service';
import { validateCaseAiSettings } from '@worktime3/shared/cases';
import type {
  CreateCaseDto,
  UpdateCaseDto,
  CreateCaseDocumentDto,
  CreateCaseInterviewDto,
  CreateAssessmentDto,
  UpdateAssessmentDto,
  CreateAssessmentTemplateDto,
  UpdateAssessmentTemplateDto,
} from '@worktime3/shared/cases';

const interviewUpload = { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 2, fieldSize: 1_300_000 } };
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
    private readonly aiBudget: AiBudgetService,
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
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const callerId = await this.requireCallerId(req);
    await this.checkEditAccess(orgId, callerId, await this.casesService.getCase(orgId, caseId));
    if (!file) throw new BadRequestException('interview-audio-not-found');
    const interview = await this.casesService.replaceInterviewAudio(orgId, caseId, interviewId, callerId, interviewRevision(revision), file);
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
    await this.checkEditAccess(orgId, callerId, await this.casesService.getCase(orgId, caseId));
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
    await this.checkEditAccess(orgId, callerId, await this.casesService.getCase(orgId, caseId));
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
    const assessment = await this.casesService.createAssessment(orgId, caseId, callerId, body);
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
    const updated = await this.casesService.updateAssessment(caseId, assessmentId, callerId, body);
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
    const pdfBuffer = await this.casesService.generateAssessmentPdf(orgId, caseId, assessmentId, callerId);

    const safeRef = caseItem.reference_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Beurteilung_${safeRef}_v${assessmentId.slice(0, 8)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  // ---------------------------------------------------------------------------
  // AI providers and cost limits (organizations.settings.cases.ai)
  // ---------------------------------------------------------------------------

  /**
   * The organization's AI choices, what this instance offers and this month's Azure spend
   * (Organization settings -> AI and costs). Who sees Organization settings or Cases sees it; only a superdeveloper may change it (canConfigure) and sees
   * the whole instance's spend, since the instance owner pays the Azure bill.
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
    const [providers, totals] = await Promise.all([this.caseAi.providers(orgId), this.aiBudget.totals(orgId)]);
    return {
      ok: true,
      settings: providers.settings,
      providers: { transcription: providers.transcription, summary: providers.summary, draft: providers.draft },
      available: caseAiAvailability(),
      canConfigure: superdeveloper,
      usage: {
        orgSpentChf: totals.orgSpentChf,
        orgCalls: totals.orgCalls,
        ...(superdeveloper ? { instanceSpentChf: totals.instanceSpentChf, instanceBudgetChf: instanceBudgetChf() } : {}),
      },
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
