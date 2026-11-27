import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Db } from './db.service';
import {
  absences,
  employee_assignments,
  organization_memberships,
  organizations,
  users,
} from './db/schema';
import { directReportUserIds, isOrgMember, listableUserIds } from './access';
import { HOLIDAY_NAMES } from '@worktime3/shared/worktime';
import { holidaysFor, parseWorkTimeSettings } from './work-time-model.service';
import { clock, sqlToday } from './clock';

export type CalendarFeedScope = 'personal' | 'team' | 'all';

export interface StoredCalendarFeed {
  token: string;
  enabled: boolean;
  scope: CalendarFeedScope;
  include_holidays: boolean;
  created_at: string;
  last_accessed_at?: string | null;
}

export interface ClientCalendarFeed {
  token: string;
  enabled: boolean;
  scope: CalendarFeedScope;
  includeHolidays: boolean;
  createdAt: string;
  lastAccessedAt?: string | null;
  feedUrl: string;
  webcalUrl: string;
}

/** Escapes text for RFC 5545 iCalendar values. */
export function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds lines exceeding 75 octets per RFC 5545 section 3.1. */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let remaining = line.slice(75);
  while (remaining.length > 0) {
    chunks.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join('\r\n');
}

/** Converts 'YYYY-MM-DD' to 'YYYYMMDD'. */
export function toIcsDate(isoDate: string): string {
  if (!isoDate || typeof isoDate !== 'string') return '';
  return isoDate.replace(/-/g, '').slice(0, 8);
}

