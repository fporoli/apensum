--liquibase formatted sql

-- Expense processing is HR's alone: it shows people's personnel numbers and amounts and hands them
-- to accounting, so admin and billing_admin no longer hold it (their organizations' copies included).

--changeset expenses:005-processing-hr
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id
  AND r.name IN ('admin', 'billing_admin')
  AND rp.permission_id LIKE 'nav.expenseProcessing:%';
