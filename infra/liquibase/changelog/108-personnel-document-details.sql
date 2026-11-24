--liquibase formatted sql

-- Personnel file details (personnel-documents.controller.ts): a key date (Stichtag, e.g. a salary change's "valid
-- from"), a follow-up date (Wiedervorlage: HR's deadlines), sharing with the person's manager in force, and the
-- person's confirmation ("taken note") when HR asks for it. The categories become static data
-- (personnel/document_category) whose properties say what a category needs: a key date, the person's confirmation,
-- shared with the manager by default, a follow-up after some months. An organization copies the list to change it.

--changeset worktime:108-personnel-document-details
ALTER TABLE personnel_documents
  ADD COLUMN effective_date date,
  ADD COLUMN follow_up_date date,
  ADD COLUMN visible_to_manager boolean NOT NULL DEFAULT false,
  ADD COLUMN require_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN acknowledged_at timestamptz;

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'personnel', 'document_category',
  '{"evaluation": {"sort": "1", "acknowledge": true, "manager": true, "followUpMonths": "12"},
    "salary": {"sort": "2", "keyDate": true, "acknowledge": true},
    "bonus": {"sort": "3", "keyDate": true, "acknowledge": true},
    "contract": {"sort": "4", "keyDate": true, "acknowledge": true},
    "certificate": {"sort": "5"},
    "other": {"sort": "6"}}'::jsonb,
  '{"en": {"evaluation": "Performance review", "salary": "Salary", "bonus": "Bonus", "contract": "Contract", "certificate": "Reference / certificate", "other": "Other"},
    "de": {"evaluation": "Mitarbeiterbeurteilung", "salary": "Lohn", "bonus": "Bonus", "contract": "Vertrag", "certificate": "Zeugnis / Bestätigung", "other": "Anderes"},
    "fr": {"evaluation": "Évaluation", "salary": "Salaire", "bonus": "Bonus", "contract": "Contrat", "certificate": "Certificat / attestation", "other": "Autre"},
    "it": {"evaluation": "Valutazione", "salary": "Salario", "bonus": "Bonus", "contract": "Contratto", "certificate": "Certificato / attestazione", "other": "Altro"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'personnel' AND enum_name = 'document_category');

UPDATE static_data
SET "values" = "values" || '{"personnel.document_category.keyDate": {"type": "checkbox", "sort": "1"},
                             "personnel.document_category.acknowledge": {"type": "checkbox", "sort": "2"},
                             "personnel.document_category.manager": {"type": "checkbox", "sort": "3"},
                             "personnel.document_category.followUpMonths": {"type": "text", "pattern": "[0-9]{1,2}", "sort": "4"}}'::jsonb,
    translation = COALESCE(translation, '{}'::jsonb) || jsonb_build_object(
      'en', COALESCE(translation -> 'en', '{}'::jsonb) || '{"personnel.document_category.keyDate": "Key date required", "personnel.document_category.acknowledge": "Person confirms", "personnel.document_category.manager": "Shared with the manager", "personnel.document_category.followUpMonths": "Follow-up after months"}'::jsonb,
      'de', COALESCE(translation -> 'de', '{}'::jsonb) || '{"personnel.document_category.keyDate": "Stichtag nötig", "personnel.document_category.acknowledge": "Person bestätigt", "personnel.document_category.manager": "Für Vorgesetzte sichtbar", "personnel.document_category.followUpMonths": "Wiedervorlage nach Monaten"}'::jsonb,
      'fr', COALESCE(translation -> 'fr', '{}'::jsonb) || '{"personnel.document_category.keyDate": "Date de référence requise", "personnel.document_category.acknowledge": "La personne confirme", "personnel.document_category.manager": "Visible pour le supérieur", "personnel.document_category.followUpMonths": "Rappel après mois"}'::jsonb,
      'it', COALESCE(translation -> 'it', '{}'::jsonb) || '{"personnel.document_category.keyDate": "Data di riferimento richiesta", "personnel.document_category.acknowledge": "La persona conferma", "personnel.document_category.manager": "Visibile al superiore", "personnel.document_category.followUpMonths": "Promemoria dopo mesi"}'::jsonb)
WHERE organization_id IS NULL AND entity = 'static_data' AND enum_name = 'properties';
