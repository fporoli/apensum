--liquibase formatted sql

-- Others' expenses are HR's and finance's (billing_admin), no longer the admin's.

--changeset expenses:003-role-scopes
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id
  AND (r.name = 'admin' OR (r.organization_id IS NOT NULL AND r.name IN ('manager', 'member', 'guest', 'developer')))
  AND (rp.permission_id LIKE 'nav.expense%:%:all' OR rp.permission_id LIKE 'nav.expense%:%:team');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('hr', 'nav.expenseProcessing:edit:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name
ON CONFLICT DO NOTHING;
