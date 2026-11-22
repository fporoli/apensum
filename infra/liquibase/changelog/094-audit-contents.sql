--liquibase formatted sql

-- The audit log says that something happened, not what it says. What older rows still hold is removed;
-- an absence recorded without approval is no action of its own any more, since it gives away the type.

--changeset worktime:094-audit-contents
UPDATE audit_logs SET action = 'absence.submit', metadata = '{}'::jsonb WHERE action IN ('absence.submit', 'absence.submit-auto-approved');
UPDATE audit_logs SET metadata = metadata - 'note' WHERE action LIKE 'timesheet.%';
UPDATE audit_logs SET metadata = '{}'::jsonb WHERE action IN ('membership.update', 'membership.start-date', 'membership.exit-date', 'employment.assign');
UPDATE audit_logs SET metadata = CASE WHEN metadata->>'id' IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('id', metadata->>'id') END
WHERE action IN ('employment.update', 'employment.delete');
UPDATE audit_logs SET metadata = metadata - 'subject' WHERE action = 'mail.forward';
--rollback empty
