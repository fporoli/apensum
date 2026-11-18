import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, permissionIdsOf } from './access';
import { grantedScopes } from '@worktime3/shared/permissions';
import type { AuthenticatedRequest } from './jwt.guard';
import { CasesService } from './cases.service';
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

@Controller('api/v1/organizations/:orgId')
export class CasesController {
  constructor(
    private readonly dbService: DbService,
    private readonly casesService: CasesService,
    private readonly documentsService: DocumentsService,
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
    const title = body.title || file?.originalname || 'Evidence Document';
    const category = body.category || 'evidence';

    if (file) {
      documentId = await this.documentsService.upload(this.db, orgId, callerId, file, {
        table: 'cases.case_documents',
        id: caseId,
      });

      // If text/plain or markdown file, parse directly into extracted_text if not provided
      if (!extractedText && (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt'))) {
        try {
          extractedText = file.buffer.toString('utf8');
        } catch {
          // ignore
        }
      }
    }

    const doc = await this.casesService.createDocument(orgId, caseId, {
      title,
      category,
      document_id: documentId,
      extracted_text: extractedText,
      metadata: body.metadata ? (typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata) : {},
    });

    return { ok: true, document: doc };
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
    return { ok: true, interviews };
  }

  @Post('cases/:caseId/interviews')
  async createInterview(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateCaseInterviewDto,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const interview = await this.casesService.createInterview(orgId, caseId, callerId, body);
    return { ok: true, interview };
  }

  @Patch('cases/:caseId/interviews/:interviewId')
  async updateInterview(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('interviewId') interviewId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: Partial<CreateCaseInterviewDto>,
  ) {
    const callerId = await this.requireCallerId(req);
    const caseItem = await this.casesService.getCase(orgId, caseId);
    await this.checkEditAccess(orgId, callerId, caseItem);
    const updated = await this.casesService.updateInterview(caseId, interviewId, body);
    return { ok: true, interview: updated };
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
    await this.casesService.deleteInterview(caseId, interviewId);
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
    return { ok: true, templates };
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
