--liquibase formatted sql

-- Three tables go.
-- work_time_balances and work_time_balance_entries (025) are the earlier balance ledger: 042 moved it into
-- work_time_months / balance_years, and nothing has read or written them since.
-- basicdata_versions was a second history next to versions: each person's "My data" entries (direct edits and change
-- requests with their status) are now the versions row of source_table 'basicdata' with the person's id
-- (basicdata.service.ts). The columns are the same; version_nr and history move as they are. Rows without any entry
-- (created on a first read) are not moved: the service now creates the row with its first entry.

--changeset worktime:116-unused-and-second-history
DROP TABLE work_time_balance_entries;
DROP TABLE work_time_balances;

INSERT INTO versions (source_table, source_table_uuid, version_nr, created, lastmodified, lastmodified_by_user_id, history)
SELECT 'basicdata', user_id, version_nr, created, lastmodified, lastmodified_by_user_id, history FROM basicdata_versions
WHERE jsonb_array_length(history) > 0 AND version_nr > 0
ON CONFLICT (source_table, source_table_uuid) DO NOTHING;
DROP TABLE basicdata_versions;
