--liquibase formatted sql

--changeset worktime:074-case-interview-revisions
ALTER TABLE cases.case_interviews
    ADD COLUMN revision UUID NOT NULL DEFAULT uuid_generate_v4(),
    ADD COLUMN transcript_stale BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN summary_stale BOOLEAN NOT NULL DEFAULT false;
