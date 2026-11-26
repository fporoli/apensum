--liquibase formatted sql

-- What a static data list is for (Admin settings -> static data, Super Admin -> Default lists): a text per language
-- ({"de": ..., "fr": ..., "it": ..., "en": ...}, `cleanDescription` in packages/shared/src/staticData.ts). The core's
-- lists for all organizations get theirs here, a plugin's lists in its own changelog; an organization's copy shows
-- the one of the list it copies until it writes its own.

--changeset worktime:112-static-data-description-column
ALTER TABLE static_data ADD COLUMN description JSONB NOT NULL DEFAULT '{}'::jsonb;

--changeset worktime:112-static-data-description-core
UPDATE static_data SET description = d.description::jsonb
FROM (VALUES
  ('absences', 'absence_type', '{
    "de": "Die Absenzarten, die man beantragen oder erfassen kann. Pro Art: ob sie eine Genehmigung braucht (Krankheit und Unfall nicht) und ob sie unbezahlt ist (zählt für Lohnexport und Ferienkürzung).",
    "fr": "Les types d''absence que l''on peut demander ou saisir. Pour chacun : s''il faut une approbation (pas pour maladie et accident) et s''il est non payé (export des salaires, réduction des vacances).",
    "it": "I tipi di assenza che si possono richiedere o registrare. Per ciascuno: se richiede un''approvazione (non malattia e infortunio) e se non è retribuito (export salari, riduzione delle vacanze).",
    "en": "The absence types people request or record. Per type: whether it needs approval (sickness and accident do not) and whether it is unpaid (payroll export, vacation cut)."}'),
  ('expenses', 'currency', '{
    "de": "Die Währungen, in denen Spesen erfasst werden können. Umgerechnet wird mit den Wechselkursen der Organisation.",
    "fr": "Les devises dans lesquelles on peut saisir des frais. La conversion utilise les taux de change de l''organisation.",
    "it": "Le valute in cui si possono registrare le spese. La conversione usa i tassi di cambio dell''organizzazione.",
    "en": "The currencies expenses can be entered in. They are converted with the organization''s exchange rates."}'),
  ('flows', 'flow_type', '{
    "de": "Die Arten von Flows auf der Seite Flows (Service, Support, HR …). Pro Art: Reihenfolge und ob sie vertraulich ist (nur die Person und die Bearbeitenden sehen sie). Die Schritte einer Art legt der Flow-Designer fest.",
    "fr": "Les types de flows de la page Flows (service, support, RH …). Pour chacun : l''ordre et s''il est confidentiel (visible seulement par la personne et ceux qui le traitent). Les étapes d''un type se définissent dans le Flow-Designer.",
    "it": "I tipi di flow della pagina Flows (servizio, supporto, HR …). Per ciascuno: l''ordine e se è confidenziale (lo vedono solo la persona e chi lo tratta). I passi di un tipo si definiscono nel Flow-Designer.",
    "en": "The flow types on the Flows page (service, support, HR …). Per type: its order and whether it is confidential (only the person and its handlers see it). A type''s steps are set in the Flow-Designer."}'),
  ('login', 'demo_accounts', '{
    "de": "Die Demo-Konten, die die Anmeldeseite zur Auswahl anbietet (nur auf Demo-Instanzen).",
    "fr": "Les comptes de démonstration proposés sur la page de connexion (instances de démo seulement).",
    "it": "Gli account demo proposti nella pagina di accesso (solo istanze demo).",
    "en": "The demo accounts the login page offers to pick (demo instances only)."}'),
  ('personnel', 'document_category', '{
    "de": "Die Kategorien im Personaldossier. Pro Kategorie: ob ein Stichtag nötig ist, ob die Person bestätigen soll, ob die vorgesetzte Person das Dokument sieht und nach wie vielen Monaten es zur Wiedervorlage kommt.",
    "fr": "Les catégories du dossier du personnel. Pour chacune : date de référence obligatoire, confirmation par la personne, visible par le supérieur et rappel après combien de mois.",
    "it": "Le categorie del dossier del personale. Per ciascuna: data di riferimento obbligatoria, conferma della persona, visibile al superiore e promemoria dopo quanti mesi.",
    "en": "The personnel file''s categories. Per category: whether a key date is required, whether the person confirms it, whether the manager sees it, and after how many months it comes up again."}'),
  ('static_data', 'properties', '{
    "de": "Beschreibt, welche Eigenschaften die Werte anderer Listen haben (z. B. «Genehmigung» bei den Absenzarten) und wie sie bearbeitet werden. Eine Änderung hier ändert, wie andere Listen bearbeitet werden.",
    "fr": "Décrit les propriétés des valeurs des autres listes (p. ex. « approbation » des types d''absence) et comment on les modifie. Un changement ici change la façon de modifier d''autres listes.",
    "it": "Descrive le proprietà dei valori delle altre liste (p. es. «approvazione» dei tipi di assenza) e come si modificano. Una modifica qui cambia come si modificano altre liste.",
    "en": "Describes which properties the values of other lists have (e.g. «approval» on absence types) and how they are edited. Changing it changes how other lists are edited."}'),
  ('static_data', 'property_type', '{
    "de": "Die Arten von Eigenschaften (Kontrollkästchen, ein Wert der Liste, Auswahl, Text), die die Liste der Eigenschaften verwendet.",
    "fr": "Les sortes de propriétés (case à cocher, une valeur de la liste, choix, texte) qu''utilise la liste des propriétés.",
    "it": "I tipi di proprietà (casella, un valore della lista, scelta, testo) usati dalla lista delle proprietà.",
    "en": "The kinds of properties (checkbox, one value of the list, choice, text) the list of properties uses."}'),
  ('users', 'countries', '{
    "de": "Die Länder zur Auswahl in den Personalien (Adresse, Nationalität).",
    "fr": "Les pays proposés dans les données personnelles (adresse, nationalité).",
    "it": "I paesi proposti nei dati personali (indirizzo, nazionalità).",
    "en": "The countries to choose from in personal details (address, nationality)."}'),
  ('users', 'locales', '{
    "de": "Die Sprachen zur Auswahl in den Personalien (Sprachcode).",
    "fr": "Les langues proposées dans les données personnelles (code de langue).",
    "it": "Le lingue proposte nei dati personali (codice lingua).",
    "en": "The languages to choose from in personal details (language code)."}')
) AS d(entity, enum_name, description)
WHERE static_data.organization_id IS NULL AND static_data.entity = d.entity AND static_data.enum_name = d.enum_name;
