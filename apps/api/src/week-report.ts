import { addDays } from '@worktime3/shared/worktime';
import { minutesByLocalDay } from './work-time-model.service';

/**
 * The weekly report (project time page, week view): a person's week from Monday to Sunday with their
 * attendance (In & Out), the target, and their project time per project and subproject, each day and
 * in total, plus the differences to attendance and to the target. Pure: the controller loads the rows.
 * Only a view: time is submitted per month (the two monthly timesheets).
 */

export interface WeekEntry {
  start: string;
  end: string;
  projectId: string | null;
  projectName: string | null;
  subprojectId: string | null;
  subprojectName: string | null;
}

export interface WeekDay {
  date: string;
  /** Minutes the person is expected to work (scheduled − holiday − absence). */
  target: number;
  /** Attended minutes (check-in/check-out sessions, an open one up to now). */
  attended: number;
  /** Project minutes booked that day. */
  project: number;
  holiday: string | null;
  absenceType: string | null;
  /** No working time is recorded that day: nothing to compare project time with. */
  notRecorded?: true;
}

export interface WeekLine {
  id: string | null;
  name: string | null;
  /** Minutes per day, Monday first. */
  minutes: number[];
  total: number;
}

export interface WeekProject extends WeekLine {
  /** Subprojects, by name; entries without one are a line with `id` null when the project has others. */
  subprojects: WeekLine[];
}

export interface WeekGrid {
  weekStart: string;
  dates: string[];
  /** Projects by name; hours without a project last (`id` null). */
  projects: WeekProject[];
}

/** The seven dates of the week starting on `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** ISO 8601 week number of a date. */
export function isoWeek(date: string): number {
  // The week belongs to the year of its Thursday; count weeks from that year's 1 January.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function line(id: string | null, name: string | null): WeekLine {
  return { id, name, minutes: [0, 0, 0, 0, 0, 0, 0], total: 0 };
}

/** Groups the week's entries by project and subproject, each split at the person's local midnight. */
export function weekGrid(weekStart: string, entries: readonly WeekEntry[], timeZone: string): WeekGrid {
  const dates = weekDates(weekStart);
  const end = addDays(weekStart, 7);
  const byProject = new Map<string, { project: WeekProject; subs: Map<string, WeekLine> }>();
  for (const e of entries) {
    const perDay = minutesByLocalDay([{ start: e.start, end: e.end }], weekStart, end, timeZone);
    if (perDay.size === 0) continue;
    const pKey = e.projectId ?? '';
    let p = byProject.get(pKey);
    if (!p) {
      p = { project: { ...line(e.projectId, e.projectName), subprojects: [] }, subs: new Map() };
      byProject.set(pKey, p);
    }
    const sKey = e.subprojectId ?? '';
    let s = p.subs.get(sKey);
    if (!s) {
      s = line(e.subprojectId, e.subprojectName);
      p.subs.set(sKey, s);
    }
    for (const [day, minutes] of perDay) {
      const i = dates.indexOf(day);
      if (i < 0) continue;
      p.project.minutes[i] += minutes;
      p.project.total += minutes;
      s.minutes[i] += minutes;
      s.total += minutes;
    }
  }
  const byName = (a: WeekLine, b: WeekLine) => (a.id === null ? 1 : b.id === null ? -1 : (a.name ?? '').localeCompare(b.name ?? ''));
  const projects = [...byProject.values()].map(({ project, subs }) => {
    const lines = [...subs.values()];
    // A project booked only without subprojects needs no breakdown.
    project.subprojects = lines.length === 1 && lines[0].id === null ? [] : lines.sort(byName);
    return project;
  });
  return { weekStart, dates, projects: projects.sort(byName) };
}

/** Project minutes per day of the grid, Monday first. */
export function projectTotals(grid: WeekGrid): number[] {
  return grid.dates.map((_, i) => grid.projects.reduce((s, p) => s + p.minutes[i], 0));
}
