--liquibase formatted sql

-- The assistant's past questions per person and organization (assistant.controller.ts), so they can be
-- asked again the next day, and the ones starred as favourites. Only the person sees their own; a
-- question asked again moves up (last_used_at, use_count). Non-favourites beyond the newest 30 per
-- person and organization are dropped on each new question. The answers are not kept.

--changeset worktime:084-assistant-prompts
CREATE TABLE assistant_prompts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt          TEXT NOT NULL,
  is_favorite     BOOLEAN NOT NULL DEFAULT false,
  use_count       INTEGER NOT NULL DEFAULT 1,
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_assistant_prompts_length CHECK (char_length(prompt) BETWEEN 1 AND 2000),
  CONSTRAINT uq_assistant_prompts UNIQUE (organization_id, user_id, prompt)
);
CREATE INDEX idx_assistant_prompts_user ON assistant_prompts (organization_id, user_id, last_used_at DESC);
