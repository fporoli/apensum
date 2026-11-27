import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { addDays, holidayName, isIsoDate, weekStart as mondayOf } from '@worktime3/shared/worktime';
import { DbService } from './db.service';
import { callerUserId, canSeeUserData, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { localDate, WorkTimeModelService } from './work-time-model.service';
import { isoWeek, projectTotals, weekDates, weekGrid, type WeekDay, type WeekEntry } from './week-report';
import { clock } from './clock';

/** The page the weekly report belongs to (project time). */
const OBJECT = 'nav.time';
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The weekly report (Wochenrapport, week view of the project time page): a person's week with
 * attendance (In & Out), the target and the project time per project and subproject, for the person
 * and whoever sees their project time. A view only: time is submitted per month (the two timesheets).
 */
@Controller()
export class WeekReportController {
  constructor(
    private readonly db: DbService,
    private readonly workTime: WorkTimeModelService,
  ) {}

  /** The week of `week` (any day of it); holiday names in `lang`. */
  @Get('organizations/:orgId/users/:userId/week-report')
  async get(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query('week') week: string,
    @Req() req: AuthenticatedRequest,
    @Query('lang') lang?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(userId) || !(await isOrgMember(db, orgId, callerId)) || !(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    if (!(await canSeeUserData(db, orgId, callerId, OBJECT, userId))) return { ok: false, error: 'forbidden' };
    if (!isIsoDate(week)) return { ok: false, error: 'invalid-date' };

    const start = mondayOf(week);
    const end = addDays(start, 7);
    const timeZone = await this.workTime.timeZone(db, userId);
    const [targets, holidays, attendance, entries] = await Promise.all([
      this.workTime.targets(db, orgId, userId, start, end),
      this.workTime.holidays(db, orgId, start, end, { userId }),
      this.workTime.attendanceByDay(db, orgId, userId, start, end, timeZone, true),
      db.execute(sql`
        SELECT pt.start_time AS start, pt.end_time AS end, pt.project_id AS "projectId", p.name AS "projectName",
               pt.subproject_id AS "subprojectId", s.name AS "subprojectName"
        FROM project_times pt
        LEFT JOIN projects p ON p.id = pt.project_id
        LEFT JOIN subprojects s ON s.id = pt.subproject_id
        WHERE pt.organization_id = ${orgId} AND pt.user_id = ${userId}
          AND pt.start_time < (${end}::date::timestamp AT TIME ZONE ${timeZone})
          AND pt.end_time > (${start}::date::timestamp AT TIME ZONE ${timeZone})`),
    ]);
    const grid = weekGrid(start, entries.rows as unknown as WeekEntry[], timeZone);
    const project = projectTotals(grid);
    const days = weekDates(start).map((date, i): WeekDay => {
      const target = targets.find((t) => t.date === date);
      const holiday = holidays.get(date);
      return {
        date,
        target: target?.target ?? 0,
        attended: target?.notRecorded ? 0 : attendance.get(date) ?? 0,
        project: project[i],
        holiday: holiday ? holidayName(holiday, lang ?? 'de') : null,
        absenceType: target?.absenceType ?? null,
        ...(target?.notRecorded ? { notRecorded: true as const } : {}),
      };
    });
    return { ok: true, weekStart: start, week: isoWeek(start), today: localDate(clock.now(), timeZone), days, grid };
  }
}
