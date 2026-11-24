--liquibase formatted sql

-- Codes of departments and teams (lower-case letters, digits and -, unique per organization): a readable name for them
-- in configurable workflows (`department:frontdesk`, `team:it-support`). Existing ones get one made from their name.

--changeset worktime:105-unit-codes splitStatements:false
ALTER TABLE departments ADD COLUMN code text;
ALTER TABLE teams ADD COLUMN code text;

WITH base AS (
  SELECT id, organization_id,
         COALESCE(NULLIF(left(trim(both '-' from regexp_replace(lower(translate(name, 'äöüàâéèêëîïôùûçÄÖÜ', 'aouaaeeeeiiouucaou')), '[^a-z0-9]+', '-', 'g')), 40), ''), 'department') AS slug
  FROM departments
), numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY organization_id, slug ORDER BY id) AS n FROM base
)
UPDATE departments d SET code = CASE WHEN n.n = 1 THEN n.slug ELSE left(n.slug, 36) || '-' || n.n END
FROM numbered n WHERE n.id = d.id;

WITH base AS (
  SELECT id, organization_id,
         COALESCE(NULLIF(left(trim(both '-' from regexp_replace(lower(translate(name, 'äöüàâéèêëîïôùûçÄÖÜ', 'aouaaeeeeiiouucaou')), '[^a-z0-9]+', '-', 'g')), 40), ''), 'team') AS slug
  FROM teams
), numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY organization_id, slug ORDER BY id) AS n FROM base
)
UPDATE teams t SET code = CASE WHEN n.n = 1 THEN n.slug ELSE left(n.slug, 36) || '-' || n.n END
FROM numbered n WHERE n.id = t.id;

CREATE UNIQUE INDEX departments_org_code_key ON departments (organization_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX teams_org_code_key ON teams (organization_id, code) WHERE code IS NOT NULL;
