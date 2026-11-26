--liquibase formatted sql

-- Requests are flows (CLAUDE.md, "Terms": one thing, one word). What someone starts and others work on is a Flow; a
-- row of this table is a Free Flow (to the manager or a department) or a flow of the organization's own type with set
-- steps. The tables, the module, the permission object, the request types, the workflow kind and the forms take the
-- new name. The flows that existed are not kept (decided when renaming: none were in use), so the rows that pointed to
-- them go too; what organizations set up (their module switch, grants, types, steps and fields) is carried over.

--changeset worktime:110-flows-data
-- What pointed to a request: its notifications, history, workflows and attached files, then the requests themselves.
DELETE FROM notifications WHERE source_table = 'requests';
DELETE FROM versions WHERE source_table IN ('requests', 'request_messages');
DELETE FROM workflows WHERE source_table = 'requests';
DELETE FROM request_message_documents;
DELETE FROM documents WHERE source_table = 'request_messages';
DELETE FROM request_messages;
DELETE FROM requests;
--rollback SELECT 1;

--changeset worktime:110-flows-tables
ALTER TABLE requests RENAME TO flows;
ALTER TABLE flows RENAME COLUMN request_type TO flow_type;
ALTER TABLE flows RENAME CONSTRAINT requests_pkey TO flows_pkey;
ALTER TABLE flows RENAME CONSTRAINT requests_organization_id_fkey TO flows_organization_id_fkey;
ALTER TABLE flows RENAME CONSTRAINT requests_requester_user_id_fkey TO flows_requester_user_id_fkey;
ALTER TABLE flows RENAME CONSTRAINT requests_target_department_id_fkey TO flows_target_department_id_fkey;
ALTER TABLE flows RENAME CONSTRAINT requests_assignee_user_id_fkey TO flows_assignee_user_id_fkey;
ALTER TABLE flows RENAME CONSTRAINT chk_requests_requester_or_source TO chk_flows_requester_or_source;
ALTER TABLE flows RENAME CONSTRAINT chk_requests_target TO chk_flows_target;
ALTER TABLE flows RENAME CONSTRAINT chk_requests_status TO chk_flows_status;
ALTER TABLE flows RENAME CONSTRAINT chk_requests_subject TO chk_flows_subject;
ALTER TABLE flows RENAME CONSTRAINT chk_requests_link_url TO chk_flows_link_url;
ALTER INDEX idx_requests_requester RENAME TO idx_flows_requester;
ALTER INDEX idx_requests_department RENAME TO idx_flows_department;
ALTER INDEX uq_requests_source_key RENAME TO uq_flows_source_key;
ALTER INDEX idx_requests_due RENAME TO idx_flows_due;

ALTER TABLE request_messages RENAME TO flow_messages;
ALTER TABLE flow_messages RENAME COLUMN request_id TO flow_id;
ALTER TABLE flow_messages RENAME CONSTRAINT request_messages_pkey TO flow_messages_pkey;
ALTER TABLE flow_messages RENAME CONSTRAINT request_messages_request_id_fkey TO flow_messages_flow_id_fkey;
ALTER TABLE flow_messages RENAME CONSTRAINT request_messages_author_user_id_fkey TO flow_messages_author_user_id_fkey;
ALTER TABLE flow_messages RENAME CONSTRAINT chk_request_messages_kind TO chk_flow_messages_kind;
ALTER INDEX idx_request_messages_request RENAME TO idx_flow_messages_flow;

ALTER TABLE request_message_documents RENAME TO flow_message_documents;
ALTER TABLE flow_message_documents RENAME CONSTRAINT request_message_documents_pkey TO flow_message_documents_pkey;
ALTER TABLE flow_message_documents RENAME CONSTRAINT request_message_documents_message_id_fkey TO flow_message_documents_message_id_fkey;
ALTER TABLE flow_message_documents RENAME CONSTRAINT request_message_documents_document_id_fkey TO flow_message_documents_document_id_fkey;
ALTER INDEX idx_request_message_documents_document RENAME TO idx_flow_message_documents_document;
--rollback SELECT 1;

--changeset worktime:110-flows-config splitStatements:false
-- The permission object (nav.requests is nav.flows) is 111-permission-flows.sql.

-- The module switch (organizations.settings.modules.requests is .flows).
UPDATE organizations
SET settings = jsonb_set(settings #- '{modules,requests}', '{modules,flows}', settings -> 'modules' -> 'requests')
WHERE jsonb_exists(settings -> 'modules', 'requests');

-- The types (static data requests/request_type is flows/flow_type), and the properties that describe them
-- (`<entity>.<list>.<property>` keys of the list static_data/properties, and their labels per language).
UPDATE static_data SET entity = 'flows', enum_name = 'flow_type' WHERE entity = 'requests' AND enum_name = 'request_type';
UPDATE static_data
SET values = (SELECT jsonb_object_agg(regexp_replace(k, '^requests\.request_type\.', 'flows.flow_type.'), v) FROM jsonb_each(values) AS e(k, v))
WHERE entity = 'static_data' AND enum_name = 'properties' AND EXISTS (SELECT 1 FROM jsonb_object_keys(values) k WHERE k LIKE 'requests.request_type.%');
UPDATE static_data
SET translation = (
  SELECT jsonb_object_agg(lang, (SELECT coalesce(jsonb_object_agg(regexp_replace(k, '^requests\.request_type\.', 'flows.flow_type.'), v), '{}'::jsonb) FROM jsonb_each(labels) AS l(k, v)))
  FROM jsonb_each(translation) AS t(lang, labels)
  WHERE jsonb_typeof(labels) = 'object'
)
WHERE entity = 'static_data' AND enum_name = 'properties' AND translation IS NOT NULL AND jsonb_typeof(translation) = 'object'
  AND EXISTS (SELECT 1 FROM jsonb_each(translation) t(lang, labels) WHERE jsonb_typeof(labels) = 'object' AND labels::text LIKE '%"requests.request_type.%');

-- A type's steps (workflow definitions request:<type> are flow:<type>) and its own fields (forms request, request.<type>).
UPDATE workflow_definitions SET name = 'flow:' || substr(name, 9) WHERE name LIKE 'request:%';
UPDATE workflow_definitions SET name = 'flow' WHERE name = 'request';
UPDATE field_config SET form_id = 'flow' || substr(form_id, 8) WHERE form_id = 'request' OR form_id LIKE 'request.%';

-- The operators' organization starts with the flows module off (098, the module's new name).
CREATE OR REPLACE FUNCTION operator_grant(p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  added boolean;
BEGIN
  INSERT INTO organizations (id, slug, name, type, created_by_user_id, settings)
  VALUES ('00000000-0000-0000-0000-00000000a0a0', '_operators', 'Apensum Admin', 'enterprise', p_user,
          '{"modules": {"flows": false, "reports": false, "news": false, "expenses": false, "cases": false, "hr": false}}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO organization_memberships (organization_id, user_id, status)
  VALUES ('00000000-0000-0000-0000-00000000a0a0', p_user, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active' WHERE organization_memberships.status <> 'active'
  RETURNING true INTO added;
  RETURN coalesce(added, false);
END
$$;
--rollback SELECT 1;
