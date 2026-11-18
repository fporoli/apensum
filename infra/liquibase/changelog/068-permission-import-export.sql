--liquibase formatted sql

-- "Import / Export" navbar entry (packages/shared/src/permissions.ts, nav.importExport):
-- Export payroll data for Abacus, Bexio and spreadsheet summaries, and bulk import employees.
-- Admin and HR roles get edit:all; owner holds everything.

--changeset worktime:068-permission-import-export
INSERT INTO permissions (id, description) VALUES
    ('nav.importExport:see:all', 'nav.importExport — see (all)'),
    ('nav.importExport:edit:all', 'nav.importExport — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.importExport:edit:all'),
        ('hr', 'nav.importExport:edit:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
