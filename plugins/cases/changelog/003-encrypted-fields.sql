--liquibase formatted sql

-- Encrypted case data (shared/caseCrypto.ts, shared/caseVault.ts). A row is encrypted when `enc` holds an
-- envelope: the browser put its sensitive fields in it, and the plaintext columns hold '' / {} / NULL
-- (title, subject_name, transcript_text, interviewee_name are NOT NULL, so '' stays). What stays readable
-- on purpose, so lists, permissions and filters keep working: reference number, domain, status, lead,
-- confidentiality, interview role/date/duration, assessment status and template.
--
-- `custom` is where an organization's own fields live (organizations.settings.cases.customFields defines
-- them); on an encrypted row they travel inside `enc` and this column stays '{}'.

--changeset cases:003-encrypted-fields
ALTER TABLE cases.cases ADD COLUMN enc JSONB;
ALTER TABLE cases.cases ADD COLUMN custom JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cases.case_interviews ADD COLUMN enc JSONB;

ALTER TABLE cases.assessments ADD COLUMN enc JSONB;
ALTER TABLE cases.assessments ADD COLUMN custom JSONB NOT NULL DEFAULT '{}'::jsonb;
