--liquibase formatted sql

-- Public product news (news.controller.ts, public-news.controller.ts): a product post (082) marked
-- is_public is shown on the website (apps/site loads it from public/news) and can be sent to the
-- website's newsletter subscribers (079). newsletter_deliveries records who got which post, so a
-- send never mails anyone twice and an interrupted one can simply be started again.

--changeset worktime:083-news-posts-public
ALTER TABLE news_posts ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE news_posts ADD CONSTRAINT chk_news_posts_public CHECK (organization_id IS NULL OR NOT is_public);
CREATE INDEX idx_news_posts_public ON news_posts (published_at DESC) WHERE is_public;

--changeset worktime:083-newsletter-deliveries
CREATE TABLE newsletter_deliveries (
    post_id        UUID         NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
    subscriber_id  UUID         NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
    sent_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, subscriber_id)
);
