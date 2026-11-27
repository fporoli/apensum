--liquibase formatted sql

-- An urgent Free Flow nobody has taken reminds everyone who handles it, once (FlowsService.alertUrgentUntaken): when
-- that reminder went out.

--changeset worktime:120-flow-urgent-alert
ALTER TABLE flows ADD COLUMN urgent_alerted_at TIMESTAMPTZ;
--rollback ALTER TABLE flows DROP COLUMN urgent_alerted_at;
