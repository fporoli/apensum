--liquibase formatted sql

-- The vault's level Standard (docs/VAULT.md): an object encrypted like a confidential one, but its key is held by the
-- server, sealed with the instance's master key (DOCUMENTS_KEY, rotated by db:encrypt-documents --rewrap). Whoever may
-- see the object gets the key from the server, without a passphrase; a database dump alone stays unreadable, the
-- operator could read it. An object is either Standard (a row here) or confidential (keys in vault_object_keys).

--changeset worktime:131-vault-escrow
CREATE TABLE vault_object_escrow (
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    object_kind           TEXT         NOT NULL CHECK (object_kind ~ '^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$'),
    object_id             UUID         NOT NULL,
    sealed_key            TEXT         NOT NULL,
    key_id                TEXT         NOT NULL,
    PRIMARY KEY (object_kind, object_id)
);
CREATE INDEX idx_vault_object_escrow_org ON vault_object_escrow (organization_id);
COMMENT ON TABLE vault_object_escrow IS 'Level Standard: an object''s key (AES-256, raw) sealed with the instance master key (key_id names it, as documents.key_id). Handed only to people the owning module lets see the object.';
--rollback DROP TABLE vault_object_escrow;
