-- The expenses plugin's demo data (docs/PLUGINS.md, "Seed"). Runs after the core's
-- infra/postgres/seeds/seed.sql in the same transaction (infra/postgres/run-seed.mjs, the VPS and
-- Azure seeders), so Acme, its people and projects exist and the pg_temp.seed_* helpers defined
-- there can be used. Same rules as the core's seed: fixed or md5-derived ids, ON CONFLICT DO NOTHING,
-- re-runnable; a re-run adds only what is missing (newly passed months).
--
-- Expenses: 0-3 a month, in one expense report a month: finished, approved for the last two
--     months, in preparation for the current one.

-- Acme's expense categories and sub-categories (English values; de/fr/it below).
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'expenses', 'expense_category', '{"travel":"Travel","meals":"Meals & Entertainment","supplies":"Office Supplies","software":"Software & Subscriptions","other":"Other"}', '{}'),
  -- Sub-category keys are prefixed "<parent category key>$<sub-category key>" so the UI can filter
  -- this one enum down to just the options under whichever category is currently selected, without
  -- a separate static_data row (or table) per parent category.
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'expenses', 'expense_subcategory', '{"travel$flight":"Flight","travel$hotel":"Hotel","travel$taxi":"Taxi/Rideshare","meals$client_lunch":"Client Lunch","meals$team_lunch":"Team Lunch"}', '{}')
ON CONFLICT DO NOTHING;

-- Acme's dropdown values in de/fr/it (the `values` above are English). Per language, keys already
-- translated win, so translations edited since are kept and the seed stays re-runnable.
UPDATE static_data s SET translation = s.translation || (
  SELECT jsonb_object_agg(l.key, l.value || COALESCE(s.translation -> l.key, '{}'::jsonb)) FROM jsonb_each(v.t) l)
FROM (VALUES
  ('expenses', 'expense_category', '{
    "de": {"travel": "Reisen", "meals": "Verpflegung & Bewirtung", "supplies": "Büromaterial", "software": "Software & Abonnemente", "other": "Sonstiges"},
    "fr": {"travel": "Voyages", "meals": "Repas & représentation", "supplies": "Fournitures de bureau", "software": "Logiciels & abonnements", "other": "Autres"},
    "it": {"travel": "Viaggi", "meals": "Pasti & rappresentanza", "supplies": "Materiale d''ufficio", "software": "Software & abbonamenti", "other": "Altro"}}'::jsonb),
  ('expenses', 'expense_subcategory', '{
    "de": {"travel$flight": "Flug", "travel$hotel": "Hotel", "travel$taxi": "Taxi/Fahrdienst", "meals$client_lunch": "Kundenessen", "meals$team_lunch": "Teamessen"},
    "fr": {"travel$flight": "Vol", "travel$hotel": "Hôtel", "travel$taxi": "Taxi/VTC", "meals$client_lunch": "Repas client", "meals$team_lunch": "Repas d''équipe"},
    "it": {"travel$flight": "Volo", "travel$hotel": "Albergo", "travel$taxi": "Taxi/NCC", "meals$client_lunch": "Pranzo con clienti", "meals$team_lunch": "Pranzo di team"}}'::jsonb)
) AS v(entity, enum_name, t)
WHERE s.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND s.entity = v.entity AND s.enum_name = v.enum_name;

-- The `user` demo account's expenses.
-- Demo expenses for the `user` demo account. The third one is left unmapped to any
-- report, to exercise the "nothing attached yet" empty state in the report builder.
INSERT INTO expenses (id, user_id, organization_id, project_id, subproject_id, expense_date, category, sub_category, original_value, original_currency, currency, quantity, comment)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'travel', 'taxi', 45.00, 'EUR', 'CHF', NULL, 'Taxi to client site'),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, (NOW() - INTERVAL '5 days')::date, 'meals', 'client_lunch', 60.00, 'EUR', 'CHF', NULL, 'Lunch with client'),
  ('eeeeeeee-eeee-eeee-eeee-333333333333', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, NULL, (NOW() - INTERVAL '1 day')::date, 'supplies', NULL, 25.50, 'CHF', 'CHF', 1, 'USB-C cable')
