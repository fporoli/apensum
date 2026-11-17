--liquibase formatted sql

-- "Reports" navbar entry (packages/shared/src/permissions.ts, nav.reports; module `reports`): the
-- Reports page with project hours, attendance and overtime, and absences. Every standard role may
-- open it; whose rows a report shows follows the matching page's grants (packages/shared/src/reports.ts),
-- so an employee sees their own figures and a manager their team's. Only `own` exists; `edit:own` is
-- catalogued for saved reports later and not granted yet. Owner holds everything.

--changeset worktime:063-permission-reports
INSERT INTO permissions (id, description) VALUES
    ('nav.reports:see:own', 'nav.reports — see (own)'),
    ('nav.reports:edit:own', 'nav.reports — edit (own)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.reports:see:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;
