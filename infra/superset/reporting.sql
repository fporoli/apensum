-- The reporting layer Superset reads (trial; applied by scripts/superset-setup.mjs, not yet a
-- Liquibase changelog). Views in their own schema, one row per day or entry, each with its
-- organization_id and user_id: the Apensum API's guest tokens filter on exactly these two columns
-- (row-level security), so every view must carry them. Nothing else from the database is
-- reachable: superset_reader may only read this schema.
--
-- psql -v reader_password=... -f reporting.sql   (re-runnable)

CREATE SCHEMA IF NOT EXISTS reporting;

-- People with the department of their assignment in force today.
CREATE OR REPLACE VIEW reporting.people AS
SELECT m.organization_id,
       m.user_id,
       u.display_name AS person,
       d.name AS department
FROM organization_memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN LATERAL (
  SELECT a.department_id
  FROM employee_assignments a
  WHERE a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.valid_from <= current_date
  ORDER BY a.valid_from DESC
  LIMIT 1
) a ON true
LEFT JOIN departments d ON d.id = a.department_id
WHERE m.is_active;

-- Project time: one row per entry, on its day in Swiss time.
CREATE OR REPLACE VIEW reporting.project_hours AS
SELECT t.organization_id,
       t.user_id,
       p.person,
       p.department,
       coalesce(pr.name, '(ohne Projekt)') AS project,
       (t.start_time AT TIME ZONE 'Europe/Zurich')::date AS day,
       date_trunc('month', t.start_time AT TIME ZONE 'Europe/Zurich')::date AS month,
       round(extract(epoch FROM t.end_time - t.start_time) / 3600.0, 2) AS hours
FROM project_times t
JOIN reporting.people p ON p.organization_id = t.organization_id AND p.user_id = t.user_id
LEFT JOIN projects pr ON pr.id = t.project_id;

-- Attendance: one row per person and day (closed check-ins only).
CREATE OR REPLACE VIEW reporting.attendance_days AS
SELECT w.organization_id,
       w.user_id,
       p.person,
       p.department,
       (w.check_in AT TIME ZONE 'Europe/Zurich')::date AS day,
       round(sum(extract(epoch FROM w.check_out - w.check_in)) / 3600.0, 2) AS hours
FROM work_times w
JOIN reporting.people p ON p.organization_id = w.organization_id AND p.user_id = w.user_id
WHERE w.check_out IS NOT NULL
GROUP BY w.organization_id, w.user_id, p.person, p.department, (w.check_in AT TIME ZONE 'Europe/Zurich')::date;

-- Absences: one row per absence, with its calendar days.
CREATE OR REPLACE VIEW reporting.absences AS
SELECT a.organization_id,
       a.user_id,
       p.person,
       p.department,
       a.absence_type,
       a.status::text AS status,
       a.date_start,
       a.date_end,
       (a.date_end - a.date_start + 1) * CASE WHEN a.half_day THEN 0.5 ELSE 1 END AS days
FROM absences a
JOIN reporting.people p ON p.organization_id = a.organization_id AND p.user_id = a.user_id;

-- The database user Superset connects with: this schema only, read only.
SELECT format('CREATE ROLE superset_reader LOGIN PASSWORD %L', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'superset_reader') \gexec
ALTER ROLE superset_reader PASSWORD :'reader_password';
GRANT USAGE ON SCHEMA reporting TO superset_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO superset_reader;
