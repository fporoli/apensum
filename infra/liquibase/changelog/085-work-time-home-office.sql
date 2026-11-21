--liquibase formatted sql

-- A working-time session can be marked as home office (set by the person on check-in or in the entry, default not).
-- client_ip is the address the session was last written from: stored for later questions, never shown or returned by
-- the API, and not part of the session's version history.

--changeset worktime:085-work-time-home-office
ALTER TABLE work_times ADD COLUMN home_office BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE work_times ADD COLUMN client_ip VARCHAR(64);
