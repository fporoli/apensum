--liquibase formatted sql

-- Parental leave: the global absence types get maternity leave (14 weeks, EO) and paternity leave
-- (2 weeks within 6 months of the birth). Organizations with their own copy of the list keep theirs
-- and may add them there (Admin settings -> static data).

--changeset worktime:090-parental-leave
UPDATE static_data
SET "values" = "values" || '{"maternity": {}, "paternity": {}}'::jsonb,
    translation = jsonb_build_object(
      'en', COALESCE(translation -> 'en', '{}'::jsonb) || '{"maternity": "Maternity leave", "paternity": "Paternity leave"}'::jsonb,
      'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"maternity": "Mutterschaftsurlaub", "paternity": "Vaterschaftsurlaub"}'::jsonb,
      'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"maternity": "Congé de maternité", "paternity": "Congé de paternité"}'::jsonb,
      'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"maternity": "Congedo di maternità", "paternity": "Congedo di paternità"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'absences' AND enum_name = 'absence_type' AND ("values" -> 'maternity') IS NULL;
