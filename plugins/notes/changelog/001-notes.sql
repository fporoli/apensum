--liquibase formatted sql

-- The plugin's own Postgres schema (package.json apensum.dbSchema) with its one table, and its permission
-- object `nav.notes` (own notes only) with the default grants on the global roles. test/changelog.test.mjs
-- checks the permission rows against the manifest.

--changeset notes:001-notes
CREATE SCHEMA notes;
CREATE TABLE notes.notes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_owner ON notes.notes (organization_id, user_id, created_at DESC);
--rollback DROP SCHEMA notes CASCADE;

--changeset notes:001-permissions
INSERT INTO permissions (id, description)
VALUES ('nav.notes:see:own', 'nav.notes — see (own)'), ('nav.notes:edit:own', 'nav.notes — edit (own)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'nav.notes:edit:own'
FROM roles r
WHERE r.organization_id IS NULL AND r.name IN ('admin', 'hr', 'manager', 'member', 'developer', 'billing_admin')
ON CONFLICT DO NOTHING;
