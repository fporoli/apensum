--liquibase formatted sql

-- An account's e-mail address proven (docs/dev/ACCESS.md): set by the link mailed on registration (or a password reset
-- link, or the identity provider's verified address). A password login works only once it is set. Every account
-- that existed before counts as proven. The column is from 001, unused until now.

--changeset worktime:132-email-verified
-- real time: the moment the existing accounts were taken as proven
UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL;
COMMENT ON COLUMN users.email_verified_at IS 'When the address was proven (registration link, password reset link, SSO verified e-mail); NULL = not yet, no password login.';
--rollback UPDATE users SET email_verified_at = NULL;
