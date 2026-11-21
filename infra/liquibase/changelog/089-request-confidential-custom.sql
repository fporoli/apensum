--liquibase formatted sql

-- Confidential requests and the organization's own fields on requests.
-- A request type marked confidential (static_data requests/request_type, attribute {"confidential": true})
-- makes its requests confidential: only the requester and the handlers worked out per call (the manager,
-- or the department's members and leader) see them, not `nav.requests:edit:all`; notifications carry no
-- text, and neither "Send by e-mail" nor the AI assistant touch them. The flag is copied onto the
-- request when it is sent and when its type changes (`confidential`). `custom` holds the values of the
-- configurable form `request` (fields defined in design mode on the Requests page).
-- The global types get "hr" (HR matter), confidential; organizations with their own copy keep theirs.

--changeset worktime:089-request-confidential-custom
ALTER TABLE requests
    ADD COLUMN confidential BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN custom JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE static_data
SET "values" = "values" || '{"hr": {"sort": 4, "confidential": true}}'::jsonb,
    translation = jsonb_build_object(
      'en', COALESCE(translation -> 'en', '{}'::jsonb) || '{"hr": "HR matter (confidential)"}'::jsonb,
      'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"hr": "HR-Anliegen (vertraulich)"}'::jsonb,
      'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"hr": "Question RH (confidentielle)"}'::jsonb,
      'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"hr": "Questione HR (confidenziale)"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'requests' AND enum_name = 'request_type' AND ("values" -> 'hr') IS NULL;
