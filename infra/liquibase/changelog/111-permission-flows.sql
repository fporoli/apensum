--liquibase formatted sql

-- The permission object nav.requests is nav.flows (110-flows.sql: requests are flows), with every role's grants, the
-- global roles' and organizations' copies alike. Same ids, scopes and descriptions as 053 under the new name.

--changeset worktime:111-permission-flows
INSERT INTO permissions (id, description) VALUES
    ('nav.flows:see:own', 'nav.flows — see (own)'),
    ('nav.flows:see:all', 'nav.flows — see (all)'),
    ('nav.flows:edit:own', 'nav.flows — edit (own)'),
    ('nav.flows:edit:all', 'nav.flows — edit (all)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, replace(permission_id, 'nav.requests:', 'nav.flows:') FROM role_permissions WHERE permission_id LIKE 'nav.requests:%'
ON CONFLICT DO NOTHING;
DELETE FROM role_permissions WHERE permission_id LIKE 'nav.requests:%';
DELETE FROM permissions WHERE id LIKE 'nav.requests:%';
--rollback SELECT 1;
