--liquibase formatted sql

-- Team hours (nav.teamHours): a manager sees the hours of their own reports, not of everyone.
-- The Team hours page and the assistant's get_team_hours now filter a team's members by the
-- caller's scope (listableUserIds), so the global manager role moves from `see:all` to
-- `see:reports`. Admin keeps `see:all`; HR gets `see:all` (second changeset). An org's own role copies are left as the org set them.

--changeset worktime:055-permission-team-hours-reports
DELETE FROM role_permissions
WHERE permission_id = 'nav.teamHours:see:all'
  AND role_id IN (SELECT id FROM roles WHERE name = 'manager' AND organization_id IS NULL);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.teamHours:see:reports'
FROM roles r
WHERE r.name = 'manager' AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;

--changeset worktime:055-permission-team-hours-hr
-- HR sees everyone's team hours (and gets the Team hours navbar entry).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.teamHours:see:all'
FROM roles r
WHERE r.name = 'hr' AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
