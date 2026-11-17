--liquibase formatted sql

-- Saved reports (Reports page, nav.reports): a report with its period, grouping and filters under a
-- name. `settings` is packages/shared/src/reports.ts `SavedReportSettings` (a preset period moves with
-- time). The owner sees and changes it; `shared_roles` are role names (not ids, so an organization's
-- own copy of a role still matches) whose members see it too. Whoever opens a report runs it with
-- their own rights, so sharing a report never shares data. Sharing needs `nav.reports:edit:own`,
-- granted here to admin, hr and manager.

--changeset worktime:064-saved-reports
CREATE TABLE saved_reports (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id   UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT         NOT NULL,
    report_id         TEXT         NOT NULL,
    settings          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    shared_roles      TEXT[]       NOT NULL DEFAULT '{}',
    CONSTRAINT chk_saved_reports_name CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE INDEX idx_saved_reports_org ON saved_reports (organization_id, owner_user_id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.reports:edit:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name IN ('admin', 'hr', 'manager')
ON CONFLICT DO NOTHING;
