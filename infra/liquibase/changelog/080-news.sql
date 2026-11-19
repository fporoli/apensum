--liquibase formatted sql

-- News (module "news", news.controller.ts, packages/shared/src/news.ts): posts an organization's
-- admin or HR publishes to its members, e.g. product news or a new internal directive.
-- - texts: { "<lang>": { "title": ..., "body": <Markdown> } }, at least one language.
-- - published_at NULL = a draft, seen only by those who write news (nav.news:edit).
-- - audience: the departments in news_post_departments (whoever's assignment in force is in one of
--   them, and its leader); none = everyone in the organization.
-- - require_ack: readers are asked to confirm they read it; those who write news see who did.
-- read_at / acknowledged_at are the record (shown to HR), not audit timestamps; history goes to
-- versions as everywhere else.

--changeset worktime:080-news-posts
CREATE TABLE news_posts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    author_user_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
    texts            JSONB        NOT NULL,
    require_ack      BOOLEAN      NOT NULL DEFAULT false,
    published_at     TIMESTAMPTZ,
    CONSTRAINT chk_news_posts_texts CHECK (jsonb_typeof(texts) = 'object')
);
CREATE INDEX idx_news_posts_org ON news_posts (organization_id, published_at DESC);

--changeset worktime:080-news-post-departments
CREATE TABLE news_post_departments (
    post_id        UUID NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
    department_id  UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, department_id)
);

--changeset worktime:080-news-post-reads
CREATE TABLE news_post_reads (
    post_id          UUID         NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    acknowledged_at  TIMESTAMPTZ,
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_news_post_reads_user ON news_post_reads (user_id);

--changeset worktime:080-news-post-documents
-- Pictures in a post's text (`![alt](doc:<document id>)`), stored through DocumentsService.
CREATE TABLE news_post_documents (
    post_id      UUID NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
    document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, document_id)
);
CREATE INDEX idx_news_post_documents_document ON news_post_documents (document_id);
