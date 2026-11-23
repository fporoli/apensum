CREATE FUNCTION pg_temp.sim_id(text) RETURNS uuid LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT md5($1)::uuid $$;
CREATE FUNCTION pg_temp.sim_roll(text, int) RETURNS int LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (('x' || substr(md5($1), 1, 7))::bit(28)::int % $2)
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE slug IN ('dolphin', 'whale'))
     OR EXISTS (SELECT 1 FROM users WHERE email::text LIKE '%@dolphin.example' OR email::text LIKE '%@whale.example'
       OR email IN ('admin@dolphin.com', 'admin@whale.com')) THEN
    RAISE EXCEPTION 'Dolphin/Whale simulation already exists or names are in use; no seed changes made';
  END IF;
END $$;

CREATE TEMP TABLE sim_people ON COMMIT DROP AS
WITH companies(slug, name, founded, headcount, leaders) AS (
  VALUES ('dolphin', 'Dolphin', 1995, 10, 2), ('whale', 'Whale', 2008, 100, 10)
), staff AS (
  SELECT c.*, n, pg_temp.sim_id(slug) AS org, pg_temp.sim_id(slug || ':' || n) AS person,
         pg_temp.sim_id(slug || ':member:' || n) AS membership,
         CASE WHEN n <= leaders + 2 THEN 1 ELSE 3 + (n - leaders - 3) % leaders END AS manager_number,
         (ARRAY['Nora','Luca','Mila','Emil','Lea','Noah','Elena','David','Nina','Finn','Maya','Jonas','Sofia'])
           [1 + pg_temp.sim_roll(slug || n || ':first', 13)] AS first_name,
         (ARRAY['Keller','Bernasconi','Roth','Meier','Fischer','Steiner','Weber','Graf','Bieri','Rossi','Aubert','Schmid','Baumann'])
           [1 + pg_temp.sim_roll(slug || n || ':last', 13)] || ' ' || lpad(n::text, 3, '0') AS last_name
  FROM companies c CROSS JOIN LATERAL generate_series(1, headcount) n
)
SELECT *, CASE WHEN n = 1 THEN 'admin@' || slug || '.com'
               ELSE lpad(n::text, 3, '0') || '@' || slug || '.example' END AS email,
       CASE WHEN n = 1 THEN NULL ELSE pg_temp.sim_id(slug || ':' || manager_number) END AS manager,
       CASE WHEN n <= 2 THEN 1 WHEN n <= leaders + 2 THEN n - 1 ELSE manager_number - 1 END AS dept,
       CASE WHEN n = 1 THEN make_date(founded, 1, 1)
            WHEN n >= headcount - 1 THEN (date_trunc('month', current_date::timestamp) - (2 + (headcount - n) * 3) * interval '1 month')::date
            ELSE least(current_date - 30, make_date(founded + (n - 1) * (extract(year FROM current_date)::int - founded) / headcount,
                           CASE WHEN n <= leaders + 2 THEN 1 ELSE 4 + pg_temp.sim_roll(person || ':hire-month', 5) END, 1)) END AS hired
FROM staff;

INSERT INTO users (id, email, first_name, last_name, display_name, locale, timezone, status)
SELECT person, email, first_name, last_name, first_name || ' ' || last_name,
       (ARRAY['de','fr','it','en'])[1 + pg_temp.sim_roll(person::text, 4)], 'Europe/Zurich', 'active'
FROM sim_people;

INSERT INTO organizations (id, slug, name, type, country, created_by_user_id, settings)
SELECT org, slug, name, 'enterprise', 'CH', person,
       jsonb_build_object('holidayRegion', 'ZH', 'fullTimeWeeklyMinutes', 2400, 'homeOffice', true, 'vacationDaysPerYear', 25)
FROM sim_people WHERE n = 1;

INSERT INTO organization_memberships (id, organization_id, user_id, start_date, joined_at)
SELECT membership, org, person, hired, hired::timestamp AT TIME ZONE 'Europe/Zurich' FROM sim_people;

INSERT INTO membership_roles (membership_id, role_id)
SELECT p.membership, r.id FROM sim_people p JOIN roles r ON r.organization_id IS NULL AND (
  r.name = 'member' OR (r.name IN ('admin', 'owner') AND n = 1) OR (r.name = 'hr' AND n = 2)
  OR (r.name = 'manager' AND (n = 1 OR n BETWEEN 3 AND leaders + 2))
);

INSERT INTO departments (id, organization_id, name, leader_user_id, sort_order)
SELECT pg_temp.sim_id(slug || ':dept:' || dept), org,
       (ARRAY['People & Administration', 'Operations', 'Client Services', 'Engineering', 'Sales', 'Finance',
              'Logistics', 'Product', 'Support', 'Quality', 'Research'])[dept], person, dept
FROM sim_people WHERE n = 1 OR n BETWEEN 3 AND leaders + 2;

