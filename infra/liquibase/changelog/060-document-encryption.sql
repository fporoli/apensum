--liquibase formatted sql

-- Documents are encrypted at rest (apps/api/src/document-crypto.ts): each file with its own key
-- (AES-256-GCM), that key wrapped with the master key DOCUMENTS_KEY from the environment, which is
-- never stored in the database or next to the files. A row without `encrypted_key` is a plain file
-- (stored before encryption, or while no DOCUMENTS_KEY was configured); `npm run db:encrypt-documents`
-- encrypts those. `key_id` names the master key that wrapped it, for key rotation.

--changeset worktime:060-document-encryption
ALTER TABLE documents ADD COLUMN encrypted_key TEXT;
ALTER TABLE documents ADD COLUMN key_id TEXT;
ALTER TABLE documents ADD CONSTRAINT chk_documents_encryption CHECK ((encrypted_key IS NULL) = (key_id IS NULL));
