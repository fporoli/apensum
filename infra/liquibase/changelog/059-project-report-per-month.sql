--liquibase formatted sql

-- Project reports cover the whole month: one PDF per person and month listing every project, each
-- with its own approval status, instead of one PDF per project (057). It is re-issued whenever one of
-- the month's projects is approved or reopened, so the current version is always complete; earlier
-- versions stay listed as superseded.
-- - `kind` says which report a row is; the working-time timesheet keeps its period id, a project
--   report is identified by person and month.
-- - PDFs issued per project before this are dropped (rows and `documents` rows; files are left on disk);
--   the month's report is issued again on the next approval or when Documents is opened.

--changeset worktime:059-project-report-per-month
ALTER TABLE timesheet_documents ADD COLUMN kind TEXT;
UPDATE timesheet_documents SET kind = CASE WHEN timesheet_period_id IS NOT NULL THEN 'timesheet' ELSE 'project_timesheet' END;
DELETE FROM documents WHERE id IN (SELECT document_id FROM timesheet_documents WHERE kind = 'project_timesheet');
DELETE FROM timesheet_documents WHERE kind = 'project_timesheet';
ALTER TABLE timesheet_documents ALTER COLUMN kind SET NOT NULL;

DROP INDEX uq_timesheet_documents_current_pt;
ALTER TABLE timesheet_documents DROP CONSTRAINT chk_timesheet_documents_period;
ALTER TABLE timesheet_documents DROP COLUMN project_time_period_id;

ALTER TABLE timesheet_documents ADD CONSTRAINT chk_timesheet_documents_kind CHECK (
    (kind = 'timesheet' AND timesheet_period_id IS NOT NULL)
    OR (kind = 'project_timesheet' AND timesheet_period_id IS NULL));
CREATE UNIQUE INDEX uq_timesheet_documents_current_project ON timesheet_documents (organization_id, user_id, period_start)
    WHERE superseded_at IS NULL AND kind = 'project_timesheet';
