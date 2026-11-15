--liquibase formatted sql

-- "Personnel file" section (packages/shared/src/permissions.ts, section.people.documents): the HR
-- dossier of a person on the Users page (personnel_documents, 061). HR keeps it (edit:all); nobody
-- else holds it by default, not even admin, because reviews and bonus letters are confidential.
-- Owner holds everything. A person sees the documents shared with them on their Documents page,
-- which needs no grant here.

--changeset worktime:062-permission-personnel-documents
INSERT INTO permissions (id, description) VALUES
    ('section.people.documents:see:own', 'section.people.documents — see (own)'),
    ('section.people.documents:see:team', 'section.people.documents — see (team)'),
    ('section.people.documents:see:reports', 'section.people.documents — see (reports)'),
    ('section.people.documents:see:all', 'section.people.documents — see (all)'),
    ('section.people.documents:edit:own', 'section.people.documents — edit (own)'),
    ('section.people.documents:edit:team', 'section.people.documents — edit (team)'),
    ('section.people.documents:edit:reports', 'section.people.documents — edit (reports)'),
    ('section.people.documents:edit:all', 'section.people.documents — edit (all)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'section.people.documents:edit:all'
FROM roles r
WHERE r.name = 'hr' AND r.organization_id IS NULL
ON CONFLICT DO NOTHING;
