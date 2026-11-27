--liquibase formatted sql

-- Whom a flow is about (the requester for a flow someone starts, the person for a task a module opens, e.g. an
-- anniversary), and the values a task brings for the e-mail templates of its steps ({{date}}, {{years}}).

--changeset worktime:121-flow-about
ALTER TABLE flows ADD COLUMN about_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE flows ADD COLUMN task_data JSONB;
UPDATE flows SET about_user_id = requester_user_id WHERE requester_user_id IS NOT NULL;
--rollback ALTER TABLE flows DROP COLUMN task_data; ALTER TABLE flows DROP COLUMN about_user_id;
