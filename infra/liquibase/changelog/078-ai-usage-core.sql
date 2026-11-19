--liquibase formatted sql

--changeset worktime:078-ai-usage-core
-- Paid cloud AI calls are a core concern (ai-budget.service.ts): Cases, the expenses plugin's receipt
-- recognition and any later plugin reserve through the same budget. The table moves from
-- cases.ai_usage (076) to public.ai_usage, keeping every row. The case a call was about becomes a
-- generic subject (subject_table + subject_id, no foreign key: the row outlives what it was about,
-- as before), and kind is any lowercase name, so a plugin adds kinds without a schema change.
CREATE TABLE public.ai_usage (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID          REFERENCES users(id) ON DELETE SET NULL,
    subject_table    TEXT,
    subject_id       UUID,
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
    CONSTRAINT chk_ai_usage_kind CHECK (kind ~ '^[a-z][a-z0-9_.-]*$'),
    CONSTRAINT chk_ai_usage_status CHECK (status IN ('pending', 'ok', 'failed')),
    CONSTRAINT chk_ai_usage_subject CHECK ((subject_table IS NULL) = (subject_id IS NULL))
);

INSERT INTO public.ai_usage (id, organization_id, user_id, subject_table, subject_id, kind, provider, status, error,
                             audio_seconds, input_tokens, output_tokens, estimated_chf, actual_chf, created_at, finished_at)
SELECT id, organization_id, user_id, CASE WHEN case_id IS NULL THEN NULL ELSE 'cases.cases' END, case_id, kind, provider, status, error,
       audio_seconds, input_tokens, output_tokens, estimated_chf, actual_chf, created_at, finished_at
FROM cases.ai_usage;

DROP TABLE cases.ai_usage;

CREATE INDEX idx_ai_usage_created ON public.ai_usage (created_at);
CREATE INDEX idx_ai_usage_org_created ON public.ai_usage (organization_id, created_at);
CREATE INDEX idx_ai_usage_user_created ON public.ai_usage (user_id, created_at);

-- The organization's monthly AI limit is not a Cases setting either:
-- settings.cases.ai.monthlyLimitChf -> settings.ai.monthlyLimitChf. The Cases providers stay in cases.ai.
UPDATE organizations
SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}',
                         COALESCE(settings -> 'ai', '{}'::jsonb) || jsonb_build_object('monthlyLimitChf', settings -> 'cases' -> 'ai' -> 'monthlyLimitChf'))
               #- '{cases,ai,monthlyLimitChf}'
WHERE jsonb_exists(settings -> 'cases' -> 'ai', 'monthlyLimitChf');
