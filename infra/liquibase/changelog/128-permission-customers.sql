--liquibase formatted sql

-- The Customers page (packages/shared/src/permissions.ts, nav.customers; customers.controller.ts, 127): editing is
-- admin's and billing_admin's, managers see them (they pick a project's customer in Projects & Teams, which also
-- lets whoever edits projects see them). Owner holds everything.

--changeset worktime:128-permission-customers
INSERT INTO permissions (id, description) VALUES
    ('nav.customers:see:all', 'nav.customers — see (all)'),
    ('nav.customers:edit:all', 'nav.customers — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.customers:edit:all'),
        ('billing_admin', 'nav.customers:edit:all'),
        ('manager', 'nav.customers:see:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name
ON CONFLICT DO NOTHING;
--rollback DELETE FROM role_permissions WHERE permission_id IN ('nav.customers:see:all', 'nav.customers:edit:all'); DELETE FROM permissions WHERE id IN ('nav.customers:see:all', 'nav.customers:edit:all');
