--liquibase formatted sql

-- Default exchange rates for every organization: rows with organization_id NULL, like the global
-- static_data rows (read-only for everyone, they come only from changesets). An organization that
-- keeps its own rates for a currency uses only those for it (expense-booking.ts). A new year's
-- defaults are a new changeset with the new valid_from.

--changeset expenses:002-default-exchange-rates
ALTER TABLE exchange_rates ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE exchange_rates DROP CONSTRAINT uq_exchange_rates;
ALTER TABLE exchange_rates ADD CONSTRAINT uq_exchange_rates UNIQUE NULLS NOT DISTINCT (organization_id, currency, target_currency, valid_from);
INSERT INTO exchange_rates (organization_id, currency, target_currency, valid_from, rate) VALUES
  (NULL, 'EUR', 'CHF', DATE '2026-01-01', 0.94),
  (NULL, 'USD', 'CHF', DATE '2026-01-01', 0.88),
  (NULL, 'GBP', 'CHF', DATE '2026-01-01', 1.13)
ON CONFLICT DO NOTHING;
--rollback DELETE FROM exchange_rates WHERE organization_id IS NULL; ALTER TABLE exchange_rates DROP CONSTRAINT uq_exchange_rates; ALTER TABLE exchange_rates ADD CONSTRAINT uq_exchange_rates UNIQUE (organization_id, currency, target_currency, valid_from); ALTER TABLE exchange_rates ALTER COLUMN organization_id SET NOT NULL;
