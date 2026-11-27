--liquibase formatted sql

-- Auslöser (flow triggers, Admin settings -> Workflows -> Auslöser): an organization's rules for flows opened by an
-- event (a residence permit ending, an anniversary of a plugin's HR data, ...), `lead_days` before it. Each opens one
-- flow per occurrence (source 'trigger', source_key 'trigger:<id>:<occurrence>'): through a flow type's steps, or as a
-- Free Flow to a department, to the manager of the person it is about, or to that person (target_kind 'person').

--changeset worktime:123-flow-triggers
CREATE TABLE flow_triggers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event           TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    lead_days       INTEGER NOT NULL DEFAULT 14,
    flow_type       TEXT,
    target          TEXT NOT NULL DEFAULT 'department',
    department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
    confidential    BOOLEAN NOT NULL DEFAULT TRUE,
    label           TEXT,
    CONSTRAINT chk_flow_triggers_target CHECK (target IN ('department', 'manager', 'person')),
    CONSTRAINT chk_flow_triggers_lead CHECK (lead_days BETWEEN 0 AND 365),
    CONSTRAINT chk_flow_triggers_label CHECK (label IS NULL OR char_length(label) <= 100)
);
CREATE INDEX idx_flow_triggers_org ON flow_triggers (organization_id);

-- A flow may go to one person (the one it is about); a system task may go to the manager of the person it is about.
ALTER TABLE flows DROP CONSTRAINT chk_flows_target;
ALTER TABLE flows ADD CONSTRAINT chk_flows_target CHECK (
    (target_kind = 'manager' AND target_department_id IS NULL)
    OR (target_kind = 'department' AND target_department_id IS NOT NULL)
    OR (target_kind = 'workflow' AND target_department_id IS NULL)
    OR (target_kind = 'person' AND target_department_id IS NULL AND about_user_id IS NOT NULL));
ALTER TABLE flows DROP CONSTRAINT chk_flows_requester_or_source;
ALTER TABLE flows ADD CONSTRAINT chk_flows_requester_or_source CHECK (
    requester_user_id IS NOT NULL
    OR (source IS NOT NULL AND (target_kind IN ('department', 'workflow') OR (target_kind IN ('manager', 'person') AND about_user_id IS NOT NULL))));
--rollback DROP TABLE flow_triggers;
--rollback ALTER TABLE flows DROP CONSTRAINT chk_flows_target; ALTER TABLE flows ADD CONSTRAINT chk_flows_target CHECK ((target_kind = 'manager' AND target_department_id IS NULL) OR (target_kind = 'department' AND target_department_id IS NOT NULL) OR (target_kind = 'workflow' AND target_department_id IS NULL));
--rollback ALTER TABLE flows DROP CONSTRAINT chk_flows_requester_or_source; ALTER TABLE flows ADD CONSTRAINT chk_flows_requester_or_source CHECK (requester_user_id IS NOT NULL OR (source IS NOT NULL AND target_kind IN ('department', 'workflow')));
