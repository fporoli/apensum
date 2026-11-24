--liquibase formatted sql

--changeset worktime:107-workflows-organization
-- Each workflow names its organization (before, it came from its source record through per-table
-- resolvers). Its definition always belongs to one, so the backfill is exact.
ALTER TABLE workflows ADD COLUMN organization_id uuid;
UPDATE workflows w SET organization_id = d.organization_id
FROM workflow_definitions d WHERE d.workflow_def_id = w.workflow_def_id;
ALTER TABLE workflows ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE workflows ADD CONSTRAINT workflows_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX idx_workflows_org ON workflows (organization_id, step_status);
