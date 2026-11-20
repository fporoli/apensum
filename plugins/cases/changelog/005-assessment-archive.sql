--liquibase formatted sql

-- Assessments are archived instead of deleted: an archived one leaves the case's list (it can be shown
-- and restored) but stays complete, as a record of what was drafted or signed. Readable like `status`.

--changeset cases:005-assessment-archive
ALTER TABLE cases.assessments ADD COLUMN archived_at TIMESTAMPTZ;
