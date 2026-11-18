import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CalendarFeedService,
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
  toIcsDate,
  addDaysIso,
} from '../../apps/api/src/calendar-feed.service';
import { CalendarFeedController } from '../../apps/api/src/calendar-feed.controller';
import type { DbService } from '../../apps/api/src/db.service';

test('iCalendar escaping: escapes backslashes, semicolons, commas, and newlines', () => {
  const input = 'Vacation in Zurich, Switzerland; note: \\fun\\ \nEnjoy!';
  const escaped = escapeIcsText(input);
  assert.equal(escaped, 'Vacation in Zurich\\, Switzerland\\; note: \\\\fun\\\\ \\nEnjoy!');
});

test('iCalendar line folding: leaves short lines unchanged and folds lines > 75 chars', () => {
  const shortLine = 'SUMMARY:Quick meeting';
  assert.equal(foldIcsLine(shortLine), shortLine);

  const longLine = 'DESCRIPTION:This is an extremely long description that will definitely exceed the standard seventy-five character limit defined in RFC 5545 section 3.1.';
  const folded = foldIcsLine(longLine);
  assert.ok(folded.includes('\r\n '));
  const split = folded.split('\r\n');
  assert.ok(split[0].length <= 75);
  for (let i = 1; i < split.length; i++) {
    assert.ok(split[i].startsWith(' '));
    assert.ok(split[i].length <= 75);
  }
});

test('Date utilities: toIcsDate and addDaysIso calculate correct exclusive end dates', () => {
  assert.equal(toIcsDate('2026-07-10'), '20260710');
  // 1-day absence: end date is next day (exclusive)
  assert.equal(addDaysIso('2026-07-10', 1), '2026-07-11');
  assert.equal(toIcsDate(addDaysIso('2026-07-10', 1)), '20260711');
  // Month boundary
  assert.equal(addDaysIso('2026-02-28', 1), '2026-03-01');
  // Year boundary
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
});

