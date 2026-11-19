--liquibase formatted sql

--changeset worktime:079-newsletter-subscribers
-- Subscribers to the website's news (apps/site, site-newsletter.controller.ts): double opt-in, so a
-- subscription only counts once the person confirmed it from the e-mail sent to the address.
-- token_hash is the SHA-256 of the secret in the latest confirm/unsubscribe link (a new link replaces
-- it). The timestamps are the record of consent (when it was asked for, confirmed and withdrawn),
-- which is why this table keeps them, unlike the app's tables (history there is in versions).
-- last_mail_at throttles the mails one address can be sent.
CREATE TABLE newsletter_subscribers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email            CITEXT        NOT NULL UNIQUE,
    lang             TEXT          NOT NULL DEFAULT 'de',
    status           TEXT          NOT NULL DEFAULT 'pending',
    token_hash       TEXT          NOT NULL,
    site_origin      TEXT          NOT NULL,
    requested_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    confirmed_at     TIMESTAMPTZ,
    unsubscribed_at  TIMESTAMPTZ,
    last_mail_at     TIMESTAMPTZ,
    CONSTRAINT chk_newsletter_lang CHECK (lang IN ('de', 'fr', 'it', 'en')),
    CONSTRAINT chk_newsletter_status CHECK (status IN ('pending', 'confirmed', 'unsubscribed'))
);

CREATE UNIQUE INDEX uq_newsletter_token ON newsletter_subscribers (token_hash);
