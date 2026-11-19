--liquibase formatted sql

-- The plugin's permission objects (package.json apensum.permissions) and their default grants on
-- the global roles. The expense tables and these rows came with the core's changelogs (035, 037,
-- 049) before expenses became a plugin, so on those databases this inserts nothing; it makes the
-- plugin's catalogue its own (test/changelog.test.mjs checks it against the manifest).

--changeset expenses:001-permissions
INSERT INTO permissions (id, description)
SELECT o.object || ':' || a.action || ':' || s.scope, o.object || ' — ' || a.action || ' (' || s.scope || ')'
FROM (VALUES ('nav.expenses', 'people'), ('nav.expenseReports', 'people'), ('nav.expenseProcessing', 'org')) AS o(object, kind)
CROSS JOIN (VALUES ('see'), ('edit')) AS a(action)
JOIN (VALUES ('people', 'own'), ('people', 'team'), ('people', 'reports'), ('people', 'all'), ('org', 'all')) AS s(kind, scope)
  ON s.kind = o.kind
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.expenses:edit:own'), ('admin', 'nav.expenses:see:all'),
        ('admin', 'nav.expenseReports:edit:own'), ('admin', 'nav.expenseReports:see:all'),
        ('admin', 'nav.expenseProcessing:edit:all'),
        ('billing_admin', 'nav.expenses:edit:own'), ('billing_admin', 'nav.expenseReports:edit:own'),
        ('billing_admin', 'nav.expenseProcessing:edit:all'),
        ('hr', 'nav.expenses:edit:own'), ('hr', 'nav.expenses:see:all'),
        ('hr', 'nav.expenseReports:edit:own'), ('hr', 'nav.expenseReports:see:all'),
        ('manager', 'nav.expenses:edit:own'), ('manager', 'nav.expenseReports:edit:own'),
        ('member', 'nav.expenses:edit:own'), ('member', 'nav.expenseReports:edit:own'),
        ('developer', 'nav.expenses:edit:own'), ('developer', 'nav.expenseReports:edit:own'),
        ('guest', 'nav.expenses:edit:own'), ('guest', 'nav.expenseReports:edit:own')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
