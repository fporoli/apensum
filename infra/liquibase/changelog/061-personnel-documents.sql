--liquibase formatted sql

-- Personnel file (HR dossier): documents HR keeps for a person, e.g. performance reviews, bonus
-- letters, contracts, references. The file is a `documents` row (encrypted at rest like every
-- document). `visible_to_employee`: shared with the person (listed on their Documents page), else
-- HR only; HR can change it later. Managed with `section.people.documents` (062).

--changeset worktime:061-personnel-documents
CREATE TABLE personnel_documents (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id           UUID         NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    title                 TEXT         NOT NULL,
    category              TEXT         NOT NULL,
    document_date         DATE,
    visible_to_employee   BOOLEAN      NOT NULL DEFAULT false,
    uploaded_by_user_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_personnel_documents_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT chk_personnel_documents_category CHECK (category IN ('evaluation', 'bonus', 'contract', 'certificate', 'salary', 'other'))
);
CREATE INDEX idx_personnel_documents_user ON personnel_documents (organization_id, user_id);
