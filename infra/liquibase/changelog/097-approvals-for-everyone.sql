--liquibase formatted sql

-- Workflow for everyone: members see their own requests there (what they submitted and where it
-- stands). Deciding stays with whoever a request is assigned to.

--changeset worktime:097-approvals-for-everyone
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.approvals:see:own'
FROM roles r
WHERE r.name = 'member'
ON CONFLICT DO NOTHING;
