--liquibase formatted sql

-- Customers in the core (docs/dev/FEATURES.md "Customers"): whom an organization works for, called Kunde, Auftraggeber
-- or Mandant as it chooses (organizations.settings.customers.term), with its address and contact people. A project
-- names its customer, the customer's reference (e.g. an authority's file number) and the contact person it goes to
-- ("z. H."); a subproject (e.g. one case) may have a reference and contact of its own. Plugins build on it (billing
-- invoices them, its changelog 004 moves its former customers here with their ids).
-- Its permission is 128.

--changeset worktime:127-customers
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 70),
    street          TEXT CHECK (street IS NULL OR char_length(street) <= 70),
    house_number    TEXT CHECK (house_number IS NULL OR char_length(house_number) <= 16),
    zip             TEXT CHECK (zip IS NULL OR char_length(zip) <= 16),
    city            TEXT CHECK (city IS NULL OR char_length(city) <= 35),
    country         CHAR(2) NOT NULL DEFAULT 'CH',
    email           TEXT CHECK (email IS NULL OR char_length(email) <= 200),
    phone           TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
    -- The language of what goes to the customer (an invoice, a letter).
    language        TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'fr', 'it', 'en')),
    active          BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_customers_org ON customers (organization_id, lower(name));

CREATE TABLE customer_contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 70),
    role            TEXT CHECK (role IS NULL OR char_length(role) <= 70),
    email           TEXT CHECK (email IS NULL OR char_length(email) <= 200),
    phone           TEXT CHECK (phone IS NULL OR char_length(phone) <= 40),
    sort            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_customer_contacts_customer ON customer_contacts (customer_id, sort);

ALTER TABLE projects
    ADD COLUMN customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
    ADD COLUMN customer_reference  TEXT CHECK (customer_reference IS NULL OR char_length(customer_reference) <= 70),
    ADD COLUMN customer_contact_id UUID REFERENCES customer_contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_customer ON projects (customer_id);

ALTER TABLE subprojects
    ADD COLUMN customer_reference  TEXT CHECK (customer_reference IS NULL OR char_length(customer_reference) <= 70),
    ADD COLUMN customer_contact_id UUID REFERENCES customer_contacts(id) ON DELETE SET NULL;

--rollback ALTER TABLE subprojects DROP COLUMN customer_contact_id, DROP COLUMN customer_reference; ALTER TABLE projects DROP COLUMN customer_contact_id, DROP COLUMN customer_reference, DROP COLUMN customer_id; DROP TABLE customer_contacts; DROP TABLE customers;
