--liquibase formatted sql

-- End-to-end encryption keys (plugins/cases/shared/caseCrypto.ts). The server stores only public keys,
-- the private key sealed under the user's passphrase, and each case key sealed for one member. It never
-- holds a passphrase, a private key or a case key.

--changeset cases:002-case-keys
CREATE TABLE cases.user_keys (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key            TEXT         NOT NULL,
    wrapped_private_key   TEXT         NOT NULL,
    salt                  TEXT         NOT NULL,
    iterations            INTEGER      NOT NULL CHECK (iterations >= 100000)
);

CREATE TABLE cases.case_keys (
    case_id               UUID         NOT NULL REFERENCES cases.cases(id) ON DELETE CASCADE,
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_key           TEXT         NOT NULL,
    granted_by            UUID         REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (case_id, user_id)
);
CREATE INDEX idx_case_keys_user ON cases.case_keys (user_id);
