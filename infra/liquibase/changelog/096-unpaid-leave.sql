--liquibase formatted sql

-- Unpaid leave: the global absence types get `unpaid_leave`, marked `{"unpaid": true}`. Types with
-- that attribute are the payroll export's unpaid hours and cut the vacation entitlement by a twelfth
-- per full month (Art. 329b para. 1 CO). Organizations with their own copy of the list keep theirs
-- and may add the type or mark their own there (Admin settings -> static data, "unpaid").

--changeset worktime:096-unpaid-leave
UPDATE static_data
SET "values" = "values" || '{"unpaid_leave": {"unpaid": true}}'::jsonb,
    translation = jsonb_build_object(
      'en', COALESCE(translation -> 'en', '{}'::jsonb) || '{"unpaid_leave": "Unpaid leave"}'::jsonb,
      'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"unpaid_leave": "Unbezahlter Urlaub"}'::jsonb,
      'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"unpaid_leave": "Congé non payé"}'::jsonb,
      'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"unpaid_leave": "Congedo non retribuito"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'absences' AND enum_name = 'absence_type' AND ("values" -> 'unpaid_leave') IS NULL;