/** Adds `days` to an ISO date string in a UTC-safe manner. */
export function addDaysIso(isoDate: string, days: number): string {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export interface CalendarEventItem {
  uid: string;
  summary: string;
  description?: string;
  dateStart: string; // YYYY-MM-DD
  dateEndExclusive: string; // YYYY-MM-DD (exclusive)
  isTransparent?: boolean;
  createdUtc?: string;
}

/** Serializes a set of events into RFC 5545 VCALENDAR format. */
export function buildIcsCalendar(params: {
  calendarName: string;
  events: CalendarEventItem[];
}): string {
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // real time: the feed file is made now
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apensum//Absence Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(params.calendarName)}`,
    'X-WR-TIMEZONE:Europe/Zurich',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const ev of params.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${ev.createdUtc ?? nowUtc}`);
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(ev.dateStart)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(ev.dateEndExclusive)}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push(ev.isTransparent ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map((l) => foldIcsLine(l)).join('\r\n') + '\r\n';
}

function makeWebcalUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//i, 'webcal://');
}

function formatAbsenceType(rawType: string): string {
  if (!rawType) return 'Absence';
  return rawType
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class CalendarFeedService {
  /** Resolves which scopes the caller is authorized to subscribe to. */
  async resolveAllowedScopes(db: Db, orgId: string, userId: string): Promise<CalendarFeedScope[]> {
    const scopes: CalendarFeedScope[] = ['personal'];

    const directReports = await directReportUserIds(db, orgId, userId);
    if (directReports.length > 0) {
      scopes.push('team');
    } else {
      const listable = await listableUserIds(db, orgId, userId, 'nav.absences');
      if (listable === 'all' || (Array.isArray(listable) && listable.length > 1)) {
        scopes.push('team');
      }
    }

    const listableAll = await listableUserIds(db, orgId, userId, 'nav.absences');
    if (listableAll === 'all') {
      if (!scopes.includes('team')) scopes.push('team');
      scopes.push('all');
    }

    return scopes;
  }

  /** Resolves all user IDs in the caller's team (direct reports + department peers). */
  async resolveTeamUserIds(db: Db, orgId: string, userId: string): Promise<string[]> {
    const ids = new Set<string>([userId]);
    const directReports = await directReportUserIds(db, orgId, userId);
    for (const dr of directReports) ids.add(dr);

    try {
      const deptRows = await db.execute(
        sql`SELECT department_id FROM employee_assignments
            WHERE organization_id = ${orgId} AND user_id = ${userId} AND valid_from <= ${sqlToday()}
            ORDER BY valid_from DESC LIMIT 1`,
      );
      const deptId = deptRows.rows?.[0]?.department_id as string | undefined;
      if (deptId) {
        const peerRows = await db.execute(
          sql`SELECT DISTINCT user_id FROM (
                SELECT DISTINCT ON (user_id) user_id, department_id FROM employee_assignments
                WHERE organization_id = ${orgId} AND valid_from <= ${sqlToday()}
                ORDER BY user_id, valid_from DESC
              ) cur WHERE department_id = ${deptId}`,
        );
        for (const r of peerRows.rows ?? []) {
          if (typeof r.user_id === 'string') ids.add(r.user_id);
        }
      }
    } catch {
      // Fallback to direct reports if tables differ
    }

    return [...ids];
  }

  /** Retrieves the current user's feed config and permitted scopes. */
  async getFeedConfig(
    db: Db,
    orgId: string,
    userId: string,
    apiBaseUrl: string,
  ): Promise<{ feed: ClientCalendarFeed | null; allowedScopes: CalendarFeedScope[] }> {
    const allowedScopes = await this.resolveAllowedScopes(db, orgId, userId);

    const [row] = await db
      .select({ settings: organization_memberships.settings })
      .from(organization_memberships)
      .where(
        and(
          eq(organization_memberships.organization_id, orgId),
          eq(organization_memberships.user_id, userId),
          eq(organization_memberships.status, 'active'),
        ),
      );

    const stored = (row?.settings as Record<string, unknown> | undefined)?.calendar_feed as StoredCalendarFeed | undefined;
    if (!stored || !stored.token) {
      return { feed: null, allowedScopes };
    }

    const feedUrl = `${apiBaseUrl}/calendar/absences/${stored.token}.ics`;
    const webcalUrl = makeWebcalUrl(feedUrl);

    return {
      feed: {
        token: stored.token,
        enabled: stored.enabled !== false,
        scope: stored.scope ?? 'personal',
        includeHolidays: stored.include_holidays !== false,
        createdAt: stored.created_at,
        lastAccessedAt: stored.last_accessed_at ?? null,
        feedUrl,
        webcalUrl,
      },
      allowedScopes,
    };
  }

  /** Creates or updates the user's feed configuration. */
  async updateFeedConfig(
    db: Db,
    orgId: string,
    userId: string,
    options: {
      enabled?: boolean;
      scope?: CalendarFeedScope;
      includeHolidays?: boolean;
      regenerate?: boolean;
    },
    apiBaseUrl: string,
  ): Promise<{ ok: true; feed: ClientCalendarFeed } | { ok: false; error: string }> {
    const [membership] = await db
      .select({ id: organization_memberships.id, settings: organization_memberships.settings })
      .from(organization_memberships)
      .where(
        and(
          eq(organization_memberships.organization_id, orgId),
          eq(organization_memberships.user_id, userId),
          eq(organization_memberships.status, 'active'),
        ),
      );

    if (!membership) return { ok: false, error: 'membership-not-found' };

    const allowedScopes = await this.resolveAllowedScopes(db, orgId, userId);
    const targetScope = options.scope ?? 'personal';
    if (!allowedScopes.includes(targetScope)) {
      return { ok: false, error: 'forbidden-scope' };
    }

    const currentSettings = (membership.settings && typeof membership.settings === 'object' && !Array.isArray(membership.settings))
      ? { ...(membership.settings as Record<string, unknown>) }
      : {};

    const existingFeed = currentSettings.calendar_feed as StoredCalendarFeed | undefined;

    let token = existingFeed?.token;
    if (!token || options.regenerate) {
      token = randomBytes(24).toString('hex');
    }

    const newFeed: StoredCalendarFeed = {
      token,
      enabled: options.enabled !== undefined ? options.enabled : (existingFeed?.enabled ?? true),
      scope: targetScope,
      include_holidays: options.includeHolidays !== undefined ? options.includeHolidays : (existingFeed?.include_holidays ?? true),
      created_at: options.regenerate || !existingFeed?.created_at ? new Date().toISOString() : existingFeed.created_at, // real time: the feed link
      last_accessed_at: existingFeed?.last_accessed_at ?? null,
    };

    currentSettings.calendar_feed = newFeed;

    await db
      .update(organization_memberships)
      .set({ settings: currentSettings })
      .where(eq(organization_memberships.id, membership.id));

    const feedUrl = `${apiBaseUrl}/calendar/absences/${token}.ics`;
    const webcalUrl = makeWebcalUrl(feedUrl);

    return {
      ok: true,
      feed: {
        token: newFeed.token,
        enabled: newFeed.enabled,
        scope: newFeed.scope,
        includeHolidays: newFeed.include_holidays,
        createdAt: newFeed.created_at,
        lastAccessedAt: newFeed.last_accessed_at ?? null,
        feedUrl,
        webcalUrl,
      },
    };
  }

  /** Deactivates or removes the user's calendar feed. */
  async deleteFeedConfig(db: Db, orgId: string, userId: string): Promise<{ ok: boolean }> {
    const [membership] = await db
      .select({ id: organization_memberships.id, settings: organization_memberships.settings })
      .from(organization_memberships)
      .where(
        and(
          eq(organization_memberships.organization_id, orgId),
          eq(organization_memberships.user_id, userId),
          eq(organization_memberships.status, 'active'),
        ),
      );

    if (!membership) return { ok: true };

    const currentSettings = (membership.settings && typeof membership.settings === 'object' && !Array.isArray(membership.settings))
      ? { ...(membership.settings as Record<string, unknown>) }
      : {};

    if (currentSettings.calendar_feed) {
      delete currentSettings.calendar_feed;
      await db
        .update(organization_memberships)
        .set({ settings: currentSettings })
        .where(eq(organization_memberships.id, membership.id));
    }

    return { ok: true };
  }

  /** Generates the raw iCalendar string for a given token. */
  async generateIcsForToken(
    db: Db,
    token: string,
  ): Promise<{ ics: string; filename: string } | null> {
    const cleanToken = token.replace(/\.ics$/i, '').trim();
    if (!/^[a-f0-9]{32,64}$/i.test(cleanToken)) {
      return null;
    }

    const rows = await db
      .select({
        id: organization_memberships.id,
        organization_id: organization_memberships.organization_id,
        user_id: organization_memberships.user_id,
        settings: organization_memberships.settings,
        user_display_name: users.display_name,
        user_email: users.email,
        org_name: organizations.name,
        org_settings: organizations.settings,
      })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .innerJoin(organizations, eq(organizations.id, organization_memberships.organization_id))
      .where(
        and(
          eq(organization_memberships.status, 'active'),
          sql`${organization_memberships.settings}->'calendar_feed'->>'token' = ${cleanToken}`,
        ),
      );

    if (rows.length === 0) return null;
    const member = rows[0];

    const feed = (member.settings as Record<string, unknown> | undefined)?.calendar_feed as StoredCalendarFeed | undefined;
    if (!feed || feed.enabled === false) return null;

    // Asynchronously record last_accessed_at timestamp without blocking
    void (async () => {
      try {
        const nextSettings = {
          ...((member.settings as Record<string, unknown>) ?? {}),
          calendar_feed: {
            ...feed,
            last_accessed_at: new Date().toISOString(), // real time: the feed link
          },
        };
        await db
          .update(organization_memberships)
          .set({ settings: nextSettings })
          .where(eq(organization_memberships.id, member.id));
      } catch {
        // ignore access logging failure
      }
    })();

    // Date range: recent 90 days past + next 365 days
    const today = clock.now().toISOString().slice(0, 10);
    const fromDate = addDaysIso(today, -90);
    const toDate = addDaysIso(today, 365);

    const conditions: SQL[] = [
      eq(absences.organization_id, member.organization_id),
      eq(absences.status, 'approved'),
      gte(absences.date_end, fromDate),
      lte(absences.date_start, toDate),
    ];

    if (feed.scope === 'personal') {
      conditions.push(eq(absences.user_id, member.user_id));
    } else if (feed.scope === 'team') {
      // The team as far as the person may see it today: the feed outlives a lost right.
      const allowed = await listableUserIds(db, member.organization_id, member.user_id, 'nav.absences');
      const team = await this.resolveTeamUserIds(db, member.organization_id, member.user_id);
      conditions.push(inArray(absences.user_id, allowed === 'all' ? team : team.filter((u) => u === member.user_id || allowed.includes(u))));
    } else if (feed.scope === 'all') {
      const allowed = await listableUserIds(db, member.organization_id, member.user_id, 'nav.absences');
      if (allowed !== 'all') {
        conditions.push(inArray(absences.user_id, allowed));
      }
    }

    const absenceRows = await db
      .select({
        id: absences.id,
        user_id: absences.user_id,
        date_start: absences.date_start,
        date_end: absences.date_end,
        absence_type: absences.absence_type,
        half_day: absences.half_day,
        note: absences.note,
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(absences)
      .innerJoin(users, eq(users.id, absences.user_id))
      .where(and(...conditions))
      .orderBy(absences.date_start);

    const events: CalendarEventItem[] = [];

    for (const r of absenceRows) {
      const typeTitle = formatAbsenceType(r.absence_type);
      const isPersonal = feed.scope === 'personal' || r.user_id === member.user_id;
      const employeeName = r.user_display_name || r.user_email;

      const summary = isPersonal
        ? `${typeTitle}${r.half_day ? ' (Half Day)' : ''}`
        : `${employeeName}: ${typeTitle}${r.half_day ? ' (Half Day)' : ''}`;

      const descLines = [
        `Employee: ${employeeName} (${r.user_email})`,
        `Type: ${typeTitle}`,
        `Duration: ${r.half_day ? 'Half day' : 'Full day'}`,
        `Dates: ${r.date_start} to ${r.date_end}`,
        'Status: Approved',
      ];
      if (r.note) {
        descLines.push(`Note: ${r.note}`);
      }

      events.push({
        uid: `absence-${r.id}@apensum`,
        summary,
        description: descLines.join('\n'),
        dateStart: r.date_start,
        dateEndExclusive: addDaysIso(r.date_end, 1),
        isTransparent: false,
      });
    }

    // Public & Organization Holidays
    if (feed.include_holidays !== false) {
      try {
        const wtSettings = parseWorkTimeSettings(member.org_settings);
        // The feed owner's holidays: their location's (087) on each day, else the organization's.
        const holidaysMap = await holidaysFor(db, member.organization_id, fromDate, addDaysIso(toDate, 1), { userId: member.user_id }, wtSettings);

        for (const [date, h] of holidaysMap.entries()) {
          const holidayName = h.name ?? (h.key && HOLIDAY_NAMES[h.key] ? HOLIDAY_NAMES[h.key].de || HOLIDAY_NAMES[h.key].en : 'Public Holiday');
          events.push({
            uid: `holiday-${member.organization_id}-${date}@apensum`,
            summary: holidayName,
            description: `Public Holiday (${h.fraction < 1 ? `${Math.round(h.fraction * 100)}%` : 'Full day'})`,
            dateStart: date,
            dateEndExclusive: addDaysIso(date, 1),
            isTransparent: true,
          });
        }
      } catch {
        // Continue without holidays if parsing fails
      }
    }

    let calTitle = `Absences (${member.user_display_name || member.user_email})`;
    if (feed.scope === 'team') calTitle = `Team Absences (${member.org_name})`;
    if (feed.scope === 'all') calTitle = `All Absences (${member.org_name})`;

    const ics = buildIcsCalendar({
      calendarName: `Apensum - ${calTitle}`,
      events,
    });

    return {
      ics,
      filename: `apensum-absences-${feed.scope}.ics`,
    };
  }
}
