--liquibase formatted sql

-- Locations (work places) of an organization, each in a canton and optionally a municipality (Organization settings
-- -> Working time and holidays). A person's location is part of their dated assignment (employee_assignments), so
-- a move to another office changes their holidays from that day on. Public holidays follow the location's canton;
-- an organization's own holiday rows can apply to one location only (e.g. Knabenschiessen in Zurich), and then win
-- over its rows for everyone on that date. People without a location keep the organization's canton
-- (settings.holidayRegion). A location in use by an assignment can't be deleted.

--changeset worktime:087-locations
CREATE TABLE locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  canton          VARCHAR(2) NOT NULL,
  municipality    TEXT,
  CONSTRAINT chk_locations_name CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT chk_locations_canton CHECK (canton ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX uq_locations_name ON locations (organization_id, lower(name));

ALTER TABLE employee_assignments ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE RESTRICT;

ALTER TABLE org_holidays ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE org_holidays DROP CONSTRAINT uq_org_holidays;
CREATE UNIQUE INDEX uq_org_holidays ON org_holidays (organization_id, date, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
