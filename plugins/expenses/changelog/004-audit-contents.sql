--liquibase formatted sql

-- The audit log says that a report was submitted, not the note that came with it.

--changeset expenses:004-audit-contents
UPDATE audit_logs SET metadata = metadata - 'note' WHERE action IN ('expense.submit', 'expense.submit-auto-approved');
--rollback empty
