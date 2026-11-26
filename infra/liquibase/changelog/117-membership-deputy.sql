--liquibase formatted sql

-- A person's deputy in an organization: while the person is away (an approved absence covering the day), the steps of
-- flows waiting for them go to the deputy as well (workflow-dues.service.ts). Set by the person or by HR; the deputy
-- is a member of the same organization and never the person.

--changeset worktime:117-membership-deputy
ALTER TABLE organization_memberships
  ADD COLUMN deputy_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_membership_deputy_not_self CHECK (deputy_user_id IS NULL OR deputy_user_id <> user_id);
--rollback ALTER TABLE organization_memberships DROP CONSTRAINT chk_membership_deputy_not_self, DROP COLUMN deputy_user_id;
