--liquibase formatted sql

-- Requests (the "requests" module, packages/shared/src/modules.ts): a ticket a person sends to
-- their line manager or to a department (HR, ...), with a message thread.
-- - target_kind 'manager': handled by the requester's manager in force (employee_assignments),
--   so it follows a manager change like the approvals do; nothing stores the manager.
-- - target_kind 'department': every person whose assignment in force is in that department, and
--   its leader, may see, take, answer, resolve and archive it.
-- - status: open -> in_progress (a handler took it or answered) -> resolved; archived_at hides it
--   from the inboxes (the requester still finds it under archived).
-- opened_at / last_activity_at / posted_at are part of the record (shown, sorted by), not audit
-- timestamps; history goes to versions as everywhere else.

--changeset worktime:052-requests
CREATE TABLE requests (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requester_user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_kind           TEXT         NOT NULL,
    target_department_id  UUID         REFERENCES departments(id) ON DELETE RESTRICT,
    subject               TEXT         NOT NULL,
    status                TEXT         NOT NULL DEFAULT 'open',
    assignee_user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
    opened_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_activity_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    archived_at           TIMESTAMPTZ,
    CONSTRAINT chk_requests_target CHECK (
        (target_kind = 'manager' AND target_department_id IS NULL)
        OR (target_kind = 'department' AND target_department_id IS NOT NULL)),
    CONSTRAINT chk_requests_status CHECK (status IN ('open', 'in_progress', 'resolved')),
    CONSTRAINT chk_requests_subject CHECK (length(btrim(subject)) > 0)
);
CREATE INDEX idx_requests_requester ON requests (organization_id, requester_user_id);
CREATE INDEX idx_requests_department ON requests (organization_id, target_department_id);

--changeset worktime:052-request-messages
-- kind 'message': text by the requester or a handler. 'event': a status change, take-over or
-- archive, with `data` ({ "status": ..., "archived": ... }) and no body.
CREATE TABLE request_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id      UUID         NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    author_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    kind            TEXT         NOT NULL DEFAULT 'message',
    body            TEXT,
    data            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    posted_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_request_messages_kind CHECK (kind IN ('message', 'event')),
    CONSTRAINT chk_request_messages_body CHECK (kind <> 'message' OR length(btrim(coalesce(body, ''))) > 0)
);
CREATE INDEX idx_request_messages_request ON request_messages (request_id, posted_at);
