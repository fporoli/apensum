--liquibase formatted sql

-- Product news (news.controller.ts): a post with organization_id NULL is written by a superdeveloper
-- for the admins (`nav.admin`) of every organization that has the News module on. It has no
-- departments (the API refuses them). Its pictures are documents of the organization it was
-- written in (documents always belong to one).

--changeset worktime:082-news-product-posts
ALTER TABLE news_posts ALTER COLUMN organization_id DROP NOT NULL;
CREATE INDEX idx_news_posts_product ON news_posts (published_at DESC) WHERE organization_id IS NULL;
