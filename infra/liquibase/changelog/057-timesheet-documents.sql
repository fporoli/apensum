--liquibase formatted sql

--changeset worktime:057-timesheet-documents
-- The PDF frozen when a month is approved: the working-time timesheet (timesheet_period_id) or one
-- project's month (project_time_period_id). Reopening the month sets superseded_at; the next
-- approval adds a new row. The file itself is a `documents` row.
CREATE TABLE timesheet_documents (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id         UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id                 UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id             UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    timesheet_period_id     UUID         REFERENCES timesheet_periods(id) ON DELETE CASCADE,
    project_time_period_id  UUID         REFERENCES project_time_periods(id) ON DELETE CASCADE,
    period_start            DATE         NOT NULL,
    issued_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    superseded_at           TIMESTAMPTZ,
    CONSTRAINT chk_timesheet_documents_period CHECK (
        (timesheet_period_id IS NULL) <> (project_time_period_id IS NULL))
);
CREATE INDEX idx_timesheet_documents_user ON timesheet_documents (organization_id, user_id);
CREATE UNIQUE INDEX uq_timesheet_documents_current_ts ON timesheet_documents (timesheet_period_id) WHERE superseded_at IS NULL AND timesheet_period_id IS NOT NULL;
CREATE UNIQUE INDEX uq_timesheet_documents_current_pt ON timesheet_documents (project_time_period_id) WHERE superseded_at IS NULL AND project_time_period_id IS NOT NULL;
