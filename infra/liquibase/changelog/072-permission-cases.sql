--liquibase formatted sql

-- Cases & Assessments navbar entry (packages/shared/src/permissions.ts, nav.cases):
-- Dossier management, interviews/transcripts and standardized assessments for KESB, forensic experts and police.
-- `own` = cases where lead_user_id is the caller; `all` = all cases in the organization.

--changeset worktime:072-permission-cases
INSERT INTO permissions (id, description) VALUES
    ('nav.cases:see:own', 'nav.cases — see (own)'),
    ('nav.cases:see:all', 'nav.cases — see (all)'),
    ('nav.cases:edit:own', 'nav.cases — edit (own)'),
    ('nav.cases:edit:all', 'nav.cases — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.cases:edit:all'),
        ('manager', 'nav.cases:edit:all'),
        ('hr', 'nav.cases:see:all'),
        ('user', 'nav.cases:edit:own')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
