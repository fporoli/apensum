--liquibase formatted sql

-- The Flow-Designer's own right (packages/shared/src/permissions.ts, section.admin.workflows; workflow-configs.controller.ts):
-- changing the steps of the flows (absences, expense reports, payment runs, the organization's flow types) decides who
-- sees whose flows, so it was the owner's alone. The owner holds it (OWNER_PERMISSIONS, no rows) and may give it to a
-- role on Admin settings -> Roles & permissions (an admin or developer role); no role has it by default. Reading the
-- designer stays with whoever sees Admin settings.

--changeset worktime:113-permission-flow-designer
INSERT INTO permissions (id, description) VALUES
    ('section.admin.workflows:see:all', 'section.admin.workflows — see (all)'),
    ('section.admin.workflows:edit:all', 'section.admin.workflows — edit (all)')
ON CONFLICT (id) DO NOTHING;
--rollback DELETE FROM permissions WHERE id IN ('section.admin.workflows:see:all', 'section.admin.workflows:edit:all');
