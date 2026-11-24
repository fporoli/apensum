--liquibase formatted sql

-- "Calendar" navbar entry (packages/shared/src/permissions.ts, nav.calendar; web TeamView.tsx TeamCalendar): the
-- absences and vacations of one's people per day. Who appears follows `nav.absences` (HR everyone, a manager the
-- line below), this grant only shows the page: HR `see:all`, manager `see:reports`, organizations' copies of those
-- roles too (a new object, nothing to keep). Read only, no `edit` is used.

--changeset worktime:109-permission-calendar
INSERT INTO permissions (id, description) VALUES
    ('nav.calendar:see:team', 'nav.calendar — see (team)'),
    ('nav.calendar:edit:team', 'nav.calendar — edit (team)'),
    ('nav.calendar:see:reports', 'nav.calendar — see (reports)'),
    ('nav.calendar:edit:reports', 'nav.calendar — edit (reports)'),
    ('nav.calendar:see:all', 'nav.calendar — see (all)'),
    ('nav.calendar:edit:all', 'nav.calendar — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, CASE r.name WHEN 'hr' THEN 'nav.calendar:see:all' ELSE 'nav.calendar:see:reports' END
FROM roles r
WHERE r.name IN ('hr', 'manager')
ON CONFLICT DO NOTHING;
