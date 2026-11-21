--liquibase formatted sql

-- The organization's own fields on cases and assessments move from organizations.settings.cases.customFields
-- (edited in a section of Organization settings) to form templates (field_config, forms cases.case and
-- cases.assessment), edited in design mode on the Cases page like every other form. Keys stay, so stored
-- values keep their fields. The label becomes the caption in every language; a long text becomes a text of
-- three rows; a dropdown becomes a text field (templates have no own option lists) with its options as tooltip.

--changeset cases:006-custom-fields-to-templates
INSERT INTO field_config (organization_id, form_id, field_key, is_custom, config)
SELECT o.id,
       CASE f->>'target' WHEN 'assessment' THEN 'cases.assessment' ELSE 'cases.case' END,
       f->>'key',
       TRUE,
       jsonb_strip_nulls(jsonb_build_object(
         'type', CASE f->>'type' WHEN 'number' THEN 'number' WHEN 'date' THEN 'date' ELSE 'text' END,
         'caption', jsonb_build_object('en', f->>'label', 'de', f->>'label', 'fr', f->>'label', 'it', f->>'label'),
         'tooltip', CASE WHEN f->>'type' = 'select' THEN jsonb_build_object(
                      'en', 'Options: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(f->'options') x),
                      'de', 'Optionen: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(f->'options') x),
                      'fr', 'Options : ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(f->'options') x),
                      'it', 'Opzioni: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(f->'options') x)) END,
         'group', 'custom',
         'order', (t.ord * 10)::int,
         'width', CASE WHEN f->>'type' = 'longtext' THEN 'full' ELSE 'm' END,
         'newRow', CASE WHEN f->>'type' = 'longtext' THEN true END,
         'height', CASE WHEN f->>'type' = 'longtext' THEN 3 END))
FROM organizations o
CROSS JOIN LATERAL jsonb_array_elements(o.settings->'cases'->'customFields') WITH ORDINALITY AS t(f, ord)
WHERE jsonb_typeof(o.settings->'cases'->'customFields') = 'array'
  AND f->>'key' IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE organizations SET settings = settings #- '{cases,customFields}'
WHERE settings->'cases'->'customFields' IS NOT NULL;