INSERT INTO employee_assignments (organization_id, user_id, valid_from, department_id, job_function, manager_user_id)
SELECT org, person, hired, pg_temp.sim_id(slug || ':dept:' || dept),
       CASE WHEN n = 1 THEN 'Managing Director' WHEN n = 2 THEN 'HR Specialist'
            WHEN n <= leaders + 2 THEN 'Department Lead' ELSE 'Specialist' END, manager
FROM sim_people;

CREATE TEMP TABLE sim_projects ON COMMIT DROP AS
SELECT org, pg_temp.sim_id(slug || ':project:' || i) AS id, pg_temp.sim_id(slug || ':' || (3 + (i - 1) % leaders)) AS owner, i
FROM sim_people CROSS JOIN LATERAL generate_series(1, leaders + 1) i WHERE n = 1;
INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item)
SELECT p.id, p.org,
       CASE c.slug WHEN 'dolphin' THEN (ARRAY['Coral: customer portal','Tide: service operations','Lagoon: internal tooling'])[p.i]
       ELSE (ARRAY['Orca: fleet dispatch','Blue: analytics platform','Beluga: client onboarding','Narwhal: billing refresh',
                    'Humpback: regional rollout','Sperm: data migration','Bowhead: warehouse upgrade','Minke: quality programme',
                    'Fin: mobile dispatch','Grey: service desk','Pilot: staff systems'])[p.i] END,
       p.owner, upper(c.slug) || '-' || p.i
FROM sim_projects p JOIN sim_people c ON c.org = p.org AND c.n = 1;

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT org, 'expenses', 'expense_category', '{"travel":"Travel","meals":"Meals","supplies":"Supplies","software":"Software"}'::jsonb, '{}'::jsonb
FROM sim_people WHERE n = 1
UNION ALL
SELECT org, 'expenses', 'expense_subcategory', '{"travel$taxi":"Taxi","meals$team_lunch":"Team lunch"}'::jsonb, '{}'::jsonb
FROM sim_people WHERE n = 1;

CREATE TEMP TABLE sim_days ON COMMIT DROP AS
SELECT *, row_number() OVER (PARTITION BY person, date_trunc('month', day) ORDER BY day) AS weekday_number
FROM (
  SELECT p.org, p.person, p.manager, p.slug, p.n, p.leaders, d::date AS day, p.person || ':' || d::date AS key
  FROM sim_people p
  CROSS JOIN LATERAL generate_series(p.hired::timestamp, (current_date - 1)::timestamp, interval '1 day') d
  WHERE extract(isodow FROM d) <= 5 AND NOT EXISTS (SELECT 1 FROM sim_holidays h WHERE h.day = d::date)
) workdays;
CREATE INDEX ON sim_days (org, person, day);

CREATE TEMP TABLE sim_absences ON COMMIT DROP AS
SELECT d.*, CASE WHEN weekday_number BETWEEN 6 AND 10 AND extract(month FROM day) IN (
                      2 + pg_temp.sim_roll(person || ':winter', 3), 7 + pg_temp.sim_roll(person || ':summer', 2),
                      10 + pg_temp.sim_roll(person || ':autumn', 3)) THEN 'vacation'
                 WHEN pg_temp.sim_roll(key || ':absence', 1000) < 14 THEN 'sickness'
                 WHEN pg_temp.sim_roll(key || ':absence', 1000) < 16 THEN 'accident'
                 WHEN pg_temp.sim_roll(key || ':absence', 1000) = 16 THEN 'unpaid_leave'
            END AS kind,
       weekday_number = 10 AND pg_temp.sim_roll(key || ':half', 3) = 0 AS half
FROM sim_days d;
DELETE FROM sim_absences WHERE kind IS NULL;
CREATE UNIQUE INDEX ON sim_absences (person, day);

INSERT INTO absences (id, organization_id, user_id, date_start, date_end, absence_type, half_day, status, reviewed_by_user_id, reviewed_at, note)
SELECT pg_temp.sim_id(key || ':absence'), org, person, day, day, kind, half, 'approved',
       CASE WHEN kind IN ('sickness', 'accident') THEN person ELSE coalesce(manager, person) END,
       (day - CASE WHEN kind = 'vacation' THEN 7 ELSE 0 END + time '09:00') AT TIME ZONE 'Europe/Zurich', 'Synthetic history'
FROM sim_absences;

CREATE TEMP TABLE sim_sessions ON COMMIT DROP AS
SELECT d.*, s.slot, s.starts AT TIME ZONE 'Europe/Zurich' AS starts, s.ends AT TIME ZONE 'Europe/Zurich' AS ends
FROM sim_days d LEFT JOIN sim_absences a USING (person, day)
CROSS JOIN LATERAL (SELECT d.day + time '07:40' + pg_temp.sim_roll(d.key || ':start', 66) * interval '1 min' AS morning,
                           230 + pg_temp.sim_roll(d.key || ':duration', 43) AS total_half) t
