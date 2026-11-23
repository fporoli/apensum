--liquibase formatted sql

-- Flat-rate expenses (Pauschalspesen): the allowance types every organization can use, without
-- amounts. An organization sets its own amounts (from its expense regulations) in Organization
-- settings -> Expenses, kept in its own copy of this row: values = {type: {validFrom: amount}}.
-- A type without an amount is not offered.

--changeset expenses:006-allowances
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'expenses', 'allowance',
  '{"breakfast": {}, "lunch": {}, "dinner": {}, "overnight": {}, "day_half": {}, "day_full": {}}'::jsonb,
  '{"en": {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "overnight": "Overnight stay", "day_half": "Half day away", "day_full": "Full day away"},
    "de": {"breakfast": "Frühstück", "lunch": "Mittagessen", "dinner": "Abendessen", "overnight": "Übernachtung", "day_half": "Halber Tag auswärts", "day_full": "Ganzer Tag auswärts"},
    "fr": {"breakfast": "Petit-déjeuner", "lunch": "Repas de midi", "dinner": "Repas du soir", "overnight": "Nuitée", "day_half": "Demi-journée à l''extérieur", "day_full": "Journée entière à l''extérieur"},
    "it": {"breakfast": "Colazione", "lunch": "Pranzo", "dinner": "Cena", "overnight": "Pernottamento", "day_half": "Mezza giornata fuori sede", "day_full": "Giornata intera fuori sede"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'expenses' AND enum_name = 'allowance');