ON CONFLICT (id) DO NOTHING;

-- Demo report bundling the first two expenses above, already submitted for manager approval.
INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, data)
VALUES ('ffffffff-ffff-ffff-ffff-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'submitted', NOW() - INTERVAL '4 days', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_report_items (expense_report_id, expense_id, organization_id)
VALUES
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('ffffffff-ffff-ffff-ffff-111111111111', 'eeeeeeee-eeee-eeee-eeee-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (expense_id) DO NOTHING;

-- Expenses: 0-3 a month per person, on a weekday of that month before today, from a small
-- catalogue (category, sub-category, amount range, currency, billing; billing only picks the project).
CREATE TEMP TABLE seed_expenses ON COMMIT DROP AS
WITH kinds(n, category, sub_category, low, high, currency, billing_type, comment) AS (
  VALUES
    (0, 'travel',   'taxi',         18, 85,  'CHF', 'billable',     'Taxi to the client'),
    (1, 'travel',   'hotel',        120, 260, 'EUR', 'billable',    'Hotel, client visit'),
    (2, 'travel',   'flight',       160, 620, 'EUR', 'billable',    'Flight to workshop'),
    (3, 'meals',    'client_lunch', 45, 190, 'CHF', 'billable',     'Lunch with the client'),
    (4, 'meals',    'team_lunch',   35, 140, 'CHF', 'internal',     'Team lunch'),
    (5, 'supplies', NULL,           8, 60,   'CHF', 'non_billable', 'Office supplies'),
    (6, 'software', NULL,           10, 49,  'CHF', 'internal',     'Software subscription'),
    (7, 'other',    NULL,           12, 80,  'CHF', 'non_billable', 'Parking')
),
slots AS (
  SELECT m.user_id, m.organization_id, mo::date AS month, i,
         m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expense:' || i AS key,
         COALESCE(m.start_date, m.joined_at::date) AS start_date
  FROM organization_memberships m
  JOIN users u ON u.id = m.user_id AND u.status = 'active'
  CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(m.start_date, m.joined_at::date)),
                                     date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date), INTERVAL '1 month') AS mo
  CROSS JOIN generate_series(1, 3) AS i
  WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.status = 'active'
    AND i <= CASE WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.3 THEN 0
                  WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.65 THEN 1
                  WHEN pg_temp.seed_rnd(m.user_id || ':' || to_char(mo, 'YYYY-MM') || ':expenses') < 0.9 THEN 2 ELSE 3 END
),
dated AS (
  SELECT s.*, (s.month + floor(pg_temp.seed_rnd(s.key || ':day') * 20)::int) AS raw_day
  FROM slots s
)
SELECT pg_temp.seed_id(d.key) AS id, d.user_id, d.organization_id, d.month, pg_temp.seed_next_workday(d.raw_day) AS expense_date,
       k.category, k.sub_category, k.billing_type, k.currency AS original_currency, k.comment,
       round((k.low + pg_temp.seed_rnd(d.key || ':amount') * (k.high - k.low))::numeric, 2) AS original_value,
       CASE WHEN k.billing_type = 'billable'
            THEN (ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccd']::uuid[])[1 + floor(pg_temp.seed_rnd(d.key || ':project') * 2)::int]
            WHEN k.billing_type = 'internal' THEN 'cccccccc-cccc-cccc-cccc-ccccccccccce'::uuid END AS project_id
FROM dated d
JOIN kinds k ON k.n = floor(pg_temp.seed_rnd(d.key || ':kind') * 8)::int;

DELETE FROM seed_expenses
WHERE expense_date >= (now() AT TIME ZONE 'Europe/Zurich')::date
   OR expense_date < (SELECT COALESCE(m.start_date, m.joined_at::date) FROM organization_memberships m
                      WHERE m.organization_id = seed_expenses.organization_id AND m.user_id = seed_expenses.user_id)
   OR date_trunc('month', expense_date) <> month;

INSERT INTO expenses (id, user_id, organization_id, project_id, expense_date, category, sub_category,
                      original_value, original_currency, currency, quantity, value, comment)
SELECT id, user_id, organization_id, project_id, expense_date, category, sub_category,
       original_value, original_currency, 'CHF', CASE WHEN category = 'supplies' THEN 1 END,
       CASE WHEN original_currency = 'EUR' THEN round(original_value * 0.94, 2) ELSE original_value END, comment
FROM seed_expenses
ON CONFLICT (id) DO NOTHING;

-- One expense report per person and month with expenses: finished, approved for the last two
-- months (waiting for processing), in preparation for the current month.
INSERT INTO expense_reports (id, organization_id, user_id, status, date_submitted, reviewed_by_user_id, reviewed_at, data)
SELECT pg_temp.seed_id(r.user_id || ':expense-report:' || r.month), r.organization_id, r.user_id,
       CASE WHEN r.month = r.this_month THEN 'in_preparation'
            WHEN r.month >= r.this_month - INTERVAL '2 months' THEN 'approved' ELSE 'finished' END,
       CASE WHEN r.month < r.this_month THEN ((r.month + INTERVAL '1 month 1 day')::timestamp + TIME '16:00') AT TIME ZONE 'Europe/Zurich' END,
       CASE WHEN r.month < r.this_month THEN pg_temp.seed_manager(r.organization_id, r.user_id, (r.month + INTERVAL '1 month - 1 day')::date) END,
       CASE WHEN r.month < r.this_month THEN least(now(), ((r.month + INTERVAL '1 month 4 days')::timestamp + TIME '10:30') AT TIME ZONE 'Europe/Zurich') END,
       '{}'::jsonb
FROM (
  SELECT DISTINCT user_id, organization_id, month, date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date)::date AS this_month
  FROM seed_expenses
) r
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_report_items (id, expense_report_id, expense_id, organization_id)
SELECT pg_temp.seed_id(e.id || ':item'), pg_temp.seed_id(e.user_id || ':expense-report:' || e.month), e.id, e.organization_id
FROM seed_expenses e
WHERE EXISTS (SELECT 1 FROM expense_reports r WHERE r.id = pg_temp.seed_id(e.user_id || ':expense-report:' || e.month))
ON CONFLICT DO NOTHING;

