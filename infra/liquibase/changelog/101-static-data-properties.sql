--liquibase formatted sql

-- Static data properties as static data (packages/shared/src/staticData.ts): the global list static_data/properties
-- describes, per list, the properties its values carry ("<entity>.<list>.<property>": type, the list a choice is
-- from, a pattern, a checkbox's default, the order); their labels are its translations. Admin settings -> static data
-- shows a control for each. The list describes its own fields too, so the same editor edits it. The core's and the
-- plugins' properties come from migrations (global, read-only); an organization adds its own in its copy, and the
-- global ones always stay. static_data/property_type lists the types.

--changeset worktime:101-static-data-properties
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'static_data', 'property_type',
  '{"checkbox": "Checkbox", "select": "Choice from a list", "text": "Text"}'::jsonb,
  '{"de": {"checkbox": "Kontrollkästchen", "select": "Auswahl aus einer Liste", "text": "Text"},
    "fr": {"checkbox": "Case à cocher", "select": "Choix dans une liste", "text": "Texte"},
    "it": {"checkbox": "Casella di controllo", "select": "Scelta da una lista", "text": "Testo"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'static_data' AND enum_name = 'property_type');

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'static_data', 'properties',
  '{"static_data.properties.type": {"type": "select", "list": "static_data.property_type", "sort": "1"},
    "static_data.properties.list": {"type": "text", "pattern": "[a-z0-9_]+\\.[a-z0-9_]+", "sort": "2"},
    "static_data.properties.pattern": {"type": "text", "sort": "3"},
    "static_data.properties.default": {"type": "checkbox", "sort": "4"},
    "static_data.properties.sort": {"type": "text", "pattern": "[0-9]{1,3}", "sort": "5"},
    "absences.absence_type.approval": {"type": "checkbox", "default": true, "sort": "1"},
    "absences.absence_type.unpaid": {"type": "checkbox", "sort": "2"},
    "requests.request_type.confidential": {"type": "checkbox"}}'::jsonb,
  '{"en": {"static_data.properties.type": "Type", "static_data.properties.list": "Choices from list (area.list)",
           "static_data.properties.pattern": "Allowed text (pattern)", "static_data.properties.default": "Checked by default",
           "static_data.properties.sort": "Order", "absences.absence_type.approval": "Needs approval",
           "absences.absence_type.unpaid": "unpaid", "requests.request_type.confidential": "Confidential"},
    "de": {"static_data.properties.type": "Art", "static_data.properties.list": "Auswahl aus Liste (Bereich.Liste)",
           "static_data.properties.pattern": "Erlaubter Text (Muster)", "static_data.properties.default": "Standardmässig angekreuzt",
           "static_data.properties.sort": "Reihenfolge", "absences.absence_type.approval": "Braucht Genehmigung",
           "absences.absence_type.unpaid": "unbezahlt", "requests.request_type.confidential": "Vertraulich"},
    "fr": {"static_data.properties.type": "Type", "static_data.properties.list": "Choix dans la liste (domaine.liste)",
           "static_data.properties.pattern": "Texte permis (modèle)", "static_data.properties.default": "Coché par défaut",
           "static_data.properties.sort": "Ordre", "absences.absence_type.approval": "Approbation requise",
           "absences.absence_type.unpaid": "non payé", "requests.request_type.confidential": "Confidentielle"},
    "it": {"static_data.properties.type": "Tipo", "static_data.properties.list": "Scelta dalla lista (ambito.lista)",
           "static_data.properties.pattern": "Testo ammesso (modello)", "static_data.properties.default": "Selezionata per default",
           "static_data.properties.sort": "Ordine", "absences.absence_type.approval": "Richiede approvazione",
           "absences.absence_type.unpaid": "non retribuito", "requests.request_type.confidential": "Confidenziale"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'static_data' AND enum_name = 'properties');
