--liquibase formatted sql

-- Scheduled reports (Reports page): a saved report (064) that runs by itself, weekly on a weekday or
-- monthly on a day (1-28), at `hour` in `time_zone` (the owner's when it was set). `next_run_at` is
-- when it is due; the API's job runner (report-schedules.service.ts) claims a due row by moving
-- `next_run_at` on, so one instance runs it once. Each run makes one file per recipient, with that
-- recipient's own rights and language: a `report_runs` row with its `documents` row (encrypted at
-- rest like every document), listed on the recipient's Documents page. The e-mail only links to it.

--changeset worktime:065-report-schedules
CREATE TABLE report_schedules (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    saved_report_id       UUID         NOT NULL UNIQUE REFERENCES saved_reports(id) ON DELETE CASCADE,
    frequency             TEXT         NOT NULL,
    weekday               INTEGER,
    month_day             INTEGER,
    hour                  INTEGER      NOT NULL DEFAULT 6,
    time_zone             TEXT         NOT NULL,
    format                TEXT         NOT NULL DEFAULT 'pdf',
    recipient_user_ids    UUID[]       NOT NULL DEFAULT '{}',
    is_active             BOOLEAN      NOT NULL DEFAULT true,
    next_run_at           TIMESTAMPTZ  NOT NULL,
    last_run_at           TIMESTAMPTZ,
    CONSTRAINT chk_report_schedules_frequency CHECK (
        (frequency = 'weekly' AND weekday BETWEEN 1 AND 7) OR (frequency = 'monthly' AND month_day BETWEEN 1 AND 28)),
    CONSTRAINT chk_report_schedules_hour CHECK (hour BETWEEN 0 AND 23),
    CONSTRAINT chk_report_schedules_format CHECK (format IN ('pdf', 'xlsx'))
);
CREATE INDEX idx_report_schedules_due ON report_schedules (next_run_at) WHERE is_active;

CREATE TABLE report_runs (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    schedule_id           UUID         REFERENCES report_schedules(id) ON DELETE SET NULL,
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id           UUID         UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    title                 TEXT         NOT NULL,
    period_from           TEXT         NOT NULL,
    period_to             TEXT         NOT NULL,
    ran_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    error                 TEXT
);
CREATE INDEX idx_report_runs_user ON report_runs (organization_id, user_id, ran_at);
CREATE INDEX idx_report_runs_schedule ON report_runs (schedule_id, ran_at);
