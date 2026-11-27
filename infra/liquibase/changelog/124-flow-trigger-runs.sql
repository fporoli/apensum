--liquibase formatted sql

-- The runs of the Auslöser (TriggersService.run): when, who started it (NULL: the hourly job), how many flows it opened,
-- brought up to date and resolved, and per trigger (`details`: trigger id, event, the counts, an error code). Numbers
-- and codes only, never whom a flow is about. Shown in the Auslöser tab ("Letzte Läufe"); runs that changed nothing are
-- kept two days, the others 90 days.

--changeset worktime:124-flow-trigger-runs
CREATE TABLE flow_trigger_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ran_at          TIMESTAMPTZ NOT NULL,
    by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    opened          INTEGER NOT NULL DEFAULT 0,
    updated         INTEGER NOT NULL DEFAULT 0,
    closed          INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    details         JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX idx_flow_trigger_runs_org ON flow_trigger_runs (organization_id, ran_at DESC);
--rollback DROP TABLE flow_trigger_runs;
