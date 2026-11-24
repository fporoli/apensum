import { Body, Controller, Delete, Get, OnModuleInit, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { callerUserId, canEditBeyondOwn, canSeeUserData, isOrgMember, isPeriodLocked, listableUserIds, membershipManagerId } from './access';
import { VACATION_ABSENCE_TYPE, monthStart, nextMonth } from '@worktime3/shared/worktime';
import type { AuthenticatedRequest } from './jwt.guard';
import { probationUntilOf } from './vacation';
import { absences, static_data, users, workflows } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService, APPROVE_ABSENCE_WORKFLOW_NAME } from './workflows.service';
import { absenceNeedsApproval, resolveAbsenceTypes, unpaidAbsenceTypes } from './absence-types';
import type { WorkflowKindCatalogue } from '@worktime3/shared/workflowConfig';
import { sql } from 'drizzle-orm';
import { NotificationsService } from './notifications.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';

const STATUSES = ['pending', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

export { resolveAbsenceTypes };

/** Whether any day of `[dateStart, dateEnd]` lies in a submitted or approved timesheet month. */
export async function touchesLockedPeriod(db: Db, orgId: string, userId: string, dateStart: string, dateEnd: string): Promise<boolean> {
  for (let day = dateStart; day <= dateEnd; day = nextMonth(monthStart(day))) {
    if (await isPeriodLocked(db, orgId, userId, day)) return true;
  }
  return false;
}

/**
 * An absence request's workflow (configurable, Admin settings -> Workflows): approvals one after the other, each a
 * decision (nobody approves their own); rejecting is final (the person asks anew). The absence is approved once the
 * last approval is done. Facts: its type, calendar days (a half day 0.5), unpaid, in probation, the person's department
 * (code) and management flag. Default: the manager. Types without approval (sickness, accident) have no workflow.
 */
export const ABSENCE_CATALOGUE: WorkflowKindCatalogue = {
  id: 'absences.request',
  definitionName: APPROVE_ABSENCE_WORKFLOW_NAME,
  rejectModes: ['none', 'end'],
  facts: { type: 'string', days: 'number', unpaid: 'boolean', probation: 'boolean', 'requester.department': 'string', 'requester.management': 'boolean' },
  blocks: {
    review: {
      label: 'Approval', action: 'absence.reviewed', returnAction: 'absence.reject', decides: true,
      assignees: ['manager', 'department', 'team', 'permission:section.people.employment', 'permission:nav.absences'],
    },
  },
  defaultConfig: {
    version: 1,
    steps: [{ key: 'manager_review', do: ['review'], assignTo: 'manager', reject: 'end', label: { de: 'Freigabe Vorgesetzte', fr: 'Approbation du supérieur', it: 'Approvazione del superiore', en: 'Manager approval' } }],
  },
  source: 'Vacation Request',
  source_name: 'getAbsenceTitle',
};

@Controller()
export class AbsencesController implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly documents: DocumentsService,
    private readonly notifications?: NotificationsService,
  ) {}

  /** Absences own what "absence.*" workflow actions actually do, and how to resolve an absences row's organization. */
  onModuleInit() {
    this.workflowsSvc.registerSourceOrgResolver('absences', async (db, sourceTableUuid) => {
      const [row] = await db.select({ organization_id: absences.organization_id }).from(absences).where(eq(absences.id, sourceTableUuid));
      return row?.organization_id ?? null;
    });

    this.workflowsSvc.registerAction('absence.approve', async (db, ctx) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(absences).set(patch).where(eq(absences.id, ctx.sourceTableUuid));
      void this.versions.record('absences', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });

    // An approval with more to come changes nothing yet; the last one approves the absence (onFinished).
    this.workflowsSvc.registerAction('absence.reviewed', async () => {});
    this.workflowsSvc.registerKind({
      catalogue: ABSENCE_CATALOGUE,
      description: 'An absence request: approved by the steps the organization set (the manager by default).',
      sourceTable: 'absences',
      facts: (db, id) => this.facts(db, id),
      onFinished: async (db, id, actorUserId) => {
        const patch = { status: 'approved' as const, reviewed_by_user_id: actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
        await db.update(absences).set(patch).where(and(eq(absences.id, id), eq(absences.status, 'pending')));
        void this.versions.record('absences', id, 'update_delta', actorUserId, patch).catch(() => {});
      },
    });

    this.workflowsSvc.registerAction('absence.reject', async (db, ctx) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(absences).set(patch).where(eq(absences.id, ctx.sourceTableUuid));
      void this.versions.record('absences', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });
  }

  /** An absence's facts for its workflow's conditions. */
  private async facts(db: Db, id: string): Promise<Record<string, unknown>> {
    const [a] = await db.select({ organization_id: absences.organization_id, user_id: absences.user_id, absence_type: absences.absence_type,
      date_start: absences.date_start, date_end: absences.date_end, half_day: absences.half_day }).from(absences).where(eq(absences.id, id));
    if (!a) return {};
    const types = await resolveAbsenceTypes(db, a.organization_id);
    const days = a.half_day ? 0.5 : Math.round((Date.parse(`${a.date_end}T00:00:00Z`) - Date.parse(`${a.date_start}T00:00:00Z`)) / 86_400_000) + 1;
    const probationUntil = await probationUntilOf(db, a.organization_id, a.user_id);
    const rows = await db.execute(sql`
      SELECT d.code, ea.is_management FROM employee_assignments ea LEFT JOIN departments d ON d.id = ea.department_id
      WHERE ea.organization_id = ${a.organization_id}::uuid AND ea.user_id = ${a.user_id}::uuid AND ea.valid_from <= CURRENT_DATE
      ORDER BY ea.valid_from DESC LIMIT 1`);
    const assignment = rows.rows[0] as { code: string | null; is_management: boolean | null } | undefined;
    return {
      type: a.absence_type,
      days,
      unpaid: unpaidAbsenceTypes(types).has(a.absence_type),
      probation: !!probationUntil && a.date_start <= probationUntil,
      'requester.management': !!assignment?.is_management,
      ...(assignment?.code ? { 'requester.department': assignment.code } : {}),
    };
  }

  @Post('organizations/:orgId/absences')
  async submit(
    @Param('orgId') orgId: string,
    @Body() body: { dateStart: string; dateEnd: string; note?: string; absenceType?: string; halfDay?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const dateStart = (body.dateStart ?? '').trim();
    const dateEnd = (body.dateEnd ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) return { ok: false, error: 'invalid-dates' };
    if (dateEnd < dateStart) return { ok: false, error: 'invalid-dates' };
    const note = (body.note ?? '').trim();

    const halfDay = body.halfDay === true;
    if (halfDay && dateEnd !== dateStart) return { ok: false, error: 'half-day-requires-single-day' };
    const absenceType = (body.absenceType ?? 'vacation').trim() || 'vacation';
    const types = await resolveAbsenceTypes(db, orgId);
    if (!Object.hasOwn(types, absenceType)) return { ok: false, error: 'invalid-absence-type' };

    // Range overlap: an existing pending/approved request overlaps [dateStart, dateEnd] when
    // its own start is on or before our end, and its own end is on or after our start.
    const [overlap] = await db
      .select({ id: absences.id })
      .from(absences)
      .where(
        and(
          eq(absences.organization_id, orgId),
          eq(absences.user_id, callerId),
          inArray(absences.status, ['pending', 'approved']),
          lte(absences.date_start, dateEnd),
          gte(absences.date_end, dateStart),
        ),
      );
    if (overlap) return { ok: false, error: 'overlapping-request' };
    // A submitted or approved timesheet freezes its month's balance; the absence would change it.
    if (await touchesLockedPeriod(db, orgId, callerId, dateStart, dateEnd)) return { ok: false, error: 'period-locked' };

    const now = new Date().toISOString();
    const managerUserId = await membershipManagerId(db, orgId, callerId);
    // A type flagged {approval: false} in static data (sickness, accident) is recorded at once; the others go through
    // the organization's absence workflow (a manager's approval without a manager is done at once there).
    const needsApproval = absenceNeedsApproval(types, absenceType);
    const recordedAtOnce = !needsApproval;
    // Vacation in probation is a warning to the person and the manager, never a refusal.
    const probationUntil = absenceType === VACATION_ABSENCE_TYPE ? await probationUntilOf(db, orgId, callerId) : null;
    const inProbation = !!probationUntil && dateStart <= probationUntil;
    const probationWarning = inProbation ? `Vacation during probation (until ${probationUntil})` : '';
    const reviewFields = recordedAtOnce
      ? { status: 'approved' as const, reviewed_by_user_id: callerId, reviewed_at: now }
      : { status: 'pending' as const, reviewed_by_user_id: null, reviewed_at: null };

    const values = { organization_id: orgId, user_id: callerId, date_start: dateStart, date_end: dateEnd, absence_type: absenceType, half_day: halfDay, note: note || null, ...reviewFields };
    const [created] = await db.insert(absences).values(values).returning({ id: absences.id });
    void this.versions.record('absences', created.id, 'insert', callerId, { id: created.id, ...values }).catch(() => {});
    // One action for every type: "recorded without approval" alone would tell that it is sickness.
    void this.audit.record(orgId, callerId, 'absence.submit', 'absence', created.id).catch(() => {});

    let autoApproved = recordedAtOnce;
    if (!recordedAtOnce) {
      const started = await this.workflowsSvc.start(db, {
        kind: ABSENCE_CATALOGUE.id,
        organizationId: orgId,
        sourceTableUuid: created.id,
        actorUserId: callerId,
        workflowData: { note: note || null },
        notification: { title: 'New absence request to review', body: [probationWarning, note].filter(Boolean).join('\n') || undefined },
      });
      autoApproved = !!started?.finished;
    }

    if (autoApproved && managerUserId && this.notifications) {
      // Recorded without approval: the manager still needs to know.
      const [person] = await db.select({ name: users.display_name, email: users.email }).from(users).where(eq(users.id, callerId));
      const who = person?.name || person?.email || 'Someone';
      const range = dateStart === dateEnd ? dateStart : `${dateStart} – ${dateEnd}`;
      void this.notifications
        .notifyMany({
          organizationId: orgId,
          recipientUserIds: [managerUserId],
          type: 'absence.recorded',
          title: `${who} reported an absence: ${absenceType}`,
          body: [range + (halfDay ? ' (half day)' : ''), probationWarning, note].filter(Boolean).join('\n'),
          sourceTable: 'absences',
          sourceTableUuid: created.id,
          data: { absenceId: created.id, userId: callerId, absenceType, dateStart, dateEnd, halfDay },
        })
        .catch((err) => console.error('notify-absence-recorded-failed', err));
    }

    return { ok: true, id: created.id, autoApproved, managerNotified: autoApproved && !!managerUserId, ...(inProbation ? { inProbation } : {}) };
  }

  @Get('organizations/:orgId/absences')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];

    const conditions: SQL[] = [eq(absences.organization_id, orgId)];
    if (userId) {
      if (!(await canSeeUserData(db, orgId, callerId, 'nav.absences', userId))) return [];
      conditions.push(eq(absences.user_id, userId));
    } else {
      // Own, direct reports', and whoever the caller's grants cover (admin: everyone).
      const ids = await listableUserIds(db, orgId, callerId, 'nav.absences');
      if (ids !== 'all') conditions.push(inArray(absences.user_id, ids));
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(absences.status, status as Status));
    }

    return db
      .select({
        id: absences.id,
        user_id: absences.user_id,
        date_start: absences.date_start,
        date_end: absences.date_end,
        status: absences.status,
        absence_type: absences.absence_type,
        half_day: absences.half_day,
        document_id: absences.document_id,
        note: absences.note,
        review_note: absences.review_note,
        reviewed_at: absences.reviewed_at,
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(absences)
      .innerJoin(users, eq(users.id, absences.user_id))
      .where(and(...conditions))
      .orderBy(desc(absences.date_start));
  }

  /** Caller cancels their own still-pending request. */
  @Delete('absences/:id')
  async cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const [row] = await db.select({ organization_id: absences.organization_id, user_id: absences.user_id, status: absences.status }).from(absences).where(eq(absences.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (row.status !== 'pending') return { ok: false, error: 'not-pending' };

    // Drop it from the manager's Approvals queue without going through resolve() — the requester
    // isn't the assignee, so resolve() would (correctly) reject them.
    const pending = await this.workflowsSvc.findPending(db, 'absences', id, APPROVE_ABSENCE_WORKFLOW_NAME);
    if (pending) {
      await db.update(workflows).set({ step_status: 'cancelled', workflow_finished: new Date().toISOString() }).where(eq(workflows.workflow_id, pending.id));
    }

    await db.delete(absences).where(eq(absences.id, id));
    void this.audit.record(row.organization_id, callerId, 'absence.cancel', 'absence', id).catch(() => {});
    return { ok: true };
  }

  /** Evidence upload for an absence (e.g. a doctor's note) — the requester or an org admin. Replaces any existing one. */
  @Post('organizations/:orgId/absences/:id/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!file) return { ok: false, error: 'file-required' };

    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence || absence.organization_id !== orgId) return { ok: false, error: 'not-found' };
    if (absence.user_id !== callerId && !(await canEditBeyondOwn(db, orgId, callerId, 'nav.absences', absence.user_id))) return { ok: false, error: 'forbidden' };

    const newDocId = await this.documents.upload(db, orgId, callerId, file, { table: 'absences', id });
    await db.update(absences).set({ document_id: newDocId }).where(eq(absences.id, id));
    if (absence.document_id) await this.documents.remove(db, absence.document_id);
    void this.audit.record(orgId, callerId, 'absence.document.upload', 'absence', id, {}).catch(() => {});
    return { ok: true, id: newDocId };
  }

  @Get('organizations/:orgId/absences/:id/document')
  async getDocument(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence || absence.organization_id !== orgId || !absence.document_id) return null;
    if (!(await canSeeUserData(db, orgId, callerId, 'nav.absences', absence.user_id))) return null;

    const doc = await this.documents.get(db, absence.document_id);
    if (!doc) return null;
    return { id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type, size_bytes: doc.size_bytes, created_at: doc.created_at };
  }

  @Get('absences/:id/document')
  async downloadDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId) {
      res.status(401).json({ ok: false, error: 'unauthenticated' });
      return;
    }
    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence?.document_id) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    if (!(await canSeeUserData(db, absence.organization_id, callerId, 'nav.absences', absence.user_id))) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const doc = await this.documents.get(db, absence.document_id);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }

  /** Caller removes the evidence document: the requester while their absence is still pending, or an org admin any time. */
  @Delete('absences/:id/document')
  async deleteDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, status: absences.status, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence?.document_id) return { ok: false, error: 'not-found' };
    const isOwnerPending = absence.user_id === callerId && absence.status === 'pending';
    if (!isOwnerPending && !(await canEditBeyondOwn(db, absence.organization_id, callerId, 'nav.absences', absence.user_id))) return { ok: false, error: 'forbidden' };

    await db.update(absences).set({ document_id: null }).where(eq(absences.id, id));
    await this.documents.remove(db, absence.document_id);
    void this.audit.record(absence.organization_id, callerId, 'absence.document.delete', 'absence', id).catch(() => {});
    return { ok: true };
  }
}
