--liquibase formatted sql

-- Operators edit the default static data (Super Admin -> Default lists, static-data-defaults.ts): they add values and
-- lists, change labels and translations, and change or remove what they added. operator_keys records the keys of a
-- global row that operators added; every other key of a global row came from a migration (built in: the code relies on
-- it) and stays as it is. Organizations' rows don't use it.

--changeset worktime:103-static-data-operator-keys
ALTER TABLE static_data ADD COLUMN operator_keys text[] NOT NULL DEFAULT '{}';
