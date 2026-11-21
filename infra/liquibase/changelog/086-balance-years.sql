--liquibase formatted sql

-- Year-end closing per person (balances.service.ts): the overtime, Überzeit and vacation left at the end of a
-- calendar year, frozen. Balances of later years start from the newest closing instead of the person's first
-- day, and a closed year is locked for every write that would change it (work time, absences, adjustments,
-- entitlements, reopening a month). Years close in order and only the newest closed year reopens.
-- incomplete_months: months of the year whose timesheet was not approved when it was closed anyway.

--changeset worktime:086-balance-years
CREATE TABLE balance_years (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year                   INTEGER NOT NULL,
  overtime_minutes       INTEGER NOT NULL,
  legal_overtime_minutes INTEGER NOT NULL,
  vacation_days          NUMERIC(8, 2) NOT NULL,
  incomplete_months      INTEGER NOT NULL DEFAULT 0,
  closed_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_balance_years UNIQUE (organization_id, user_id, year),
  CONSTRAINT chk_balance_years_year CHECK (year BETWEEN 2000 AND 2100)
);
