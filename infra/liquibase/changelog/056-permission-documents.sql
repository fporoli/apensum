--liquibase formatted sql

-- "Documents" navbar entry (packages/shared/src/permissions.ts, nav.documents): everyone sees the
-- documents that concern them, in one place: the PDFs of their approved timesheets, their absences'
-- and expenses' evidence and the attachments of their requests. Only `own` exists; owner holds it too.

-- `edit:own` exists for the catalogue but is not granted: nothing on the page is edited.

--changeset worktime:056-permission-documents
INSERT INTO permissions (id, description) VALUES
    ('nav.documents:see:own', 'nav.documents — see (own)'),
    ('nav.documents:edit:own', 'nav.documents — edit (own)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.documents:see:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name <> 'owner'
ON CONFLICT DO NOTHING;
