--liquibase formatted sql

-- Exchange rates are the core's (exchange-rates.ts, Organization settings), usable by every module; the expenses
-- plugin books with them. Its changeset 002 had made organization_id nullable for the defaults of every
-- organization and inserted them; an instance without that plugin gets the same here (on one with it, this
-- changes nothing). A new year's defaults are a new core changeset with the new valid_from.

--changeset worktime:100-exchange-rates
ALTER TABLE exchange_rates ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE exchange_rates DROP CONSTRAINT IF EXISTS uq_exchange_rates;
ALTER TABLE exchange_rates ADD CONSTRAINT uq_exchange_rates UNIQUE NULLS NOT DISTINCT (organization_id, currency, target_currency, valid_from);
INSERT INTO exchange_rates (organization_id, currency, target_currency, valid_from, rate) VALUES
  (NULL, 'EUR', 'CHF', DATE '2026-01-01', 0.94),
  (NULL, 'USD', 'CHF', DATE '2026-01-01', 0.88),
  (NULL, 'GBP', 'CHF', DATE '2026-01-01', 1.13)
ON CONFLICT DO NOTHING;