test('buildIcsCalendar: generates compliant RFC 5545 output with CRLF line breaks', () => {
  const ics = buildIcsCalendar({
    calendarName: 'Apensum - Absences (Anna Muster)',
    events: [
      {
        uid: 'absence-123@apensum',
        summary: 'Vacation',
        description: 'Employee: Anna Muster\nType: Vacation\nStatus: Approved',
        dateStart: '2026-08-03',
        dateEndExclusive: '2026-08-08',
        isTransparent: false,
      },
      {
        uid: 'holiday-ch-2026-08-01@apensum',
        summary: 'Bundesfeiertag (1. August)',
        description: 'Public Holiday (Full day)',
        dateStart: '2026-08-01',
        dateEndExclusive: '2026-08-02',
        isTransparent: true,
      },
    ],
  });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('VERSION:2.0\r\n'));
  assert.ok(ics.includes('PRODID:-//Apensum//Absence Calendar//EN\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:Apensum - Absences (Anna Muster)\r\n'));
  assert.ok(ics.includes('UID:absence-123@apensum\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260803\r\n'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260808\r\n'));
  assert.ok(ics.includes('TRANSP:OPAQUE\r\n'));
  assert.ok(ics.includes('UID:holiday-ch-2026-08-01@apensum\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260801\r\n'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260802\r\n'));
  assert.ok(ics.includes('TRANSP:TRANSPARENT\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

function createMockDb(chainRows: any[][] = [], executeResult: { rows: any[] } = { rows: [] }) {
  let chainCallIndex = 0;
  function makeChain() {
    const rows = chainRows[chainCallIndex] ?? [];
    chainCallIndex++;
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
      set: () => chain,
      then: (resolve: (v: any) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }
  const db = {
    execute: async () => executeResult,
    select: () => makeChain(),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
  return {
    getDb: () => db as any,
  } as unknown as DbService;
}

test('CalendarFeedService: getFeedConfig returns null feed when not yet configured', async () => {
  const service = new CalendarFeedService();
  // Mock: directReportUserIds returns [] -> chainRows[0] for membership select returns {}
  const mockDb = createMockDb([
    [{ settings: {} }], // membership select
  ]);

  const result = await service.getFeedConfig(mockDb.getDb()!, 'org-1', 'user-1', 'https://api.example.com/api/v1');
  assert.equal(result.feed, null);
  assert.ok(result.allowedScopes.includes('personal'));
});

test('CalendarFeedService: updateFeedConfig generates token and returns feed URLs', async () => {
  const service = new CalendarFeedService();
  const mockDb = createMockDb([
    [{ id: 'mem-1', settings: {} }], // membership select
  ]);

  const result = await service.updateFeedConfig(
    mockDb.getDb()!,
    'org-1',
    'user-1',
    { scope: 'personal', includeHolidays: true },
    'https://api.example.com/api/v1',
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.feed.token.length >= 32);
    assert.equal(result.feed.scope, 'personal');
    assert.equal(result.feed.includeHolidays, true);
    assert.equal(result.feed.feedUrl, `https://api.example.com/api/v1/calendar/absences/${result.feed.token}.ics`);
    assert.equal(result.feed.webcalUrl, `webcal://api.example.com/api/v1/calendar/absences/${result.feed.token}.ics`);
  }
});

test('CalendarFeedService: generateIcsForToken produces VCALENDAR with approved absences and holidays', async () => {
  const service = new CalendarFeedService();
  const token = 'abcdef1234567890abcdef1234567890';
  const mockDb = createMockDb([
    // Call 1: membership with active token
    [
      {
        id: 'mem-1',
        organization_id: 'org-1',
        user_id: 'user-1',
        settings: {
          calendar_feed: {
            token,
            enabled: true,
            scope: 'personal',
            include_holidays: true,
            created_at: '2026-11-18T00:00:00Z',
          },
        },
        user_display_name: 'Fabio Rossi',
        user_email: 'fabio@example.com',
        org_name: 'Acme AG',
        org_settings: { holidayRegion: 'ZH' },
      },
    ],
    // Call 2: absences
    [
      {
        id: 'abs-1',
        user_id: 'user-1',
        date_start: '2026-07-13',
        date_end: '2026-07-17',
        absence_type: 'vacation',
        half_day: false,
        note: 'Summer holiday in Ticino',
        user_display_name: 'Fabio Rossi',
        user_email: 'fabio@example.com',
      },
    ],
    // Call 3: org_holidays
    [
      {
        id: 'hol-1',
        date: '2026-12-25',
        name: 'Weihnachten',
        fraction: 1,
        observed: true,
      },
    ],
  ]);

  const result = await service.generateIcsForToken(mockDb.getDb()!, token);
  assert.ok(result !== null);
  assert.equal(result.filename, 'apensum-absences-personal.ics');
  assert.ok(result.ics.includes('X-WR-CALNAME:Apensum - Absences (Fabio Rossi)\r\n'));
  assert.ok(result.ics.includes('SUMMARY:Vacation\r\n'));
  assert.ok(result.ics.includes('DTSTART;VALUE=DATE:20260713\r\n'));
  assert.ok(result.ics.includes('DTEND;VALUE=DATE:20260718\r\n')); // exclusive +1 day
  // Unfolded text contains the full note
  const unfoldedIcs = result.ics.replace(/\r\n /g, '');
  assert.ok(unfoldedIcs.includes('Summer holiday in Ticino'));
  assert.ok(unfoldedIcs.includes('Weihnachten'));
});

test('CalendarFeedService: generateIcsForToken returns null when token unknown or disabled', async () => {
  const service = new CalendarFeedService();
  const mockDb = createMockDb([
    [], // not found
  ]);

  const result = await service.generateIcsForToken(mockDb.getDb()!, '00000000000000000000000000000000');
  assert.equal(result, null);
});

test('CalendarFeedController: serveFeed sets text/calendar header and returns 200 or 404', async () => {
  const service = new CalendarFeedService();
  const token = '11223344556677889900aabbccddeeff';
  const mockDb = createMockDb([
    [
      {
        id: 'mem-1',
        organization_id: 'org-1',
        user_id: 'user-1',
        settings: {
          calendar_feed: { token, enabled: true, scope: 'personal' },
        },
        user_display_name: 'Fabio Rossi',
        user_email: 'fabio@example.com',
        org_name: 'Acme AG',
        org_settings: {},
      },
    ],
    [], // no absences
    [], // no org holidays
  ]);

  const controller = new CalendarFeedController(mockDb, service);

  const headersSet: Record<string, string> = {};
  let bodySent = '';
  let statusSent = 200;

  const mockRes: any = {
    set: (obj: Record<string, string>) => Object.assign(headersSet, obj),
    status: (code: number) => {
      statusSent = code;
      return mockRes;
    },
    send: (body: string) => {
      bodySent = body;
    },
  };

  await controller.serveFeed(`${token}.ics`, mockRes);
  assert.equal(statusSent, 200);
  assert.equal(headersSet['Content-Type'], 'text/calendar; charset=utf-8');
  assert.ok(headersSet['Cache-Control'].includes('no-cache'));
  assert.ok(bodySent.includes('BEGIN:VCALENDAR'));
});
