--liquibase formatted sql

--changeset worktime:077-exchange-rates
-- Exchange rates an organization keeps by hand, with history (Organization settings -> Exchange rates):
-- 1 unit of `currency` = `rate` units of `target_currency` (the org's reporting currency when entered),
-- valid from `valid_from` until the next row of the same pair. An expense booked in another currency
-- takes the rate in force on its date (expenses.controller.ts) and keeps it in expenses.exchange_rate,
-- so later edits of this table never change booked expenses.
CREATE TABLE exchange_rates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    currency         CHAR(3)       NOT NULL,
    target_currency  CHAR(3)       NOT NULL,
    valid_from       DATE          NOT NULL,
    rate             NUMERIC(18, 8) NOT NULL,
    CONSTRAINT chk_exchange_rates_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_exchange_rates_target CHECK (target_currency ~ '^[A-Z]{3}$' AND target_currency <> currency),
    CONSTRAINT chk_exchange_rates_rate CHECK (rate > 0),
    CONSTRAINT uq_exchange_rates UNIQUE (organization_id, currency, target_currency, valid_from)
);

--changeset worktime:077-expense-conversion-columns
-- What an expense was booked with: the exchange rate (receipt currency -> reporting currency) or, for a
-- mileage expense (category 'mileage', quantity = km), the rate per km. NULL = entered directly in the
-- reporting currency, or an older expense in another currency that was never converted.
ALTER TABLE expenses
    ADD COLUMN exchange_rate NUMERIC(18, 8),
    ADD COLUMN unit_rate NUMERIC(10, 4),
    ADD CONSTRAINT chk_expenses_exchange_rate CHECK (exchange_rate IS NULL OR exchange_rate > 0),
    ADD CONSTRAINT chk_expenses_unit_rate CHECK (unit_rate IS NULL OR unit_rate > 0);

--changeset worktime:077-mileage-rate
-- Rate per km for mileage expenses, in the org's reporting currency: key = valid from (YYYY-MM-DD),
-- value = rate. The global row is the default for all organizations; an org copies it in Admin
-- settings and adds its own dates/rates, like every dropdown.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'expenses', 'mileage_rate', '{"2000-01-01": "0.70"}'::jsonb, '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'expenses' AND enum_name = 'mileage_rate'
);

--changeset worktime:077-ai-usage-receipt
-- Receipt recognition on the expense form goes through the same AI budget as Cases.
ALTER TABLE cases.ai_usage DROP CONSTRAINT chk_ai_usage_kind;
ALTER TABLE cases.ai_usage ADD CONSTRAINT chk_ai_usage_kind CHECK (kind IN ('transcribe', 'summarize', 'draft', 'receipt'));
