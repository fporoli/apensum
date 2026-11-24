--liquibase formatted sql

-- Requests of a type with a workflow (Admin settings -> Workflows, one per request type, shared/workflowConfig.ts)
-- go to the workflow's steps instead of a manager or a department: target_kind 'workflow', no department.

--changeset worktime:106-request-workflows
ALTER TABLE requests DROP CONSTRAINT chk_requests_target;
ALTER TABLE requests ADD CONSTRAINT chk_requests_target CHECK (
    (target_kind = 'manager' AND target_department_id IS NULL)
    OR (target_kind = 'department' AND target_department_id IS NOT NULL)
    OR (target_kind = 'workflow' AND target_department_id IS NULL));