-- The workflows behind the demo reports, as the API records them (api/workflow.ts EXPENSE_REPORT_STEPS:
-- the manager approves, HR processes, HR confirms the payment): the submitted report waits for its
-- manager, approved ones wait for processing with whoever holds expense processing (HR), finished
-- ones are done. Only reports without a workflow get one, so re-seeding a live demo adds no copies.
INSERT INTO workflow_definitions (organization_id, name, description, steps)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve expense report', 'A submitted expense report: the manager approves it, then it is processed and paid.', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'approve expense report');
UPDATE workflow_definitions SET steps = '[
  {"key": "manager_review", "label": "Manager review", "assignTo": "manager", "onApprove": {"action": "expense.approve"}, "onReject": {"action": "expense.reject"}, "source": "Expense Report", "source_name": "getExpenseReportTitle"},
  {"key": "processing", "label": "Processing", "assignTo": "permission:nav.expenseProcessing", "onApprove": {"action": "expense.process"}, "onReject": {"action": "none"}, "rejectable": false, "inDialog": true, "doneKey": "expenseProcessing.stage.processing_finished", "actionKey": "expenseProcessing.stepProcess", "source": "Expense Report", "source_name": "getExpenseReportTitle"},
  {"key": "payment", "label": "Payment", "assignTo": "permission:nav.expenseProcessing", "onApprove": {"action": "expense.paid"}, "onReject": {"action": "none"}, "rejectable": false, "doneKey": "expenseProcessing.event.paid", "actionKey": "expenseProcessing.stepPaid", "source": "Expense Report", "source_name": "getExpenseReportTitle"}
]'::jsonb
WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'approve expense report' AND steps = '[]'::jsonb;

