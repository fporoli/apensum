--liquibase formatted sql

-- Projects can be limited to teams: a project with rows here is booked (project time) only by the
-- members and leads of those teams and by its owner; a project without rows stays open to everyone
-- in the organization. Subprojects follow their project. Existing bookings are never touched; the
-- check runs when time is booked on a project (canBookProject in apps/api/src/access.ts).
-- A team still assigned to a project can't be deleted (RESTRICT), so a project never opens up to
-- everyone because its last team disappeared.

--changeset worktime:070-project-teams
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_team ON project_teams (team_id);
