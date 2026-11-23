--liquibase formatted sql

-- The instance's operators (formerly "superdevelopers") are the active members of one fixed
-- organization, "Apensum Admin" (id below, OPERATOR_ORG_ID in packages/shared/src/operator.ts).
-- In it they hold the Super Admin pages only (licenses, product news, superusers; access.ts gives
-- nothing else there), and nobody becomes a member through invitations, roles or registration:
-- only operator_grant, called by the operator CLI, the Superusers page and the seed.
-- The organization is made by the first grant (it needs a creator).

--changeset worktime:098-operator-functions splitStatements:false
CREATE FUNCTION operator_grant(p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  added boolean;
BEGIN
  INSERT INTO organizations (id, slug, name, type, created_by_user_id, settings)
  VALUES ('00000000-0000-0000-0000-00000000a0a0', '_operators', 'Apensum Admin', 'enterprise', p_user,
          '{"modules": {"requests": false, "reports": false, "news": false, "expenses": false, "cases": false, "hr": false}}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO organization_memberships (organization_id, user_id, status)
  VALUES ('00000000-0000-0000-0000-00000000a0a0', p_user, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active' WHERE organization_memberships.status <> 'active'
  RETURNING true INTO added;
  RETURN coalesce(added, false);
END
$$;

CREATE FUNCTION operator_revoke(p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  removed boolean;
BEGIN
  DELETE FROM organization_memberships
  WHERE organization_id = '00000000-0000-0000-0000-00000000a0a0' AND user_id = p_user
  RETURNING true INTO removed;
  RETURN coalesce(removed, false);
END
$$;
--rollback DROP FUNCTION operator_revoke(uuid); DROP FUNCTION operator_grant(uuid);

--changeset worktime:098-operator-members
-- Whoever was superdeveloper becomes an operator; then the flag goes.
SELECT operator_grant(id) FROM (SELECT id FROM users WHERE is_superdeveloper ORDER BY email) s;
ALTER TABLE users DROP COLUMN is_superdeveloper;
