--liquibase formatted sql

-- A task a module opens may go through its flow type's steps (target `workflow`) instead of to a department.

--changeset worktime:122-flow-task-steps
ALTER TABLE flows DROP CONSTRAINT chk_flows_requester_or_source;
ALTER TABLE flows ADD CONSTRAINT chk_flows_requester_or_source
  CHECK (requester_user_id IS NOT NULL OR (source IS NOT NULL AND target_kind IN ('department', 'workflow')));
--rollback ALTER TABLE flows DROP CONSTRAINT chk_flows_requester_or_source; ALTER TABLE flows ADD CONSTRAINT chk_flows_requester_or_source CHECK (requester_user_id IS NOT NULL OR (source IS NOT NULL AND target_kind = 'department'));