DROP TABLE IF EXISTS pg_temp.seed_processors;
CREATE TEMP TABLE seed_processors AS
SELECT DISTINCT m.organization_id, m.user_id
FROM organization_memberships m
JOIN membership_roles mr ON mr.membership_id = m.id
JOIN role_permissions rp ON rp.role_id = mr.role_id
WHERE rp.permission_id = 'nav.expenseProcessing:edit:all' AND m.status = 'active';

INSERT INTO workflows (workflow_id, workflow_def_id, source_table, source_table_uuid, workflow_data, workflow_started,
                       workflow_finished, step, step_status, workflow_step_started, workflow_step_finished, assigned_to_user_id)
SELECT DISTINCT ON (r.id) pg_temp.seed_id(r.id || ':workflow'), d.workflow_def_id, 'expense_reports', r.id,
       jsonb_build_object('note', NULL, 'submittedByUserId', r.user_id, 'history',
         jsonb_build_array(jsonb_build_object('key', 'approvals.event.submitted', 'by', r.user_id, 'at', r.date_submitted))
         || CASE WHEN r.status <> 'submitted' THEN jsonb_build_array(jsonb_build_object(
              'key', 'approvals.event.approved', 'by', r.reviewed_by_user_id, 'at', r.reviewed_at, 'note', NULL)) ELSE '[]'::jsonb END
         || CASE WHEN r.status = 'finished' THEN jsonb_build_array(
              jsonb_build_object('key', 'expenseProcessing.stage.processing_finished', 'by', p.user_id, 'at', r.reviewed_at + interval '1 day'),
              jsonb_build_object('key', 'expenseProcessing.event.paid', 'by', p.user_id, 'at', r.reviewed_at + interval '3 days')) ELSE '[]'::jsonb END),
       r.date_submitted,
       CASE WHEN r.status = 'finished' THEN r.reviewed_at + interval '3 days' END,
       CASE r.status WHEN 'submitted' THEN 'manager_review' WHEN 'finished' THEN 'payment' ELSE 'processing' END,
       CASE WHEN r.status = 'finished' THEN 'approved' ELSE 'pending' END,
       CASE WHEN r.status = 'submitted' THEN r.date_submitted ELSE r.reviewed_at END,
       CASE WHEN r.status = 'finished' THEN r.reviewed_at + interval '3 days' END,
       CASE WHEN r.status = 'submitted' THEN ARRAY[pg_temp.seed_manager(r.organization_id, r.user_id, CURRENT_DATE)]
            WHEN r.status = 'approved' THEN ARRAY(SELECT sp.user_id FROM seed_processors sp WHERE sp.organization_id = r.organization_id ORDER BY sp.user_id)
            ELSE ARRAY[COALESCE(p.user_id, r.reviewed_by_user_id)] END
FROM expense_reports r
JOIN workflow_definitions d ON d.organization_id = r.organization_id AND d.name = 'approve expense report'
LEFT JOIN LATERAL (SELECT sp.user_id FROM seed_processors sp WHERE sp.organization_id = r.organization_id ORDER BY sp.user_id LIMIT 1) p ON true
WHERE r.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND r.status IN ('submitted', 'approved', 'finished')
  AND r.date_submitted IS NOT NULL
  AND (r.status = 'submitted' OR r.reviewed_at IS NOT NULL)
  AND (r.status <> 'submitted' OR pg_temp.seed_manager(r.organization_id, r.user_id, CURRENT_DATE) IS NOT NULL)
  AND (r.status <> 'approved' OR EXISTS (SELECT 1 FROM seed_processors sp WHERE sp.organization_id = r.organization_id))
  AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.source_table = 'expense_reports' AND w.source_table_uuid = r.id)
ORDER BY r.id, d.workflow_def_id
ON CONFLICT (workflow_id) DO NOTHING;
