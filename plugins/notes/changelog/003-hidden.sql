--liquibase formatted sql

-- A recipient hides a note shared with them (api/notes.controller.ts `hidden`): they stay on `shared_with`, so they
-- can show it again ("Show hidden" on their Notes page); `hidden_by` holds who hid it. The author taking a share
-- back takes the person off both.

--changeset notes:003-hidden-by
ALTER TABLE notes.notes ADD COLUMN hidden_by UUID[] NOT NULL DEFAULT '{}';
--rollback ALTER TABLE notes.notes DROP COLUMN hidden_by;
