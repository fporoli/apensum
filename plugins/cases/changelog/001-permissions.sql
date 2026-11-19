--liquibase formatted sql

-- The plugin's permission object (package.json apensum.permissions: nav.cases, `own` = cases the
-- caller leads, `all` = every case of the organization) and its default grants on the global roles.
-- The core's changelogs 072/073 made these rows before Cases became a plugin, so on those databases
-- this inserts nothing; it makes the plugin's catalogue its own (test/changelog.test.mjs checks it).

--changeset cases:001-permissions
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
        ('hr', 'nav.cases:edit:all'),
        ('developer', 'nav.cases:edit:all'),
        ('member', 'nav.cases:edit:own'),
        ('billing_admin', 'nav.cases:edit:own')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
