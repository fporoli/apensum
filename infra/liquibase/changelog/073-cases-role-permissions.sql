--liquibase formatted sql

-- Give cases permissions to all roles (member, hr, admin, manager, developer, billing_admin)
-- across all global and organization-scoped roles.
-- In 072, 'user' was used instead of 'member', and hr was only given see:all.

--changeset worktime:073-cases-role-permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM roles r
JOIN (VALUES
        ('admin', 'nav.cases:edit:all'),
        ('manager', 'nav.cases:edit:all'),
        ('hr', 'nav.cases:edit:all'),
        ('member', 'nav.cases:edit:own'),
        ('developer', 'nav.cases:edit:all'),
        ('billing_admin', 'nav.cases:edit:own')
     ) AS g(role_name, permission_id) ON g.role_name = r.name
ON CONFLICT DO NOTHING;
