--liquibase formatted sql

-- Cases on everyone stay HR's: admin, manager and developer work on the cases they lead.

--changeset cases:007-role-scopes
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id AND r.name IN ('admin', 'manager', 'developer')
  AND (rp.permission_id LIKE 'nav.cases:%:all' OR rp.permission_id LIKE 'nav.cases:%:team');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.cases:edit:own'),
        ('manager', 'nav.cases:edit:own'),
        ('developer', 'nav.cases:edit:own')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name
ON CONFLICT DO NOTHING;
