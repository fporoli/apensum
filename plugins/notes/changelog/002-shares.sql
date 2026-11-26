--liquibase formatted sql

-- A note shared with colleagues (api/notes.controller.ts `share`, `mail`): the recipients are kept on the note itself,
-- `shared_with` (user ids), also everyone of a department as it is when the note is shared. They read it on their
-- Notes page ("shared with me"); the author sees with whom and takes it back; a recipient may hide it. An id of an
-- account deleted since simply finds no one. Who shared and when is in the core's versions.

--changeset notes:002-shared-with
ALTER TABLE notes.notes ADD COLUMN shared_with UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_notes_shared_with ON notes.notes USING gin (shared_with);
--rollback DROP INDEX notes.idx_notes_shared_with; ALTER TABLE notes.notes DROP COLUMN shared_with;
