--liquibase formatted sql

-- Three link tables go. A document already names what it belongs to (documents.source_table / source_table_id, indexed
-- by idx_documents_source, set by DocumentsService.upload): the attachments of a flow message and the pictures of a
-- news post are read from there, so flow_message_documents and news_post_documents only repeated it. A news post's
-- departments become an array on the post (news_posts.department_ids; empty = everyone), as notes.notes.shared_with.
-- The links are copied onto the documents first, so nothing is lost where the two ever differed.

--changeset worktime:115-link-tables-folded
UPDATE documents d SET source_table = 'flow_messages', source_table_id = md.message_id
FROM flow_message_documents md WHERE md.document_id = d.id
  AND (d.source_table IS DISTINCT FROM 'flow_messages' OR d.source_table_id IS DISTINCT FROM md.message_id);
UPDATE documents d SET source_table = 'news_posts', source_table_id = nd.post_id
FROM news_post_documents nd WHERE nd.document_id = d.id
  AND (d.source_table IS DISTINCT FROM 'news_posts' OR d.source_table_id IS DISTINCT FROM nd.post_id);
DROP TABLE flow_message_documents;
DROP TABLE news_post_documents;

ALTER TABLE news_posts ADD COLUMN department_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE news_posts p SET department_ids = x.ids
FROM (SELECT post_id, array_agg(department_id ORDER BY department_id) AS ids FROM news_post_departments GROUP BY post_id) x
WHERE x.post_id = p.id;
DROP TABLE news_post_departments;
