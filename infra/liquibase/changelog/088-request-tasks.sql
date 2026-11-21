--liquibase formatted sql

-- Requests as tasks: a due date (an e-mail alert goes to the handlers once it has passed while the
-- request is still open, overdue_alerted_at), and requests the system opens for a module or plugin
-- (e.g. HR-Prozesse: "protection period ends"): no requester, `source` = the module or plugin id,
-- `source_key` = its own key (one request per key and organization), `source_section` = the page
-- of the web app that shows what it is about. System requests always go to a department.

--changeset worktime:088-request-tasks
ALTER TABLE requests ALTER COLUMN requester_user_id DROP NOT NULL;
ALTER TABLE requests
    ADD COLUMN due_date DATE,
    ADD COLUMN overdue_alerted_at TIMESTAMPTZ,
    ADD COLUMN source TEXT,
    ADD COLUMN source_key TEXT,
    ADD COLUMN source_section TEXT;
ALTER TABLE requests ADD CONSTRAINT chk_requests_requester_or_source
    CHECK (requester_user_id IS NOT NULL OR (source IS NOT NULL AND target_kind = 'department'));
CREATE UNIQUE INDEX uq_requests_source_key ON requests (organization_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX idx_requests_due ON requests (due_date) WHERE due_date IS NOT NULL AND overdue_alerted_at IS NULL;
