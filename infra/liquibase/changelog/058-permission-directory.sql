--liquibase formatted sql

-- "Directory" navbar entry (packages/shared/src/permissions.ts, nav.directory): everyone sees every
-- active colleague's picture, name, e-mail, phone (basic data phone1), position and department, and
-- whether they are checked in right now. Only `all` exists; `edit:all` is catalogued but not granted
-- (the page edits nothing). Owner holds everything.

--changeset worktime:058-permission-directory
INSERT INTO permissions (id, description) VALUES
    ('nav.directory:see:all', 'nav.directory — see (all)'),
    ('nav.directory:edit:all', 'nav.directory — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.directory:see:all'
FROM roles r
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;
