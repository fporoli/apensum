--liquibase formatted sql

-- Requests get a type, an urgency flag and a link.
-- - request_type: a key of the org's static_data row requests/request_type (its own copy, else the
--   global row below). Older requests have none. The code keeps no list of types.
-- - urgent: the requester (or a handler) flags it; urgent open requests are listed first.
-- - link_url: an http(s) link to jump to, e.g. another ticket (validated by cleanRequestLink,
--   packages/shared/src/requests.ts).

--changeset worktime:069-request-type-urgency-link
ALTER TABLE requests
    ADD COLUMN request_type  TEXT,
    ADD COLUMN urgent        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN link_url      TEXT,
    ADD CONSTRAINT chk_requests_link_url CHECK (link_url IS NULL OR (link_url ~* '^https?://' AND length(link_url) <= 2000));

--changeset worktime:069-request-type-static-data
-- Global default types, read-only for every organization (an org copies the row to change it).
-- `sort` orders the dropdown; labels per language in `translation`.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT NULL, 'requests', 'request_type',
  '{"service":{"sort":1},"support":{"sort":2},"other":{"sort":3}}'::jsonb,
  '{"en":{"service":"Service request","support":"Support","other":"Other"},
    "de":{"service":"Serviceanfrage","support":"Support","other":"Anderes"},
    "fr":{"service":"Demande de service","support":"Support","other":"Autre"},
    "it":{"service":"Richiesta di servizio","support":"Supporto","other":"Altro"}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM static_data WHERE organization_id IS NULL AND entity = 'requests' AND enum_name = 'request_type'
);
