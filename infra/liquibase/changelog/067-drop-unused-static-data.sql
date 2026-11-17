--liquibase formatted sql

-- Dropdown rows nothing reads: project type and membership status are DB enums with their labels in
-- the app's dictionaries, project time never got a billability column, and the expense billing type
-- was never in the expense form. Removes the rows (any org, as the seed created them for Acme) and
-- the unused expenses.billing_type column.

--changeset worktime:067-drop-unused-static-data
DELETE FROM static_data
WHERE (entity, enum_name) IN (
  ('projects', 'project_type'),
  ('organization_memberships', 'membership_status'),
  ('project_times', 'billability'),
  ('expenses', 'billing_type')
);

ALTER TABLE expenses DROP COLUMN billing_type;
