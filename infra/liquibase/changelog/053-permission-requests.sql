--liquibase formatted sql

-- "Requests" navbar entry (packages/shared/src/permissions.ts, nav.requests; module "requests").
-- `edit:own`: send requests and follow one's own. Handling a request needs no grant: it comes
-- from being the requester's manager or in the target department. `edit:all` (admin) also
-- handles every request of the organization. Owner holds everything.

--changeset worktime:053-permission-requests
INSERT INTO permissions (id, description) VALUES
    ('nav.requests:see:own', 'nav.requests — see (own)'),
    ('nav.requests:see:all', 'nav.requests — see (all)'),
    ('nav.requests:edit:own', 'nav.requests — edit (own)'),
    ('nav.requests:edit:all', 'nav.requests — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM roles r
JOIN (VALUES
        ('admin', 'nav.requests:edit:all'),
        ('hr', 'nav.requests:edit:own'),
        ('manager', 'nav.requests:edit:own'),
        ('member', 'nav.requests:edit:own'),
        ('guest', 'nav.requests:see:own'),
        ('billing_admin', 'nav.requests:edit:own'),
        ('developer', 'nav.requests:edit:own')
     ) AS g(role_name, permission_id) ON g.role_name = r.name
ON CONFLICT DO NOTHING;
