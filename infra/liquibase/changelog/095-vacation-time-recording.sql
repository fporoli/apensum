--liquibase formatted sql

-- Vacation rules by management and age, probation, and people who record no working time.
-- The rules are `organizations.settings.vacation` (packages/shared/src/vacation.ts).

--changeset worktime:095-management
ALTER TABLE employee_assignments ADD COLUMN is_management BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN employee_assignments.is_management IS 'Management from valid_from on: the vacation rules may give them other days. No right and no exemption from time recording.';
--rollback ALTER TABLE employee_assignments DROP COLUMN is_management;

--changeset worktime:095-probation
ALTER TABLE organization_memberships ADD COLUMN probation_until DATE;
COMMENT ON COLUMN organization_memberships.probation_until IS 'Last day of probation where it differs from the organization''s months; before the start date = none. NULL = the organization''s.';
--rollback ALTER TABLE organization_memberships DROP COLUMN probation_until;

--changeset worktime:095-time-recording
ALTER TABLE work_schedules
    ADD COLUMN time_recording TEXT NOT NULL DEFAULT 'full',
    ADD COLUMN exemption_reason TEXT,
    ADD CONSTRAINT chk_work_schedules_recording CHECK (time_recording IN ('full', 'daily', 'none')),
    ADD CONSTRAINT chk_work_schedules_exemption CHECK (
        (time_recording = 'none' AND exemption_reason IS NOT NULL AND exemption_reason IN ('senior_executive', 'waiver'))
        OR (time_recording <> 'none' AND exemption_reason IS NULL));
COMMENT ON COLUMN work_schedules.time_recording IS 'full = start and end; none = no working time (with exemption_reason); daily = hours per day (ArGV 1 art. 73b), reserved until the app offers it.';
--rollback ALTER TABLE work_schedules DROP COLUMN time_recording, DROP COLUMN exemption_reason;

--changeset worktime:095-probation-setting
-- The HR plugin kept the probation months; the core's vacation settings have them now.
UPDATE organizations
SET settings = settings || jsonb_build_object('vacation',
    COALESCE(settings -> 'vacation', '{}'::jsonb) || jsonb_build_object('probationMonths', settings -> 'hr' -> 'probationMonths'))
WHERE jsonb_typeof(settings -> 'hr' -> 'probationMonths') = 'number';
--rollback empty
