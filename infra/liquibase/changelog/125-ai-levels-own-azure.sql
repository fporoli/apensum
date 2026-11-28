--liquibase formatted sql

-- AI levels and an organization's own Azure OpenAI resource (docs/dev/AI.md).
-- organization_ai_keys: the own resource's API key, sealed with the documents master key (DOCUMENTS_KEY,
-- document-crypto.ts sealSecret); never sent to a browser. The resource itself (endpoint, deployments, region)
-- is in organizations.settings.ai.own.
-- ai_usage.level: the level a chat call ran at (standard, advanced, max); NULL for older rows and transcription.

--changeset worktime:125-ai-levels-own-azure
CREATE TABLE organization_ai_keys (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    sealed_key      TEXT NOT NULL,
    key_id          TEXT NOT NULL
);
ALTER TABLE ai_usage ADD COLUMN level TEXT;
--rollback ALTER TABLE ai_usage DROP COLUMN level; DROP TABLE organization_ai_keys;
