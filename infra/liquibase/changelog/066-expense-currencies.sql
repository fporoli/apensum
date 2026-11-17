--liquibase formatted sql

-- Currencies an expense may be booked in (expense form, organization default currency): a global
-- static_data row (entity "expenses", enum "currency", key = ISO 4217 code, value = English name,
-- names in de/fr/it under `translation`). An org that needs others gets its own copy of the row in
-- Admin settings, as with every dropdown. Expenses already stored keep their currency.

--changeset worktime:066-expense-currencies
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'expenses', 'currency',
  '{"CHF":"Swiss franc","EUR":"Euro","USD":"US dollar","GBP":"British pound"}'::jsonb,
  '{"de":{"CHF":"Schweizer Franken","EUR":"Euro","USD":"US-Dollar","GBP":"Britisches Pfund"},
    "fr":{"CHF":"Franc suisse","EUR":"Euro","USD":"Dollar américain","GBP":"Livre sterling"},
    "it":{"CHF":"Franco svizzero","EUR":"Euro","USD":"Dollaro statunitense","GBP":"Sterlina britannica"}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'expenses' AND enum_name = 'currency'
);
