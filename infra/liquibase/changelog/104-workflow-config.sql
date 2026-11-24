--liquibase formatted sql

-- Configurable workflows (packages/shared/src/workflowConfig.ts): an organization's own arrangement of a kind's
-- building blocks (which steps, who decides, when a step applies, what rejecting does) in its workflow definition,
-- null = the kind's default from the code. Each workflow keeps the steps it started with, so a later change of the
-- configuration never changes a running one (null = older workflows: their definition's steps).

--changeset worktime:104-workflow-config
ALTER TABLE workflow_definitions ADD COLUMN config jsonb;
ALTER TABLE workflows ADD COLUMN steps jsonb;
