--liquibase formatted sql

-- The Team hours page is gone: project hours per person are on the project time page's Team tab and,
-- by team, in Reports (project hours, filter "Team"); the assistant's team tool checks `nav.time`.
-- Its permission object `nav.teamHours` leaves the catalogue with every grant on it, organizations'
-- own roles included.

--changeset worktime:091-remove-team-hours
DELETE FROM role_permissions WHERE permission_id LIKE 'nav.teamHours:%';
DELETE FROM permissions WHERE id LIKE 'nav.teamHours:%';
