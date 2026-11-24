--liquibase formatted sql

-- A property type for static data (packages/shared/src/staticData.ts): radio = at most one value of the list has it
-- (e.g. the default language of users/locales), stored as true on that value only.

--changeset worktime:102-static-data-radio
UPDATE static_data
SET "values" = "values" || '{"radio": "One value of the list"}'::jsonb,
    translation = COALESCE(translation, '{}'::jsonb) || jsonb_build_object(
      'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"radio": "Ein Wert der Liste"}'::jsonb,
      'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"radio": "Une valeur de la liste"}'::jsonb,
      'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"radio": "Un valore della lista"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'static_data' AND enum_name = 'property_type';
