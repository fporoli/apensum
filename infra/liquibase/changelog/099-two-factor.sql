--liquibase formatted sql

-- Two-step login (apps/api/src/two-factor.ts): an account's authenticator secret, encrypted with a key
-- derived from API_JWT_SECRET, set up (`enabled` false) until the first code confirms it; the one-time
-- recovery codes as hashes; the last time step used, so a code works once. An organization's rule
-- lives in organizations.settings.twoFactor (packages/shared/src/twoFactor.ts).

--changeset worktime:099-two-factor
CREATE TABLE user_two_factor (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc      TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
    last_step       BIGINT NOT NULL DEFAULT 0
);
--rollback DROP TABLE user_two_factor;
