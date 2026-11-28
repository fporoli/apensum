--liquibase formatted sql

-- The last four characters of an organization's own Azure key, plain, so the settings can show which key is stored
-- ("…a1B2") without opening it. The key itself stays sealed (sealed_key).

--changeset worktime:126-ai-key-hint
ALTER TABLE organization_ai_keys ADD COLUMN key_hint TEXT;
--rollback ALTER TABLE organization_ai_keys DROP COLUMN key_hint;
