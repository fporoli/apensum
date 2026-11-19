--liquibase formatted sql

-- Encrypted case documents: the browser seals the file itself (the stored file is ciphertext, named
-- generically) and the document's title, text and file details go into `enc`. `category` stays readable.

--changeset cases:004-encrypted-documents
ALTER TABLE cases.case_documents ADD COLUMN enc JSONB;
