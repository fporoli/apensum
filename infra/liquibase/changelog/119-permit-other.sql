--liquibase formatted sql

-- The residence permit list (118) gets "other" (e.g. a legitimation card of the FDFA): the HR plugin's work permits,
-- which knew it, now read and write the permit of My Data (users.basicdata residencePermitCode).

--changeset worktime:119-permit-other
UPDATE static_data SET
  "values" = "values" || '{"other": "Other"}'::jsonb,
  translation = jsonb_build_object(
    'en', COALESCE(translation -> 'en', '{}'::jsonb) || '{"other": "Other"}'::jsonb,
    'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"other": "Andere"}'::jsonb,
    'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"other": "Autre"}'::jsonb,
    'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"other": "Altro"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'users' AND enum_name = 'residence_permits' AND NOT jsonb_exists("values", 'other');
