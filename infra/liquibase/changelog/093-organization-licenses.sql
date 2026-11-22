--liquibase formatted sql

-- Licenses of paid modules: written by the operator's CLI only (apps/api/src/cli/operator.ts), read on
-- every permission check. Their own table, as organizations.settings is written by the organizations.

--changeset worktime:093-organization-licenses
CREATE TABLE organization_licenses (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    module_id       TEXT NOT NULL,
    valid_until     DATE,
    PRIMARY KEY (organization_id, module_id)
);
COMMENT ON TABLE organization_licenses IS 'Which organization may use which licensed module, through valid_until (inclusive, NULL = open-ended). Operator CLI only.';