CROSS JOIN LATERAL (VALUES
  (1, t.morning, t.morning + interval '4 hours'),
  (2, t.morning + interval '5 hours', t.morning + (300 + t.total_half - 10) * interval '1 min')
) AS s(slot, starts, ends)
WHERE a.kind IS NULL OR (a.half AND s.slot = 1);

INSERT INTO work_times (id, organization_id, user_id, check_in, check_out, home_office, comment)
SELECT pg_temp.sim_id(key || ':attendance:' || slot), org, person, starts, ends,
       day >= '2020-03-16' AND pg_temp.sim_roll(key || ':remote', 5) = 0, 'Synthetic attendance'
FROM sim_sessions;

CREATE TEMP TABLE sim_bookings ON COMMIT DROP AS
SELECT s.*, p.id AS project, p.owner, date_trunc('month', day)::date AS month
FROM sim_sessions s JOIN sim_projects p ON p.org = s.org AND p.i = 1 + pg_temp.sim_roll(s.key || ':project:' || s.slot, s.leaders + 1);
INSERT INTO project_times (id, organization_id, user_id, project_id, start_time, end_time, comment)
SELECT pg_temp.sim_id(key || ':project-time:' || slot), org, person, project, starts,
       ends - (10 + pg_temp.sim_roll(key || ':unbilled', 42)) * interval '1 min', 'Synthetic project work'
FROM sim_bookings;

CREATE TEMP TABLE sim_months ON COMMIT DROP AS
SELECT p.*, m::date AS month, (m + interval '1 month')::date AS next_month,
       least(now(), (m + interval '1 month 12 hours') AT TIME ZONE 'Europe/Zurich') AS submitted,
       least(now(), (m + interval '1 month 3 days 10 hours') AT TIME ZONE 'Europe/Zurich') AS reviewed
FROM sim_people p CROSS JOIN LATERAL generate_series(date_trunc('month', hired::timestamp),
  date_trunc('month', current_date::timestamp) - interval '1 month', interval '1 month') m;

INSERT INTO timesheet_periods (id, organization_id, user_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.sim_id(person || ':month:' || month), org, person, month, next_month, 'approved', submitted, coalesce(manager, person), reviewed
FROM sim_months
WHERE NOT (n = leaders + 3 AND month = (date_trunc('month', current_date::timestamp) - interval '1 month')::date);

INSERT INTO project_time_periods (id, organization_id, user_id, project_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.sim_id(m.person || ':project-month:' || b.project || ':' || m.month), m.org, m.person, b.project, m.month, m.next_month,
       'approved', m.submitted, b.owner, m.reviewed
FROM (SELECT DISTINCT person, project, owner, month FROM sim_bookings) b JOIN sim_months m USING (person, month);

CREATE TEMP TABLE sim_expenses ON COMMIT DROP AS
SELECT d.*, date_trunc('month', day)::date AS month, pg_temp.sim_id(d.key || ':expense') AS expense_id,
       kinds.category, kinds.subcategory, kinds.note, kinds.base + pg_temp.sim_roll(d.key || ':cost', kinds.spread) + 0.5 AS amount
FROM sim_days d LEFT JOIN sim_absences a USING (person, day)
JOIN (VALUES (0, 'travel','taxi','Client taxi',17,65), (1, 'meals','team_lunch','Team lunch',25,120),
             (2, 'supplies',NULL,'Office supplies',8,60), (3, 'software',NULL,'Software subscription',10,45))
     AS kinds(i,category,subcategory,note,base,spread) ON i = pg_temp.sim_roll(d.key || ':expense-kind',4)
WHERE a.kind IS NULL AND pg_temp.sim_roll(d.key || ':expense', 100) < 9;

INSERT INTO expenses (id, organization_id, user_id, expense_date, category, sub_category, original_value, original_currency, currency, value, comment)
SELECT expense_id, org, person, day, category, subcategory, amount, 'CHF', 'CHF', amount, note FROM sim_expenses;

INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.sim_id(e.person || ':report:' || e.month), e.org, e.person,
       CASE WHEN m.month IS NULL THEN 'in_preparation' WHEN m.month >= date_trunc('month', current_date::timestamp) - interval '1 month' THEN 'approved'
            ELSE 'finished' END, m.submitted, coalesce(m.manager, m.person), m.reviewed
FROM (SELECT DISTINCT org, person, month FROM sim_expenses) e LEFT JOIN sim_months m USING (person, month);
INSERT INTO expense_report_items (expense_report_id, expense_id, organization_id)
SELECT pg_temp.sim_id(person || ':report:' || month), expense_id, org FROM sim_expenses;

ANALYZE organization_memberships, work_times, project_times, absences, timesheet_periods, project_time_periods, expenses, expense_reports;
