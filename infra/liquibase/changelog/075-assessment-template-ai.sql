--liquibase formatted sql

--changeset worktime:075-assessment-template-ai
-- Whether an assessment template allows an AI draft (cases.controller.ts `assessments/ai-draft`),
-- which sends the case's names, document texts and transcripts to the configured AI provider.
-- Off by default and on the read-only global templates; an organization turns it on in its own templates.
ALTER TABLE cases.assessment_templates
    ADD COLUMN ai_allowed BOOLEAN NOT NULL DEFAULT false;
