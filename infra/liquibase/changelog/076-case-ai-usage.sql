--liquibase formatted sql

--changeset worktime:076-case-ai-usage
-- One row per paid cloud AI call of the Cases module (Azure Speech / Azure OpenAI), never its content.
-- ai-budget.service.ts reserves the row (status 'pending', estimated_chf) before anything is sent,
-- under an advisory lock, so the instance budget and each organization's monthly limit hold even with
-- calls running in parallel; the row is finished with what the provider reported (actual_chf).
-- A month's spend counts COALESCE(actual_chf, estimated_chf), so a call that never finished counts in full.
-- The row outlives its case (billing record): case_id is set to NULL when the case is deleted.
CREATE TABLE cases.ai_usage (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID          REFERENCES users(id) ON DELETE SET NULL,
    case_id          UUID          REFERENCES cases.cases(id) ON DELETE SET NULL,
    kind             TEXT          NOT NULL,
    provider         TEXT          NOT NULL,
    status           TEXT          NOT NULL DEFAULT 'pending',
    error            TEXT,
    audio_seconds    NUMERIC(10, 1),
    input_tokens     INTEGER,
    output_tokens    INTEGER,
    estimated_chf    NUMERIC(10, 4) NOT NULL,
    actual_chf       NUMERIC(10, 4),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    CONSTRAINT chk_ai_usage_kind CHECK (kind IN ('transcribe', 'summarize', 'draft')),
    CONSTRAINT chk_ai_usage_status CHECK (status IN ('pending', 'ok', 'failed'))
);

CREATE INDEX idx_ai_usage_created ON cases.ai_usage (created_at);
CREATE INDEX idx_ai_usage_org_created ON cases.ai_usage (organization_id, created_at);
CREATE INDEX idx_ai_usage_user_created ON cases.ai_usage (user_id, created_at);
