--liquibase formatted sql

-- The core's vault (docs/VAULT.md): end-to-end encryption for any module, moved from the cases plugin (its changeset
-- 011 copies its keys here). The server stores only public keys, each person's private key sealed under their
-- passphrase, and each object's key sealed for one holder. It never holds a passphrase, a private key or an object key.

--changeset worktime:130-vault
CREATE TABLE vault_user_keys (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key            TEXT         NOT NULL,
    wrapped_private_key   TEXT         NOT NULL,
    salt                  TEXT         NOT NULL,
    iterations            INTEGER      NOT NULL CHECK (iterations >= 100000)
);
COMMENT ON TABLE vault_user_keys IS 'A person''s key pair for end-to-end encryption: the public key, and the private key sealed under their passphrase (PBKDF2 + AES-GCM). One per person, for every organization.';

-- An object is a module's record (object_kind = '<module>.<kind>', e.g. 'cases.case'); one wrapped copy of its key per holder.
CREATE TABLE vault_object_keys (
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    object_kind           TEXT         NOT NULL CHECK (object_kind ~ '^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$'),
    object_id             UUID         NOT NULL,
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_key           TEXT         NOT NULL,
    granted_by            UUID         REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (object_kind, object_id, user_id)
);
CREATE INDEX idx_vault_object_keys_user ON vault_object_keys (user_id);
CREATE INDEX idx_vault_object_keys_org ON vault_object_keys (organization_id);
COMMENT ON TABLE vault_object_keys IS 'An encrypted object''s key, wrapped with one holder''s public key (RSA-OAEP). Who may hold one is the owning module''s rule (ApiPlugin.vaultObjects).';
--rollback DROP TABLE vault_object_keys; DROP TABLE vault_user_keys;
