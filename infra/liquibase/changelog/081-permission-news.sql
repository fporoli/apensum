--liquibase formatted sql

-- "News" navbar entry (packages/shared/src/permissions.ts, nav.news; module "news"). `see:all`: read
-- the organization's news (every role but guest, often outside the company); `edit:all`: write, publish and delete posts and see who read
-- them (admin and HR). Who a post reaches is its audience (080), not this grant. Owner holds everything.

--changeset worktime:081-permission-news
INSERT INTO permissions (id, description) VALUES
    ('nav.news:see:all', 'nav.news — see (all)'),
    ('nav.news:edit:all', 'nav.news — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, CASE WHEN r.name IN ('admin', 'hr') THEN 'nav.news:edit:all' ELSE 'nav.news:see:all' END
FROM roles r
WHERE r.organization_id IS NULL AND r.name NOT IN ('owner', 'guest')
ON CONFLICT DO NOTHING;
