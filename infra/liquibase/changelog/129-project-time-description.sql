--liquibase formatted sql

--changeset worktime:129-project-time-description
-- A project time entry's item text (Positionstext): on a customer project the customer sees it on the invoice's
-- hours report. The comment stays internal (the person, their manager, HR), as with expenses.
ALTER TABLE project_times ADD COLUMN description text;
COMMENT ON COLUMN project_times.description IS 'Item text: what a customer may see when the time is billed (invoice hours report). comment stays internal.';
--rollback ALTER TABLE project_times DROP COLUMN description;
