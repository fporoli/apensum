--liquibase formatted sql

-- Four roles, three rules (packages/shared/src/permissions.ts): owner decides who is owner, admin and HR
-- and what a role may do, and holds nothing else; admin runs the system; HR runs the people side,
-- departments and reporting lines included; a manager sees the line HR gave them.
-- Existing owners get admin and HR as roles of their own, so their work goes on: the organization's
-- copy of either role where it has one, else the default. Each grant is in the audit log.

--changeset worktime:092-owner-admin-hr
WITH owners AS (
    SELECT DISTINCT m.id AS membership_id, m.organization_id
    FROM organization_memberships m
    JOIN membership_roles mr ON mr.membership_id = m.id
    JOIN roles r ON r.id = mr.role_id
    WHERE r.name = 'owner'
), wanted AS (
    SELECT o.membership_id, o.organization_id, target.id AS role_id
    FROM owners o
    CROSS JOIN (VALUES ('admin'), ('hr')) AS n(name)
    CROSS JOIN LATERAL (
        SELECT r.id FROM roles r
        WHERE r.name = n.name AND (r.organization_id = o.organization_id OR r.organization_id IS NULL)
        ORDER BY r.organization_id NULLS LAST
        LIMIT 1
    ) target
), granted AS (
    INSERT INTO membership_roles (membership_id, role_id)
    SELECT membership_id, role_id FROM wanted
    ON CONFLICT DO NOTHING
    RETURNING membership_id, role_id
)
INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
SELECT m.organization_id, NULL, 'role.grant', 'membership', g.membership_id::text,
       jsonb_build_object('roleId', g.role_id, 'by', 'migration 092')
FROM granted g
JOIN organization_memberships m ON m.id = g.membership_id;

--changeset worktime:092-owner-description
UPDATE roles SET description = 'Responsible for the organization: decides who is owner, admin and HR and what roles may do'
WHERE name = 'owner' AND organization_id IS NULL AND description = 'Full organization owner and legal contact';

--changeset worktime:092-roles-admin
-- Admin, in the default and in organizations' copies: other people's data goes.
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id AND r.name = 'admin'
  AND split_part(rp.permission_id, ':', 3) IN ('team', 'reports', 'all')
  AND split_part(rp.permission_id, ':', 1) IN (
        'nav.time', 'nav.projectTimesheet', 'nav.timesheet', 'nav.workTime', 'nav.absences',
        'nav.balances', 'nav.approvals', 'nav.requests', 'nav.importExport', 'section.basicdata.personalien',
        'section.basicdata.address', 'section.basicdata.civilStatus', 'section.workTime.schedule', 'section.people.employment', 'section.people.documents')
  AND rp.permission_id NOT LIKE 'nav.approvals:%:reports';

--changeset worktime:092-roles-others
-- The roles an admin hands out never reach beyond a reporting line; invitations are the admin's.
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id AND r.organization_id IS NOT NULL AND r.name IN ('manager', 'member', 'guest', 'developer')
  AND (split_part(rp.permission_id, ':', 3) IN ('team', 'all') OR rp.permission_id LIKE 'section.people.documents:%:reports')
  AND split_part(rp.permission_id, ':', 1) IN (
        'nav.time', 'nav.projectTimesheet', 'nav.timesheet', 'nav.workTime', 'nav.absences',
        'nav.balances', 'nav.approvals', 'nav.requests', 'nav.importExport', 'section.basicdata.personalien',
        'section.basicdata.address', 'section.basicdata.civilStatus', 'section.workTime.schedule', 'section.people.employment', 'section.people.documents');
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id AND r.name = 'manager' AND rp.permission_id LIKE 'nav.invitations:%';
-- Only owners edit roles (OWNER_PERMISSIONS).
DELETE FROM role_permissions WHERE permission_id LIKE 'section.admin.roles:%';

--changeset worktime:092-roles-grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, g.permission_id
FROM (VALUES
        ('admin', 'nav.requests:edit:own'),
        ('admin', 'section.people.employment:see:own'),
        ('hr', 'nav.absences:edit:all'),
        ('hr', 'nav.approvals:edit:all')
     ) AS g(role_name, permission_id)
JOIN roles r ON r.name = g.role_name
ON CONFLICT DO NOTHING;

--changeset worktime:092-audit-contents
-- The audit log says that something happened, not what it says: admins read it.
UPDATE audit_logs SET metadata = metadata - 'fileName' WHERE action = 'absence.document.upload';
UPDATE audit_logs SET metadata = metadata - 'reason' WHERE action = 'timesheet.request-reopen';
UPDATE audit_logs SET metadata = metadata - 'note' WHERE (action LIKE 'workflow.%' OR action = 'basicdata.reject');
UPDATE audit_logs SET metadata = metadata - 'category' WHERE action = 'personnel-document.upload';
