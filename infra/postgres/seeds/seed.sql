-- seed.sql — demo users, org, roles, project + project times + static data.
-- Runs on a migrated database (Liquibase changelogs).
--
-- Additive and re-runnable: every row has a fixed key and `ON CONFLICT DO NOTHING`, and the
-- UPDATEs only fill in values that are still unset. Running it again adds what is missing and
-- leaves changed demo data (passwords, reporting lines, translations) alone. The VPS `seed`
-- action relies on this; `reset-seed` drops the schema first for a clean state.


INSERT INTO users (id, email, display_name, first_name, last_name, locale, timezone, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@acme.com', 'Admin AG', 'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'alice@acme.com', 'Alice A',         'Alice',  'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222223', 'adam@acme.com',  'Adam A' ,         'Adam',   'Admin',   'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222224', 'marta@acme.com', 'Marta A',         'Marta',  'Manager', 'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222225', 'marco@acme.com', 'Marco A',         'Marco',  'Manager', 'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222226', 'ulla@acme.com',  'Ulla A' ,         'Ulla',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222227', 'ueli@acme.com',  'Ueli A' ,         'Ueli',   'User',    'de', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222228', 'uma@acme.com',   'Uma A'  ,         'Uma'  ,  'User',    'en', 'Europe/Zurich', 'active'),
  ('22222222-2222-2222-2222-222222222229', 'fido@acme.com',  'Fido A' ,         'Fido' ,  'Finance', 'de', 'Europe/Zurich', 'active')
ON CONFLICT (email) DO NOTHING;

-- Directory: the demo users' internal phone (basic data phone1) and a fantasy portrait. Avatars are
-- URL-encoded copies of infra/postgres/seeds/avatars/*.svg (users.avatar_url holds at most 1024
-- characters, too few for base64; test/api/branding.test.ts checks they match).
-- Only filled in while unset, so re-seeding keeps what people changed.
UPDATE users u
SET avatar_url = COALESCE(u.avatar_url, v.avatar),
    basicdata = CASE WHEN u.basicdata ? 'phone1' THEN u.basicdata ELSE u.basicdata || jsonb_build_object('phone1', v.phone) END
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111', '+41 44 555 12 00', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%232dd4bf''/><stop offset=''1'' stop-color=''%230f766e''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%231e293b''/><g fill=''%23f1c7a3''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><path d=''M30 40c0-12 8-20 18-20s18 8 18 20c-4-6-10-8-18-8s-14 2-18 8z'' fill=''%233f3f46''/><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/><g fill=''none'' stroke=''%231f2937'' stroke-width=''2''><circle cx=''41'' cy=''46'' r=''5''/><circle cx=''55'' cy=''46'' r=''5''/><path d=''M46 46h4''/></g></svg>'),
  ('22222222-2222-2222-2222-222222222222', '+41 44 555 12 01', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%23c4b5fd''/><stop offset=''1'' stop-color=''%237c3aed''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%23f472b6''/><g fill=''%23f5d0b5''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><path d=''M27 46c0-16 9-26 21-26s21 10 21 26v22h-8V46c-4-6-8-9-13-9s-9 3-13 9v22h-8z'' fill=''%23b45309''/><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/><g fill=''%23facc15''><circle cx=''33'' cy=''54'' r=''2''/><circle cx=''63'' cy=''54'' r=''2''/></g></svg>'),
  ('22222222-2222-2222-2222-222222222223', '+41 44 555 12 02', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%2393c5fd''/><stop offset=''1'' stop-color=''%231d4ed8''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%230f172a''/><g fill=''%23d6a07a''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><path d=''M30 40c0-12 8-20 18-20s18 8 18 20c-4-6-10-8-18-8s-14 2-18 8z'' fill=''%231c1917''/><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/><path d=''M36 52c2 10 6 14 12 14s10-4 12-14c-3 4-7 6-12 6s-9-2-12-6z'' fill=''%231c1917''/></svg>'),
  ('22222222-2222-2222-2222-222222222224', '+41 44 555 12 10', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%23fda4af''/><stop offset=''1'' stop-color=''%23be123c''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%23334155''/><g fill=''%23f0c19b''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><g fill=''%237c2d12''><circle cx=''48'' cy=''17'' r=''7''/><path d=''M30 41c0-12 8-20 18-20s18 8 18 20c-5-5-11-7-18-7s-13 2-18 7z''/></g><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/><g fill=''none'' stroke=''%231f2937'' stroke-width=''2''><circle cx=''41'' cy=''46'' r=''5''/><circle cx=''55'' cy=''46'' r=''5''/><path d=''M46 46h4''/></g></svg>'),
  ('22222222-2222-2222-2222-222222222225', '+41 44 555 12 20', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%23fdba74''/><stop offset=''1'' stop-color=''%23c2410c''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%23065f46''/><g fill=''%23c98a63''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><g fill=''%23292524''><circle cx=''34'' cy=''30'' r=''7''/><circle cx=''42'' cy=''24'' r=''7''/><circle cx=''50'' cy=''23'' r=''7''/><circle cx=''58'' cy=''26'' r=''7''/><circle cx=''64'' cy=''33'' r=''7''/><circle cx=''31'' cy=''38'' r=''7''/><circle cx=''66'' cy=''40'' r=''7''/></g><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/></svg>'),
  ('22222222-2222-2222-2222-222222222226', '+41 44 555 12 30', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%236ee7b7''/><stop offset=''1'' stop-color=''%23047857''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%237c3aed''/><g fill=''%23f8d9c0''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><path d=''M27 46c0-16 9-26 21-26s21 10 21 26v22h-8V46c-4-6-8-9-13-9s-9 3-13 9v22h-8z'' fill=''%23facc15''/><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/></svg>'),
  ('22222222-2222-2222-2222-222222222227', '+41 44 555 12 21', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%237dd3fc''/><stop offset=''1'' stop-color=''%230369a1''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%23b91c1c''/><g fill=''%23eab38e''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><path d=''M30 38c0-11 8-18 18-18s18 7 18 18z'' fill=''%23dc2626''/><path d=''M60 37h14v4H58z'' fill=''%23991b1b''/><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/></svg>'),
  ('22222222-2222-2222-2222-222222222228', '+41 44 555 12 11', 'data:image/svg+xml,<svg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 96 96''><linearGradient id=''g'' x2=''1'' y2=''1''><stop stop-color=''%23f0abfc''/><stop offset=''1'' stop-color=''%23a21caf''/></linearGradient><circle cx=''48'' cy=''48'' r=''48'' fill=''url(%23g)''/><path d=''M18 96c2-16 14-24 30-24s28 8 30 24z'' fill=''%23f59e0b''/><g fill=''%238d5a3b''><rect x=''43'' y=''60'' width=''10'' height=''12'' rx=''4''/><ellipse cx=''48'' cy=''46'' rx=''16'' ry=''18''/></g><g fill=''%23111827''><circle cx=''34'' cy=''30'' r=''7''/><circle cx=''42'' cy=''24'' r=''7''/><circle cx=''50'' cy=''23'' r=''7''/><circle cx=''58'' cy=''26'' r=''7''/><circle cx=''64'' cy=''33'' r=''7''/><circle cx=''31'' cy=''38'' r=''7''/><circle cx=''66'' cy=''40'' r=''7''/></g><g fill=''%231f2937''><circle cx=''41'' cy=''46'' r=''1.8''/><circle cx=''55'' cy=''46'' r=''1.8''/></g><path d=''M42 55q6 5 12 0'' fill=''none'' stroke=''%239f1239'' stroke-width=''2'' stroke-linecap=''round''/><g fill=''%23facc15''><circle cx=''33'' cy=''54'' r=''2''/><circle cx=''63'' cy=''54'' r=''2''/></g></svg>')
) AS v(id, phone, avatar)
WHERE u.id = v.id::uuid AND (u.avatar_url IS NULL OR NOT u.basicdata ? 'phone1');

INSERT INTO organizations (id, slug, name, type, country, created_by_user_id, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'acme', 'Acme Corp', 'enterprise', 'CH', '11111111-1111-1111-1111-111111111111', TRUE),
  -- Second org so the web app's organization switcher has something to switch between in the demo.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'globx', 'Globx Inc', 'team', 'US', '11111111-1111-1111-1111-111111111111', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Look and feel (organizations.settings.branding, edited in Organization settings). Logos are
-- base64 copies of infra/postgres/seeds/branding/*.svg (test/api/branding.test.ts checks they
-- match). Only set while an organization has no branding, so re-seeding keeps an admin's choice.
-- Globx has a dark sidebar, to show that the sidebar text switches to light.
UPDATE organizations o
SET settings = o.settings || jsonb_build_object('branding', v.branding::jsonb)
FROM (VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"headerColor":"#1e3a8a","backgroundColor":"#f5f7fc","sidebarColor":"#ffffff","logo":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzM4YmRmOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM0ZjQ2ZTUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjEiIHk9IjEiIHdpZHRoPSI2MiIgaGVpZ2h0PSI2MiIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC40NSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPHBhdGggZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMjcgMTFoMTBsMTUgNDFINDJsLTMtOUgyNWwtMyA5SDEyem01IDEzLTQuNyAxM2g5LjR6Ii8+CiAgPHBhdGggZmlsbD0iI2ZiYmYyNCIgZD0iTTUwIDhsMS45IDQuNkw1Ni41IDE0bC00LjYgMS45TDUwIDIwLjVsLTEuOS00LjZMNDMuNSAxNGw0LjYtMS40eiIvPgo8L3N2Zz4K"}'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '{"headerColor":"#5b21b6","backgroundColor":"#f6f5fb","sidebarColor":"#2e1065","logo":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2E3OGJmYSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM0YzFkOTUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjEiIHk9IjEiIHdpZHRoPSI2MiIgaGVpZ2h0PSI2MiIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC40NSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPGcgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2UtbGluZWNhcD0icm91bmQiPgogICAgPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMTUiIHN0cm9rZS13aWR0aD0iMyIvPgogICAgPGVsbGlwc2UgY3g9IjMyIiBjeT0iMzIiIHJ4PSI2LjUiIHJ5PSIxNSIgc3Ryb2tlLXdpZHRoPSIyLjQiLz4KICAgIDxwYXRoIGQ9Ik0xNy41IDI3aDI5TTE3LjUgMzdoMjkiIHN0cm9rZS13aWR0aD0iMi40Ii8+CiAgPC9nPgogIDxlbGxpcHNlIGN4PSIzMiIgY3k9IjMyIiByeD0iMjYiIHJ5PSI4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmYmJmMjQiIHN0cm9rZS13aWR0aD0iMy4yIiB0cmFuc2Zvcm09InJvdGF0ZSgtMjggMzIgMzIpIi8+CiAgPGNpcmNsZSBjeD0iNTQuNSIgY3k9IjIwIiByPSIzLjIiIGZpbGw9IiNmYmJmMjQiLz4KPC9zdmc+Cg=="}')
) AS v(id, branding)
WHERE o.id = v.id::uuid AND NOT (o.settings ? 'branding');

-- Public holidays follow a canton (organizations.settings.holidayRegion, Organization settings ->
-- Working time and holidays). Only set while an organization has none.
UPDATE organizations o
SET settings = o.settings || jsonb_build_object('holidayRegion', v.region)
FROM (VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ZH'), ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'GE')) AS v(id, region)
WHERE o.id = v.id::uuid AND NOT jsonb_exists(o.settings, 'holidayRegion');

-- Acme marks home-office sessions (work-time settings `homeOffice`, off by default). Only set while unset.
UPDATE organizations SET settings = settings || '{"homeOffice": true}'::jsonb
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND NOT jsonb_exists(settings, 'homeOffice');

INSERT INTO roles(id, organization_id, "name", description, is_system_role, settings, translations, admin_user_ids) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'owner', 'Full organization owner and legal contact', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'admin', 'Organization administrator', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000003'::uuid, NULL, 'member', 'Standard collaborator with read/write access', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000004'::uuid, NULL, 'guest', 'Restricted access to tbd', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000005'::uuid, NULL, 'billing_admin', 'Can manage billing and subscription tiers only', true, '{}'::jsonb, '{}'::jsonb, '{}'),
  ('00000000-0000-0000-0000-000000000006'::uuid, NULL, 'manager', 'Manager with team, project, and subproject access', true, '{}'::jsonb, '{}'::jsonb, '{}')
ON CONFLICT DO NOTHING;

-- Memberships: admin->admin role, manager->manager role, user->member role
INSERT INTO organization_memberships (id, organization_id, user_id, status, joined_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'active', to_date('2023-02-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222223', 'active', to_date('2021-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222224', 'active', to_date('2020-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333334', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222225', 'active', to_date('2022-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222226', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333336', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'active', to_date('2024-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222228', 'active', to_date('2025-01-01', 'YYYY-MM-DD')),
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444445', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222229', 'active', to_date('2024-06-01', 'YYYY-MM-DD')),

  -- admin is also admin of Globex; manager is only a plain member there — same person, different role per org.
  ('eeeeeeee-eeee-eeee-eeee-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'active', to_date('2023-01-01', 'YYYY-MM-DD')),
  ('eeeeeeee-eeee-eeee-eeee-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'active', to_date('2023-01-01', 'YYYY-MM-DD'))
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Employment start: the seeded joined_at date (only where none is set yet).
UPDATE organization_memberships SET start_date = joined_at::date
WHERE organization_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
  AND start_date IS NULL AND joined_at IS NOT NULL;

-- Acme departments, each with a default leader (only a default: the manager is set per person).
-- Each with its code (workflows name departments by it: `department:hr`).
INSERT INTO departments (id, organization_id, name, leader_user_id, sort_order, code) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Administration', '22222222-2222-2222-2222-222222222222', 1, 'administration'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HR', '22222222-2222-2222-2222-222222222226', 2, 'hr'),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sales', '22222222-2222-2222-2222-222222222224', 3, 'sales'),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Marketing', '22222222-2222-2222-2222-222222222222', 4, 'marketing'),
  ('dddddddd-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Research & Development', '22222222-2222-2222-2222-222222222223', 5, 'research-development'),
  -- Finance (Fido): the expenses plugin's seed sends Acme's payment runs to it (`department:finance`).
  ('dddddddd-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Finance', '22222222-2222-2222-2222-222222222229', 7, 'finance')
ON CONFLICT DO NOTHING;
-- Databases seeded before codes existed: fill in the ones still missing.
UPDATE departments d SET code = v.code
FROM (VALUES ('dddddddd-0000-0000-0000-000000000001', 'administration'), ('dddddddd-0000-0000-0000-000000000002', 'hr'),
             ('dddddddd-0000-0000-0000-000000000003', 'sales'), ('dddddddd-0000-0000-0000-000000000004', 'marketing'),
             ('dddddddd-0000-0000-0000-000000000005', 'research-development')) AS v(id, code)
WHERE d.id = v.id::uuid AND d.code IS NULL
  AND NOT EXISTS (SELECT 1 FROM departments o WHERE o.organization_id = d.organization_id AND o.code = v.code);
-- Marketing has no one yet: Alice leads it (databases seeded before had it without a leader).
UPDATE departments SET leader_user_id = '22222222-2222-2222-2222-222222222222'
WHERE id = 'dddddddd-0000-0000-0000-000000000004' AND leader_user_id IS NULL;

-- Acme is a company already set up, so its admins see no "Set up your organization" checklist on Home
-- (setup.controller.ts: done once every required step is). Its work-time rules are written down as the
-- defaults they are anyway (40-hour week, Working Hours Act maximum 45 hours, 15 minutes project time
-- tolerance), so nothing counts differently; values already set stay.
UPDATE organizations
SET settings = jsonb_build_object('fullTimeWeeklyMinutes', 2400, 'legalMaxWeeklyMinutes', 2700, 'projectTimeToleranceMinutes', 15) || settings
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Acme reporting lines, dated (employee_assignments; approvals route to the manager in force):
--   Alice  -> Admin, Adam
--   Adam   -> Marta, Marco, Uma
--   Marta  -> Ulla, and Ueli until mid-2025 (Sales), when he moved to R&D under Marco
--   Marco  -> Ueli
-- valid_from is each person's start date, so rows the 050 migration made from an old manager
-- column are the same rows (the natural key is the row's key): only their unset department and
-- function get filled in.
INSERT INTO employee_assignments (organization_id, user_id, valid_from, department_id, job_function, manager_user_id)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v.user_id::uuid,
       COALESCE(v.valid_from::date, m.start_date, m.joined_at::date), v.department_id::uuid, v.job_function, v.manager_user_id::uuid
FROM (VALUES
  ('22222222-2222-2222-2222-222222222222', NULL, 'dddddddd-0000-0000-0000-000000000001', 'Managing Director', NULL),                                    -- Alice
  ('11111111-1111-1111-1111-111111111111', NULL, 'dddddddd-0000-0000-0000-000000000001', 'System Administrator', '22222222-2222-2222-2222-222222222222'), -- Admin <- Alice
  ('22222222-2222-2222-2222-222222222223', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Head of R&D', '22222222-2222-2222-2222-222222222222'),          -- Adam  <- Alice
  ('22222222-2222-2222-2222-222222222224', NULL, 'dddddddd-0000-0000-0000-000000000003', 'Head of Sales', '22222222-2222-2222-2222-222222222223'),        -- Marta <- Adam
  ('22222222-2222-2222-2222-222222222225', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Team Lead', '22222222-2222-2222-2222-222222222223'),            -- Marco <- Adam
  ('22222222-2222-2222-2222-222222222228', NULL, 'dddddddd-0000-0000-0000-000000000005', 'Software Developer', '22222222-2222-2222-2222-222222222223'),   -- Uma   <- Adam
  ('22222222-2222-2222-2222-222222222226', NULL, 'dddddddd-0000-0000-0000-000000000002', 'HR Specialist', '22222222-2222-2222-2222-222222222224'),        -- Ulla  <- Marta
  ('22222222-2222-2222-2222-222222222227', NULL, 'dddddddd-0000-0000-0000-000000000003', 'Sales Assistant', '22222222-2222-2222-2222-222222222224'),      -- Ueli  <- Marta (Sales)
  ('22222222-2222-2222-2222-222222222227', '2025-07-01', 'dddddddd-0000-0000-0000-000000000005', 'Software Developer', '22222222-2222-2222-2222-222222222225'), -- Ueli  <- Marco (R&D)
  ('22222222-2222-2222-2222-222222222229', NULL, 'dddddddd-0000-0000-0000-000000000007', 'Accountant', '22222222-2222-2222-2222-222222222222')          -- Fido  <- Alice (Finance)
) AS v(user_id, valid_from, department_id, job_function, manager_user_id)
JOIN organization_memberships m ON m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.user_id = v.user_id::uuid
ON CONFLICT (organization_id, user_id, valid_from) DO UPDATE
SET department_id = COALESCE(employee_assignments.department_id, EXCLUDED.department_id),
    job_function = COALESCE(employee_assignments.job_function, EXCLUDED.job_function);

-- Acme's vacation rules (095): 25 days, management 28, from 60 five more. Alice (born 1964) and Adam are
-- management, so Alice shows both. Only while Acme has no rules, so re-seeding keeps what was changed
-- (the flag is set with them; the UPDATE of the rules comes last).
UPDATE employee_assignments a SET is_management = true
FROM organizations o
WHERE o.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND NOT COALESCE(o.settings -> 'vacation', '{}'::jsonb) ? 'rules'
  AND a.organization_id = o.id
  AND a.user_id IN ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222223');

UPDATE users u
SET basicdata = jsonb_set(u.basicdata, '{orgs}', COALESCE(u.basicdata -> 'orgs', '{}'::jsonb) || jsonb_build_object(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      COALESCE(u.basicdata -> 'orgs' -> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb) || jsonb_build_object('birthDate', v.born)))
FROM (VALUES
  ('22222222-2222-2222-2222-222222222222', '1964-03-15'),
  ('22222222-2222-2222-2222-222222222223', '1981-09-02')
) AS v(id, born)
WHERE u.id = v.id::uuid AND NOT u.basicdata ? 'birthDate'
  AND NOT COALESCE(u.basicdata -> 'orgs' -> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb) ? 'birthDate';

-- Personnel numbers (Acme's own, as HR's form stores them: basicdata.orgs.<org>.personnelNumber), 1001 onwards in a
-- fixed order; expense processing and the payroll export need one. Only where Acme has none yet.
UPDATE users u
SET basicdata = jsonb_set(COALESCE(u.basicdata, '{}'::jsonb), '{orgs}', COALESCE(u.basicdata -> 'orgs', '{}'::jsonb) || jsonb_build_object(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      COALESCE(u.basicdata -> 'orgs' -> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb) || jsonb_build_object('personnelNumber', (1000 + m.n)::text)))
FROM (
  SELECT user_id, row_number() OVER (ORDER BY user_id) AS n
  FROM organization_memberships WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) AS m
WHERE u.id = m.user_id
  AND NOT COALESCE(u.basicdata -> 'orgs' -> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}'::jsonb) ? 'personnelNumber'
  AND NOT COALESCE(u.basicdata -> 'orgs' -> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' -> 'personalien', '{}'::jsonb) ? 'personnelNumber';

UPDATE organizations
SET settings = settings || jsonb_build_object('vacation', '{"probationMonths": 1}'::jsonb || COALESCE(settings -> 'vacation', '{}'::jsonb)
      || '{"rules": [{"validFrom": "2000-01-01", "baseDays": 25, "managementDays": 28, "ageSteps": [{"age": 60, "days": 5}]}]}'::jsonb)
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND NOT COALESCE(settings -> 'vacation', '{}'::jsonb) ? 'rules';

-- Acme's locations (087): the Zurich office, where everyone works, with Zurich's own Knabenschiessen
-- (Monday afternoon after the second weekend of September), and a Geneva office, nobody there yet, to show
-- another canton's holidays. Assignments only get the location while they have none.
INSERT INTO locations (id, organization_id, name, canton, municipality) VALUES
  ('10ca7100-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Büro Zürich', 'ZH', 'Zürich'),
  ('10ca7100-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bureau Genève', 'GE', 'Genève')
ON CONFLICT DO NOTHING;

UPDATE employee_assignments SET location_id = '10ca7100-0000-0000-0000-000000000001'
WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND location_id IS NULL;

INSERT INTO org_holidays (organization_id, date, name, fraction, observed, location_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-09-15', 'Knabenschiessen', 0.5, true, '10ca7100-0000-0000-0000-000000000001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-14', 'Knabenschiessen', 0.5, true, '10ca7100-0000-0000-0000-000000000001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2027-09-13', 'Knabenschiessen', 0.5, true, '10ca7100-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Roles per membership (a membership can hold more than one). Everyone who manages someone
-- above holds the manager role; Ulla is also hr, Uma also developer.
INSERT INTO membership_roles (membership_id, role_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', '00000000-0000-0000-0000-000000000002'), -- Admin: admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', '00000000-0000-0000-0000-000000000006'), -- Alice: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', '00000000-0000-0000-0000-000000000001'), -- Alice: owner (decides who is admin and HR)
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222222', '00000000-0000-0000-0000-000000000002'), -- Alice: admin too (request types and workflows by one person, as in a small firm)
  ('aaaaaaaa-aaaa-aaaa-aaaa-222222222223', '00000000-0000-0000-0000-000000000006'), -- Adam: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333333', '00000000-0000-0000-0000-000000000006'), -- Marta: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333334', '00000000-0000-0000-0000-000000000006'), -- Marco: manager
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', '00000000-0000-0000-0000-000000000003'), -- Ulla: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333335', '00000000-0000-0000-0000-000000000007'), -- Ulla: hr
  ('aaaaaaaa-aaaa-aaaa-aaaa-333333333336', '00000000-0000-0000-0000-000000000003'), -- Ueli: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', '00000000-0000-0000-0000-000000000003'), -- Uma: member
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444444', '00000000-0000-0000-0000-000000000008'), -- Uma: developer
  ('aaaaaaaa-aaaa-aaaa-aaaa-444444444445', '00000000-0000-0000-0000-000000000003'), -- Fido: member (the expenses plugin's seed adds Acme's role finance)
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '00000000-0000-0000-0000-000000000002'),
  ('eeeeeeee-eeee-eeee-eeee-111111111111', '00000000-0000-0000-0000-000000000001'), -- Globex: Admin created it and owns it
  ('eeeeeeee-eeee-eeee-eeee-222222222222', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (membership_id, role_id) DO NOTHING;

-- Demo form designer: admin@acme.com edits Acme's form template (developer). It is no operator: each instance
-- gets its own operator account from its deploy (`operators ensure`, OPERATOR_PASSWORD), and operators must use
-- two-step login, which a published demo login could not.
INSERT INTO membership_roles (membership_id, role_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-111111111111', '00000000-0000-0000-0000-000000000008')
ON CONFLICT (membership_id, role_id) DO NOTHING;

INSERT INTO teams (id, organization_id, name, description, lead_user_id, code)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Platform', 'Platform team', '22222222-2222-2222-2222-222222222222', 'platform')
ON CONFLICT (organization_id, name) DO NOTHING;

-- People & Culture, led by Ulla (HR), and Product Development, led by Marco (R&D).
INSERT INTO teams (id, organization_id, name, description, lead_user_id, code)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'People & Culture', 'HR, onboarding and internal events', '22222222-2222-2222-2222-222222222226', 'people-culture'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Product Development', 'Builds and runs the customer projects', '22222222-2222-2222-2222-222222222225', 'product-development')
ON CONFLICT (organization_id, name) DO NOTHING;
-- Databases seeded before codes existed: fill in the ones still missing.
UPDATE teams t SET code = v.code
FROM (VALUES ('Platform', 'platform'), ('People & Culture', 'people-culture'), ('Product Development', 'product-development')) AS v(name, code)
WHERE t.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND t.name = v.name AND t.code IS NULL
  AND NOT EXISTS (SELECT 1 FROM teams o WHERE o.organization_id = t.organization_id AND o.code = v.code);

-- Members by membership (see organization_memberships above); a team's lead is set on the team.
INSERT INTO team_members (team_id, membership_id)
SELECT t.id, v.membership_id::uuid
FROM (VALUES
  ('Platform', 'aaaaaaaa-aaaa-aaaa-aaaa-333333333333'),            -- Marta
  ('People & Culture', 'aaaaaaaa-aaaa-aaaa-aaaa-111111111111'),    -- Admin
  ('People & Culture', 'aaaaaaaa-aaaa-aaaa-aaaa-333333333336'),    -- Ueli
  ('People & Culture', 'aaaaaaaa-aaaa-aaaa-aaaa-444444444444'),    -- Uma
  ('Product Development', 'aaaaaaaa-aaaa-aaaa-aaaa-222222222223'), -- Adam
  ('Product Development', 'aaaaaaaa-aaaa-aaaa-aaaa-333333333336'), -- Ueli
  ('Product Development', 'aaaaaaaa-aaaa-aaaa-aaaa-444444444444')  -- Uma
) AS v(team_name, membership_id)
JOIN teams t ON t.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND t.name = v.team_name
ON CONFLICT (team_id, membership_id) DO NOTHING;

INSERT INTO projects (id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Website FIFA Relaunch', '22222222-2222-2222-2222-222222222222', 'COST-100', 'customer'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Microsoft 365 Intro @ UBS', '22222222-2222-2222-2222-222222222222', 'COST-101', 'customer'),
       ('cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme Internal Project', '22222222-2222-2222-2222-222222222222', 'COST-102', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subprojects (id, project_id, organization_id, name, owner_user_id, cost_item, type)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Design phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Implementation phase', '22222222-2222-2222-2222-222222222222', 'COST-101', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-cccccccccccd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '365 Status Assessment', '22222222-2222-2222-2222-222222222222', 'COST-102', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd3', 'cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Novatime Migration', '22222222-2222-2222-2222-222222222222', 'COST-103', 'phase'),
       ('dddddddd-dddd-dddd-dddd-ddddddddddd4', 'cccccccc-cccc-cccc-cccc-ccccccccccce', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Novatime Replacement', '22222222-2222-2222-2222-222222222222', 'COST-104', 'phase')
ON CONFLICT (id) DO NOTHING;

-- Customers (127): two fictitious customers of Acme's two customer projects, with their contact people, and each
-- project's customer, the customer's reference ("Ihre Referenz") and the contact it goes to ("z. H."). The billing
-- plugin bills them (its seed adds the rates); a database seeded before keeps what was set by hand.
INSERT INTO customers (id, organization_id, name, street, house_number, zip, city, country, email, language)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fussballverband Muster',
   'Stadionweg', '12', '8044', 'Zürich', 'CH', 'buchhaltung@fussballverband.example', 'de'),
  ('b1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Banque Exemple SA',
   'Rue du Marché', '5', '1204', 'Genève', 'CH', 'factures@banque.example', 'fr')
ON CONFLICT DO NOTHING;
INSERT INTO customer_contacts (id, organization_id, customer_id, name, role, email, phone, sort)
VALUES
  ('b2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b1000000-0000-0000-0000-000000000001',
   'Frau Petra Beispiel', 'Buchhaltung', 'buchhaltung@fussballverband.example', '044 555 20 10', 0),
  ('b2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b1000000-0000-0000-0000-000000000001',
   'Herr Marco Vorlage', 'Projektleitung Relaunch', 'projekte@fussballverband.example', '044 555 20 22', 1),
  ('b2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b1000000-0000-0000-0000-000000000002',
   'Monsieur Jean Modèle', 'Comptabilité fournisseurs', 'factures@banque.example', '022 555 30 40', 0)
ON CONFLICT DO NOTHING;
UPDATE projects p SET customer_id = v.customer_id::uuid, customer_reference = v.reference, customer_contact_id = v.contact_id::uuid
FROM (VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'b1000000-0000-0000-0000-000000000001', 'Auftrag FV-2026-031', 'b2000000-0000-0000-0000-000000000002'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccd', 'b1000000-0000-0000-0000-000000000002', 'PO 4500-1187', 'b2000000-0000-0000-0000-000000000003')
) AS v(project_id, customer_id, reference, contact_id)
WHERE p.id = v.project_id::uuid AND p.customer_id IS NULL;

INSERT INTO project_times (id, user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
VALUES
  ('99999999-9999-9999-9999-111111111111', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', 'Homepage hero'),
  ('99999999-9999-9999-9999-222222222222', '22222222-2222-2222-2222-222222222226', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '90 minutes', 'Bugfix')
ON CONFLICT DO NOTHING;

-- Global (organization_id = NULL) countries, for nationality and address. Migrations already insert
-- them (and `locales`), so on a migrated database this row is a no-op.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES
  (NULL, 'users', 'countries', '{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"}'::jsonb, '{"en":{"CH":"Switzerland","DE":"Germany","FR":"France","IT":"Italy","AT":"Austria","LI":"Liechtenstein","ES":"Spain","PT":"Portugal","GB":"United Kingdom","US":"United States","CZ":"Czechia","SK":"Slovakia","PL":"Poland","OTHER":"Others"},"de":{"CH":"Schweiz","DE":"Deutschland","FR":"Frankreich","IT":"Italien","AT":"Österreich","LI":"Liechtenstein","ES":"Spanien","PT":"Portugal","GB":"Vereinigtes Königreich","US":"Vereinigte Staaten","CZ":"Tschechien","SK":"Slowakei","PL":"Polen","OTHER":"Andere"},"fr":{"CH":"Suisse","DE":"Allemagne","FR":"France","IT":"Italie","AT":"Autriche","LI":"Liechtenstein","ES":"Espagne","PT":"Portugal","GB":"Royaume-Uni","US":"États-Unis","CZ":"Tchéquie","SK":"Slovaquie","PL":"Pologne","OTHER":"Autres"},"it":{"CH":"Svizzera","DE":"Germania","FR":"Francia","IT":"Italia","AT":"Austria","LI":"Liechtenstein","ES":"Spagna","PT":"Portogallo","GB":"Regno Unito","US":"Stati Uniti","CZ":"Cechia","SK":"Slovacchia","PL":"Polonia","OTHER":"Altri"}}'::jsonb)
ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), entity, enum_name) DO NOTHING;

-- Existing keys win (`default || current`), so a translation edited since is kept.
UPDATE roles SET translations = '{"de":"Administrator"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000002';
UPDATE roles SET translations = '{"de":"Manager"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000006';
UPDATE roles SET translations = '{"de":"Benutzer"}'::jsonb || translations WHERE id = '00000000-0000-0000-0000-000000000003';


-- Local password identities for the demo users: the password is the email's local part
-- (admin@acme.com / admin, adam@acme.com / adam, ...). Lets the web login screen sign in
-- without Keycloak. A password someone changed since is kept (reset-seed restores them all).
INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'password', 'admin@acme.com', '$2a$10$gcYrx7XI8py9JpaAsobCFOmJ/o0OmzqFES7pwVIi11v/PUIPoktda'),
  ('22222222-2222-2222-2222-222222222222', 'password', 'alice@acme.com', '$2a$10$sDt5nGnyeuRLaPxScZLTOu5Ymo5bEi5bjXcICFLrxugvZQlGiA41C'),
  ('22222222-2222-2222-2222-222222222223', 'password', 'adam@acme.com',  '$2a$10$lMAjV/YzxNt39F5nvuD70OrVgQN7wnmj1D4uBTjb8gC5JHMWAtxAu'),
  ('22222222-2222-2222-2222-222222222224', 'password', 'marta@acme.com', '$2a$10$5eHdX767Cv5FlZRrxcfoW.e0ev4Hrv5/bt9h3oizMn0Xar22Zs7cm'),
  ('22222222-2222-2222-2222-222222222225', 'password', 'marco@acme.com', '$2a$10$PaOV5WVXSdHULNumYa/5Aulw.M542lTPczfZxSPPFRJl3dSAawTPC'),
  ('22222222-2222-2222-2222-222222222226', 'password', 'ulla@acme.com',  '$2a$10$2PPuwC7fbSihPj1JprqLteAABeVc4JbtI7FsugBNEdmoLbGYC5Him'),
  ('22222222-2222-2222-2222-222222222227', 'password', 'ueli@acme.com',  '$2a$10$JJiF5sk1UDoMJ.V4rRWDzOil.oagGttPZh9WKuSob4QsedJ7xWnyq'),
  ('22222222-2222-2222-2222-222222222228', 'password', 'uma@acme.com',   '$2a$10$O3mA43NN4tORWX04scyVVuXR.eH1SF3KkUac5oyyBNHtUsPL537wO'),
  ('22222222-2222-2222-2222-222222222229', 'password', 'fido@acme.com',  '$2a$10$S5aqyeKXfmuO2f3.dXAq4eTJ/kUDNrrTzo8aaylhKmmr58Zbb8ox6')
ON CONFLICT (provider, provider_user_id) DO NOTHING;
-- In case you need to force.... DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Demo-account dropdown on the login screen (GET /auth/demo-accounts, public). Global row.
-- Key = dropdown order; value = a JSON string {name, user, password}, kept a string so the
-- Admin Settings static-data editor (flat key -> text) can still show and edit it.
-- Only seeded databases have this row, so production login screens show no dropdown. The other
-- demo users still sign in by typing their email and password.
INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
VALUES (NULL, 'login', 'demo_accounts', '{
  "01": "{\"name\":\"Admin (Acme)\",\"user\":\"admin@acme.com\",\"password\":\"admin\"}",
  "02": "{\"name\":\"Manager (Acme)\",\"user\":\"marta@acme.com\",\"password\":\"marta\"}",
  "03": "{\"name\":\"HR User (Acme)\",\"user\":\"ulla@acme.com\",\"password\":\"ulla\"}",
  "04": "{\"name\":\"User (Acme)\",\"user\":\"ueli@acme.com\",\"password\":\"ueli\"}",
  "05": "{\"name\":\"Team Lead (Acme)\",\"user\":\"marco@acme.com\",\"password\":\"marco\"}"
}'::jsonb, '{}'::jsonb)
ON CONFLICT DO NOTHING;
-- Entries added since (only where the key is missing, so edits made in Admin settings stay).
UPDATE static_data SET "values" = "values" || jsonb_build_object('05', '{"name":"Team Lead (Acme)","user":"marco@acme.com","password":"marco"}')
WHERE organization_id IS NULL AND entity = 'login' AND enum_name = 'demo_accounts' AND NOT ("values" ? '05');
UPDATE static_data SET "values" = "values" || jsonb_build_object('06', '{"name":"Finance (Acme)","user":"fido@acme.com","password":"fido"}')
WHERE organization_id IS NULL AND entity = 'login' AND enum_name = 'demo_accounts' AND NOT ("values" ? '06');

-- Pending invitation for the login screen's "invited user" demo (token: dev-invite-0001).
INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, status, expires_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'invited@acme.com', '00000000-0000-0000-0000-000000000003', 'dev-invite-0001', '11111111-1111-1111-1111-111111111111', 'pending', '2030-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- Demo history for every active Acme member, from their employment start date until yesterday
-- (Europe/Zurich): absences, attendance, project time and both monthly timesheets. Plugins add
-- theirs in their own seed.sql, run after this file in the same transaction, so they can use the
-- pg_temp.seed_* helpers defined below (plugins/expenses/seed.sql: expenses and expense reports).
--
--   * Absences (past only, approved): up to 25 vacation days a year, the entitlement (prorated in
--     the first year): 20-30 are planned and the blocks beyond it left out, so no balance is negative,
--     as a two-week summer holiday, a one-week break and single or short days, sometimes a half
--     day; plus a few sick days. The year's plan does not depend on today, so a later re-seed
--     only adds the blocks that have since passed. Untaken or extra days carry over (the
--     balances compute that).
--   * Attendance (work_times) on every working day without a full-day absence: 1 session on 15%
--     of the days, 2 on 60%, 3 on 20%, 4 on 5%; 7-9 hours a day around the 8-hour target, about
--     half on half-day absences.
--     Working days skip weekends and Zurich's public holidays (Acme's holidayRegion).
--   * Project time: 1-2 entries a day on a project (and subproject), 80-100% of that day's
--     attendance, never more.
--   * Timesheets: every month before the current one is submitted and approved, the working-time
--     one by the manager in force (the API closes it into work_time_months when balances are
--     read), the project one by the project's owner. The current month stays open.
--
-- Pseudo-random but deterministic: values come from md5 of a key (person, day, purpose), and ids
-- are md5-derived too, so a re-run inserts nothing twice. A day on which the person already has
-- attendance or project time (real data, older demo data) is left alone, and so is an absence
-- that would overlap another one or recorded attendance.

CREATE FUNCTION pg_temp.seed_rnd(key text) RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT ('x' || substr(md5(key), 1, 8))::bit(32)::bigint / 4294967296.0 $$;

CREATE FUNCTION pg_temp.seed_id(key text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT md5('worktime3-demo-history:' || key)::uuid $$;

-- Easter Sunday (anonymous Gregorian algorithm, as packages/shared/src/worktime.ts).
CREATE FUNCTION pg_temp.seed_easter(y int) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
BEGIN
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
  g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  RETURN make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
END $$;

-- A working day clock Acme: Monday-Friday and not a Zurich public holiday.
CREATE FUNCTION pg_temp.seed_workday(day date) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e date := pg_temp.seed_easter(extract(year FROM day)::int); md text := to_char(day, 'MM-DD');
BEGIN
  RETURN extract(isodow FROM day) < 6
    AND md NOT IN ('01-01', '01-02', '05-01', '08-01', '12-25', '12-26')
    AND day NOT IN (e - 2, e + 1, e + 39, e + 50);
END $$;

-- The manager in force for a person on a date (employee_assignments), else their first one.
CREATE FUNCTION pg_temp.seed_manager(org uuid, person uuid, day date) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT manager_user_id FROM employee_assignments
  WHERE organization_id = org AND user_id = person
  ORDER BY (valid_from <= day) DESC, CASE WHEN valid_from <= day THEN valid_from END DESC NULLS LAST, valid_from
  LIMIT 1
$$;

-- The last of `n` working days starting clock the first working day on or after `day`.
CREATE FUNCTION pg_temp.seed_span_end(day date, n int) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := day; counted int := 0;
BEGIN
  LOOP
    IF pg_temp.seed_workday(d) THEN
      counted := counted + 1;
      EXIT WHEN counted >= n;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN d;
END $$;

CREATE FUNCTION pg_temp.seed_next_workday(day date) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := day;
BEGIN
  WHILE NOT pg_temp.seed_workday(d) LOOP d := d + 1; END LOOP;
  RETURN d;
END $$;

DO $$
DECLARE
  org constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  tz constant text := 'Europe/Zurich';
  today constant date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  -- Projects and their subprojects (seeded above); comments per project.
  projects constant uuid[] := ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccd', 'cccccccc-cccc-cccc-cccc-ccccccccccce']::uuid[];
  subprojects constant text[] := ARRAY[
    'dddddddd-dddd-dddd-dddd-dddddddddddd,dddddddd-dddd-dddd-dddd-ddddddddddd1',
    'dddddddd-dddd-dddd-dddd-ddddddddddd2,',
    'dddddddd-dddd-dddd-dddd-ddddddddddd3,dddddddd-dddd-dddd-dddd-ddddddddddd4'];
  comments constant text[] := ARRAY[
    'Workshop with the client|Wireframes|Frontend implementation|Code review|Bugfixing|Release preparation|Status meeting',
    'Tenant assessment|Interviews with IT|Licence analysis|Migration plan|Report writing|Steering committee',
    'Data migration scripts|Requirements|Testing|Documentation|Team meeting|Vendor evaluation'];
  p record;
  y int;
  k int;
  attempt int;
  key text;
  range_start date;
  range_end date;
  vacation numeric;
  allowance numeric;
  granted numeric;
  days_off numeric;
  left_days numeric;
  block_days int;
  s date;
  e date;
  plan_start date[];
  plan_end date[];
  plan_type text[];
  plan_half boolean[];
  ok boolean;
  day date;
  half boolean;
  sessions int;
  total int;
  weights double precision[];
  weight_sum double precision;
  minutes int[];
  starts timestamp[];
  clock timestamp;
  has_project boolean;
  used int;
  r double precision;
  project_total int;
  entries int;
  first_minutes int;
  main int;
  other int;
  pick int;
  subs text[];
  t_start timestamp;
  t_end timestamp;
BEGIN
  FOR p IN
    SELECT m.user_id, COALESCE(m.start_date, m.joined_at::date) AS start_date
    FROM organization_memberships m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.organization_id = org AND m.status = 'active' AND COALESCE(m.start_date, m.joined_at::date) IS NOT NULL
    ORDER BY m.user_id
  LOOP
    ------------------------------------------------------------------------------------------
    -- Absences, planned per calendar year, inserted once they are over.
    FOR y IN extract(year FROM p.start_date)::int .. extract(year FROM today)::int LOOP
      range_start := greatest(p.start_date, make_date(y, 1, 1));
      range_end := make_date(y, 12, 31);
      key := p.user_id || ':' || y;
      vacation := round((20 + floor(pg_temp.seed_rnd(key || ':vacation') * 11)) * (range_end - range_start + 1) / (make_date(y, 12, 31) - make_date(y, 1, 1) + 1.0));
      left_days := vacation;
      plan_start := '{}'; plan_end := '{}'; plan_type := '{}'; plan_half := '{}';
      k := 0;
      -- Two weeks in summer, one week elsewhere, then 1-3 days clock a time; one half day sometimes.
      WHILE left_days > 0 AND k < 40 LOOP
        k := k + 1;
        block_days := CASE
          WHEN k = 1 AND left_days >= 10 THEN 10
          WHEN k = 2 AND left_days >= 5 THEN 5
          ELSE floor(least(left_days, 1 + floor(pg_temp.seed_rnd(key || ':len:' || k) * 3)))::int END;
        -- A half day sometimes, and always for a last half day left.
        half := left_days < 1 OR (k > 2 AND pg_temp.seed_rnd(key || ':half:' || k) < 0.12);
        IF half THEN block_days := 1; END IF;
        ok := false;
        FOR attempt IN 1 .. 25 LOOP
          r := pg_temp.seed_rnd(key || ':start:' || k || ':' || attempt);
          IF block_days = 10 THEN
            s := make_date(y, 7, 1) + floor(r * 50)::int;   -- July / August
          ELSIF block_days = 5 AND r < 0.5 THEN
            s := make_date(y, 2, 1) + floor(r * 2 * 80)::int; -- February - April
          ELSIF block_days = 5 THEN
            s := make_date(y, 9, 20) + floor((r - 0.5) * 2 * 90)::int; -- autumn / Christmas
          ELSE
            s := make_date(y, 1, 1) + floor(r * 365)::int;
          END IF;
          IF block_days >= 5 THEN s := s - (extract(isodow FROM s)::int - 1); END IF; -- a Monday
          s := pg_temp.seed_next_workday(greatest(s, range_start));
          e := pg_temp.seed_span_end(s, block_days);
          CONTINUE WHEN e > range_end;
          CONTINUE WHEN EXISTS (SELECT 1 FROM generate_subscripts(plan_start, 1) i WHERE plan_start[i] <= e + 1 AND plan_end[i] >= s - 1);
          ok := true;
          EXIT;
        END LOOP;
        IF ok THEN
          plan_start := plan_start || s; plan_end := plan_end || e;
          plan_type := plan_type || 'vacation'::text; plan_half := plan_half || half;
        END IF;
        left_days := left_days - CASE WHEN half THEN 0.5 ELSE block_days END;
      END LOOP;
      -- 0-3 sick spells of 1-3 working days.
      FOR k IN 1 .. floor(pg_temp.seed_rnd(key || ':sick') * 4)::int LOOP
        FOR attempt IN 1 .. 10 LOOP
          s := pg_temp.seed_next_workday(make_date(y, 1, 1) + floor(pg_temp.seed_rnd(key || ':sick:' || k || ':' || attempt) * 365)::int);
          e := pg_temp.seed_span_end(s, 1 + floor(pg_temp.seed_rnd(key || ':sicklen:' || k) * 3)::int);
          CONTINUE WHEN s < range_start OR e > range_end;
          CONTINUE WHEN EXISTS (SELECT 1 FROM generate_subscripts(plan_start, 1) i WHERE plan_start[i] <= e + 1 AND plan_end[i] >= s - 1);
          plan_start := plan_start || s; plan_end := plan_end || e;
          plan_type := plan_type || 'sickness'::text; plan_half := plan_half || false;
          EXIT;
        END LOOP;
      END LOOP;

      -- Never more vacation than the year's entitlement (25 days, Acme's default, prorated from the start).
      -- Left out here and not in the plan, so a database seeded before gains no rows on a re-seed; counted
      -- over the whole year, future blocks included, so the result does not depend on today.
      allowance := 25.0 * (range_end - range_start + 1) / (make_date(y, 12, 31) - make_date(y, 1, 1) + 1);
      granted := 0;
      FOR k IN 1 .. coalesce(array_length(plan_start, 1), 0) LOOP
        s := plan_start[k]; e := plan_end[k];
        IF plan_type[k] = 'vacation' THEN
          days_off := CASE WHEN plan_half[k] THEN 0.5
            ELSE (SELECT count(*) FROM generate_series(s, e, INTERVAL '1 day') g WHERE pg_temp.seed_workday(g::date)) END;
          CONTINUE WHEN granted + days_off > allowance;
          granted := granted + days_off;
        END IF;
        CONTINUE WHEN e >= today;
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM absences a
          WHERE a.user_id = p.user_id AND a.organization_id = org AND a.date_start <= e AND a.date_end >= s
            AND a.id <> pg_temp.seed_id(key || ':absence:' || s));
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM work_times w
          WHERE w.user_id = p.user_id
            AND w.check_in >= (s::timestamp AT TIME ZONE tz) AND w.check_in < ((e + 1)::timestamp AT TIME ZONE tz)
            AND NOT plan_half[k]);
        INSERT INTO absences (id, organization_id, user_id, date_start, date_end, status, reviewed_by_user_id, reviewed_at, note, absence_type, half_day)
        VALUES (
          pg_temp.seed_id(key || ':absence:' || s), org, p.user_id, s, e, 'approved',
          CASE WHEN plan_type[k] = 'vacation' THEN pg_temp.seed_manager(org, p.user_id, s) END,
          CASE WHEN plan_type[k] = 'vacation' THEN ((s - 21)::timestamp + TIME '10:15') AT TIME ZONE tz ELSE ((s)::timestamp + TIME '08:05') AT TIME ZONE tz END,
          CASE WHEN plan_type[k] = 'sickness' THEN 'Flu' WHEN e - s >= 7 THEN 'Summer holidays' END,
          plan_type[k], plan_half[k])
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;

    ------------------------------------------------------------------------------------------
    -- Attendance and project time, day by day.
    FOR day IN SELECT g::date FROM generate_series(p.start_date, today - 1, INTERVAL '1 day') AS g LOOP
      CONTINUE WHEN NOT pg_temp.seed_workday(day);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM work_times w
        WHERE w.user_id = p.user_id AND w.check_in >= (day::timestamp AT TIME ZONE tz) AND w.check_in < ((day + 1)::timestamp AT TIME ZONE tz));
      has_project := EXISTS (
        SELECT 1 FROM project_times t
        WHERE t.user_id = p.user_id AND t.start_time >= (day::timestamp AT TIME ZONE tz) AND t.start_time < ((day + 1)::timestamp AT TIME ZONE tz));
      half := false;
      SELECT a.half_day INTO half FROM absences a
      WHERE a.user_id = p.user_id AND a.organization_id = org AND a.status = 'approved' AND day BETWEEN a.date_start AND a.date_end
      ORDER BY a.half_day LIMIT 1;
      IF FOUND AND NOT half THEN CONTINUE; END IF;
      half := coalesce(half, false);

      key := p.user_id || ':' || day;
      r := pg_temp.seed_rnd(key || ':sessions');
      IF half THEN
        sessions := CASE WHEN r < 0.5 THEN 1 ELSE 2 END;
        total := 225 + floor(pg_temp.seed_rnd(key || ':total') * 40)::int;
      ELSE
        sessions := CASE WHEN r < 0.15 THEN 1 WHEN r < 0.75 THEN 2 WHEN r < 0.95 THEN 3 ELSE 4 END;
        -- Around the 8-hour target (7:12 - 8:48), plus a small habit per person (-4 to +4
        -- minutes a day), so overtime balances drift apart without running away.
        total := 432 + floor(pg_temp.seed_rnd(p.user_id || ':habit') * 9)::int - 4 + floor(pg_temp.seed_rnd(key || ':total') * 97)::int;
      END IF;
      weights := '{}'; weight_sum := 0;
      FOR k IN 1 .. sessions LOOP
        weights := weights || (0.6 + pg_temp.seed_rnd(key || ':w:' || k) * 0.8);
        weight_sum := weight_sum + weights[k];
      END LOOP;
      minutes := '{}'; starts := '{}'; used := 0;
      clock := day + TIME '07:00' + make_interval(mins => floor(pg_temp.seed_rnd(key || ':start') * 91)::int);
      FOR k IN 1 .. sessions LOOP
        minutes := minutes || CASE WHEN k = sessions THEN total - used ELSE floor(total * weights[k] / weight_sum)::int END;
        used := used + minutes[k];
        IF k > 1 THEN
          -- The lunch break sits in the middle of the day; other breaks are short.
          clock := clock + make_interval(mins => CASE WHEN k = sessions / 2 + 1 THEN 30 + floor(pg_temp.seed_rnd(key || ':gap:' || k) * 31)::int
                                                 ELSE 5 + floor(pg_temp.seed_rnd(key || ':gap:' || k) * 21)::int END);
        END IF;
        starts := starts || clock;
        INSERT INTO work_times (id, user_id, organization_id, check_in, check_out)
        VALUES (pg_temp.seed_id(key || ':work:' || k), p.user_id, org, clock AT TIME ZONE tz, (clock + make_interval(mins => minutes[k])) AT TIME ZONE tz)
        ON CONFLICT (id) DO NOTHING;
        clock := clock + make_interval(mins => minutes[k]);
      END LOOP;

      -- Project time: the month's main project, sometimes a second one; 80-100% of attendance in
      -- whole 5 minutes, the first entry from the first check-in, the second from the next one.
      CONTINUE WHEN has_project;
      project_total := (floor(total * (0.8 + pg_temp.seed_rnd(key || ':ptotal') * 0.2) / 5) * 5)::int;
      entries := CASE WHEN pg_temp.seed_rnd(key || ':entries') < 0.5 OR project_total < 60 THEN 1 ELSE 2 END;
      first_minutes := CASE WHEN entries = 1 THEN project_total
                            ELSE (round(project_total * (0.35 + pg_temp.seed_rnd(key || ':split') * 0.3) / 5) * 5)::int END;
      main := 1 + floor(pg_temp.seed_rnd(p.user_id || ':' || to_char(day, 'YYYY-MM') || ':main') * 3)::int;
      other := 1 + (main + floor(pg_temp.seed_rnd(key || ':other') * 2)::int) % 3;
      t_start := starts[1];
      FOR k IN 1 .. entries LOOP
        pick := CASE WHEN k = 1 THEN main ELSE other END;
        IF k = 2 THEN t_start := greatest(coalesce(starts[2], t_end), t_end); END IF;
        t_end := t_start + make_interval(mins => CASE WHEN k = 1 THEN first_minutes ELSE project_total - first_minutes END);
        subs := string_to_array(subprojects[pick], ',');
        INSERT INTO project_times (id, user_id, organization_id, project_id, subproject_id, start_time, end_time, comment)
        VALUES (
          pg_temp.seed_id(key || ':project:' || k), p.user_id, org, projects[pick],
          nullif(subs[1 + floor(pg_temp.seed_rnd(key || ':sub:' || k) * array_length(subs, 1))::int], '')::uuid,
          t_start AT TIME ZONE tz, t_end AT TIME ZONE tz,
          (string_to_array(comments[pick], '|'))[1 + floor(pg_temp.seed_rnd(key || ':comment:' || k) * 6)::int])
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Last month still open for Ueli and Uma (see the timesheets below).
CREATE FUNCTION pg_temp.seed_last_month_open(person uuid, month date) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT person IN ('22222222-2222-2222-2222-222222222227', '22222222-2222-2222-2222-222222222228')
          AND month = (date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date) - INTERVAL '1 month')::date
          AND extract(month FROM (now() AT TIME ZONE 'Europe/Zurich')::date) <> 1 $$;

-- Working-time timesheets: every month from the start month to last month, submitted on the
-- 1st-2nd of the next month and approved by the manager in force clock the month's end. Except that
-- Ueli and Uma have not submitted last month yet (so the month-end close has something open), as long
-- as last month is in this year (last year must be complete to close it).
INSERT INTO timesheet_periods (id, organization_id, user_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.seed_id(m.user_id || ':timesheet:' || mo::date), m.organization_id, m.user_id, mo::date, (mo + INTERVAL '1 month')::date, 'approved',
       least(now(), ((mo + INTERVAL '1 month')::timestamp + TIME '17:30') AT TIME ZONE 'Europe/Zurich'),
       pg_temp.seed_manager(m.organization_id, m.user_id, (mo + INTERVAL '1 month - 1 day')::date),
       least(now(), ((mo + INTERVAL '1 month 2 days')::timestamp + TIME '09:10') AT TIME ZONE 'Europe/Zurich')
FROM organization_memberships m
JOIN users u ON u.id = m.user_id AND u.status = 'active'
CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(m.start_date, m.joined_at::date)),
                                   date_trunc('month', (now() AT TIME ZONE 'Europe/Zurich')::date) - INTERVAL '1 month',
                                   INTERVAL '1 month') AS mo
WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.status = 'active'
  AND NOT pg_temp.seed_last_month_open(m.user_id, mo::date)
ON CONFLICT (organization_id, user_id, period_start) DO NOTHING;

-- Project timesheets: one per person, project and month with project time before this month,
-- approved by the project's owner.
INSERT INTO project_time_periods (id, organization_id, user_id, project_id, period_start, period_end, status, submitted_at, reviewed_by_user_id, reviewed_at)
SELECT pg_temp.seed_id(t.user_id || ':project-timesheet:' || t.project_id || ':' || t.month), t.organization_id, t.user_id, t.project_id,
       t.month, (t.month + INTERVAL '1 month')::date, 'approved',
       least(now(), ((t.month + INTERVAL '1 month')::timestamp + TIME '17:35') AT TIME ZONE 'Europe/Zurich'),
       COALESCE(pr.owner_user_id, t.user_id),
       least(now(), ((t.month + INTERVAL '1 month 3 days')::timestamp + TIME '11:00') AT TIME ZONE 'Europe/Zurich')
FROM (
  SELECT DISTINCT pt.user_id, pt.organization_id, pt.project_id, date_trunc('month', pt.start_time AT TIME ZONE 'Europe/Zurich')::date AS month
  FROM project_times pt
  WHERE pt.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND pt.project_id IS NOT NULL
    AND pt.start_time < (date_trunc('month', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich')
) t
JOIN projects pr ON pr.id = t.project_id
WHERE NOT pg_temp.seed_last_month_open(t.user_id, t.month)
ON CONFLICT (organization_id, user_id, project_id, period_start) DO NOTHING;

-- Flows (module "flows"): a few demo Free Flows to HR and to line managers, with their threads.
-- Fixed ids, so re-seeding adds nothing.
INSERT INTO flows (id, organization_id, requester_user_id, target_kind, target_department_id, subject, status, assignee_user_id, opened_at, last_activity_at, resolved_at, archived_at) VALUES
  ('eeee0000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'department', 'dddddddd-0000-0000-0000-000000000002',
   'New home address', 'in_progress', '22222222-2222-2222-2222-222222222226', now() - interval '3 days', now() - interval '2 days', NULL, NULL),
  ('eeee0000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222228', 'department', 'dddddddd-0000-0000-0000-000000000002',
   'Question about my payslip', 'open', NULL, now() - interval '5 hours', now() - interval '5 hours', NULL, NULL),
  ('eeee0000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222227', 'manager', NULL,
   'Home office on Fridays', 'open', NULL, now() - interval '1 day', now() - interval '1 day', NULL, NULL),
  ('eeee0000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222224', 'manager', NULL,
   'Training budget for the sales team', 'resolved', '22222222-2222-2222-2222-222222222223', now() - interval '20 days', now() - interval '14 days', now() - interval '14 days', now() - interval '14 days')
ON CONFLICT DO NOTHING;

INSERT INTO flow_messages (id, flow_id, author_user_id, kind, body, data, posted_at) VALUES
  ('eeee1111-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222227', 'message',
   E'Hello HR,\nI moved last weekend. My new address is Bahnhofstrasse 12, 8001 Zürich. Could you update it?', '{}', now() - interval '3 days'),
  ('eeee1111-0000-0000-0000-000000000002', 'eeee0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222226', 'event', NULL,
   '{"assignee": "22222222-2222-2222-2222-222222222226", "status": "in_progress"}', now() - interval '2 days 1 hour'),
  ('eeee1111-0000-0000-0000-000000000003', 'eeee0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222226', 'message',
   'Thanks Ueli. Please also send the change through My data so it is recorded; I will approve it right away.', '{}', now() - interval '2 days'),
  ('eeee1111-0000-0000-0000-000000000004', 'eeee0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222228', 'message',
   'My last payslip shows fewer overtime hours than my timesheet. Could someone check it?', '{}', now() - interval '5 hours'),
  ('eeee1111-0000-0000-0000-000000000005', 'eeee0000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222227', 'message',
   'Could I work from home on Fridays from next month on?', '{}', now() - interval '1 day'),
  ('eeee1111-0000-0000-0000-000000000006', 'eeee0000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222224', 'message',
   'We would like to book a negotiation training for the sales team (CHF 4,800). Is there budget left this year?', '{}', now() - interval '20 days'),
  ('eeee1111-0000-0000-0000-000000000007', 'eeee0000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222223', 'message',
   'Yes, approved. Go ahead and book it.', '{}', now() - interval '14 days'),
  ('eeee1111-0000-0000-0000-000000000008', 'eeee0000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222223', 'event', NULL,
   '{"status": "resolved"}', now() - interval '14 days'),
  ('eeee1111-0000-0000-0000-000000000009', 'eeee0000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222223', 'event', NULL,
   '{"archived": true}', now() - interval '14 days')
ON CONFLICT DO NOTHING;

-- Flow type, urgency and link (069). Only fills in what is still unset, so re-seeding changes nothing.
UPDATE flows r SET flow_type = v.flow_type, urgent = v.urgent, link_url = v.link_url
FROM (VALUES
  ('eeee0000-0000-0000-0000-000000000001'::uuid, 'service', false, NULL),
  ('eeee0000-0000-0000-0000-000000000002'::uuid, 'support', true, 'https://intranet.acme.example/payroll/2026-10'),
  ('eeee0000-0000-0000-0000-000000000003'::uuid, 'other', false, NULL),
  ('eeee0000-0000-0000-0000-000000000004'::uuid, 'service', false, NULL)
) AS v(id, flow_type, urgent, link_url)
WHERE r.id = v.id AND r.flow_type IS NULL;

-- A flow type with its own fields and set steps (Admin settings -> Flow designer): "Materialbestellung". Acme gets a
-- Frontdesk department (code frontdesk, led by Admin), its own copy of the flow types with "material", the type's
-- fields (form flow.material: article, quantity, amount) and its workflow: the manager approves, finance too above
-- CHF 500, then Frontdesk orders in the web shop and hands the goods over. Only where nothing is there yet.
INSERT INTO departments (id, organization_id, name, leader_user_id, sort_order, code)
VALUES ('dddddddd-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Frontdesk', '11111111-1111-1111-1111-111111111111', 6, 'frontdesk')
ON CONFLICT DO NOTHING;

INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', g.entity, g.enum_name, g."values", g.translation
FROM static_data g
WHERE g.organization_id IS NULL AND g.entity = 'flows' AND g.enum_name = 'flow_type'
  AND NOT EXISTS (SELECT 1 FROM static_data o WHERE o.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND o.entity = 'flows' AND o.enum_name = 'flow_type');
UPDATE static_data SET
  "values" = "values" || '{"material": {"sort": 5}}'::jsonb,
  translation = jsonb_build_object(
    'de', COALESCE(translation->'de', '{}'::jsonb) || '{"material": "Materialbestellung"}'::jsonb,
    'en', COALESCE(translation->'en', '{}'::jsonb) || '{"material": "Material order"}'::jsonb,
    'fr', COALESCE(translation->'fr', '{}'::jsonb) || '{"material": "Commande de matériel"}'::jsonb,
    'it', COALESCE(translation->'it', '{}'::jsonb) || '{"material": "Ordine di materiale"}'::jsonb)
WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND entity = 'flows' AND enum_name = 'flow_type'
  AND NOT "values" ? 'material';

INSERT INTO field_config (organization_id, form_id, field_key, is_custom, config) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow.material', 'artikel', TRUE,
   '{"type": "text", "group": "custom", "order": 10, "width": "l", "required": true, "caption": {"de": "Artikel", "en": "Article", "fr": "Article", "it": "Articolo"}}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow.material', 'menge', TRUE,
   '{"type": "number", "group": "custom", "order": 20, "width": "s", "min": 1, "caption": {"de": "Menge", "en": "Quantity", "fr": "Quantité", "it": "Quantità"}}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow.material', 'betrag', TRUE,
   '{"type": "number", "group": "custom", "order": 30, "width": "s", "min": 0, "caption": {"de": "Betrag (CHF)", "en": "Amount (CHF)", "fr": "Montant (CHF)", "it": "Importo (CHF)"}}')
ON CONFLICT DO NOTHING;

INSERT INTO workflow_definitions (organization_id, name, description, steps, config)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow:material', 'A flow of a type with set steps: its steps, one after the other.', '[]'::jsonb,
  '{"version": 1, "steps": [
     {"key": "manager", "do": ["review"], "assignTo": "manager", "reject": "back",
      "label": {"de": "Prüfung Vorgesetzte", "en": "Manager review", "fr": "Contrôle du supérieur", "it": "Verifica del superiore"}},
     {"key": "finance", "do": ["review"], "assignTo": "permission:nav.expensePayout", "when": {"field.betrag": {"gt": 500}}, "reject": "back",
      "label": {"de": "Prüfung Finanzen", "en": "Finance review", "fr": "Contrôle des finances", "it": "Verifica delle finanze"}},
     {"key": "order", "do": ["task"], "assignTo": "department:frontdesk", "reject": "back",
      "label": {"de": "Im Webshop bestellen", "en": "Order in the web shop", "fr": "Commander en ligne", "it": "Ordinare online"}},
     {"key": "handover", "do": ["task"], "assignTo": "department:frontdesk", "reject": "none",
      "label": {"de": "Ware übergeben", "en": "Hand over the goods", "fr": "Remettre la marchandise", "it": "Consegnare la merce"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'flow:material');

-- Open requests on the Workflow page: a vacation request each from Ueli (to Marco) and Ulla (to Marta),
-- about six weeks ahead, with the workflow the API creates on submit (absences.controller.ts, same
-- steps; the definition is the one the API keeps by name). Only absences without a workflow get one.
INSERT INTO workflow_definitions (organization_id, name, description, steps)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve absence', 'A vacation request awaiting the employee''s manager to approve or reject it.',
       '[{"key": "manager_review", "label": "Manager review", "assignTo": "manager", "onApprove": {"action": "absence.approve"}, "onReject": {"action": "absence.reject"}, "source": "Vacation Request", "source_name": "getAbsenceTitle"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'approve absence');

INSERT INTO absences (id, organization_id, user_id, date_start, date_end, status, note, absence_type, half_day)
SELECT pg_temp.seed_id(v.person || ':pending-vacation'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v.person::uuid,
       date_trunc('week', CURRENT_DATE + 42)::date + v.offset_days,
       date_trunc('week', CURRENT_DATE + 42)::date + v.offset_days + v.days - 1,
       'pending', v.note, 'vacation', false
FROM (VALUES
  ('22222222-2222-2222-2222-222222222227', 0, 5, 'Family holiday'),
  ('22222222-2222-2222-2222-222222222226', 7, 3, NULL)
) AS v(person, offset_days, days, note)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflows (workflow_id, workflow_def_id, organization_id, source_table, source_table_uuid, workflow_data, workflow_started,
                       step, step_status, workflow_step_started, assigned_to_user_id)
SELECT DISTINCT ON (a.id) pg_temp.seed_id(a.id || ':workflow'), d.workflow_def_id, d.organization_id, 'absences', a.id,
       jsonb_build_object('note', a.note, 'submittedByUserId', a.user_id, 'history',
         jsonb_build_array(jsonb_build_object('key', 'approvals.event.submitted', 'by', a.user_id, 'at', now() - interval '1 day'))),
       now() - interval '1 day',
       'manager_review', 'pending', now() - interval '1 day', ARRAY[pg_temp.seed_manager(a.organization_id, a.user_id, CURRENT_DATE)]
FROM absences a
JOIN workflow_definitions d ON d.organization_id = a.organization_id AND d.name = 'approve absence'
WHERE a.id IN (pg_temp.seed_id('22222222-2222-2222-2222-222222222227:pending-vacation'), pg_temp.seed_id('22222222-2222-2222-2222-222222222226:pending-vacation'))
  AND a.status = 'pending'
  AND pg_temp.seed_manager(a.organization_id, a.user_id, CURRENT_DATE) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.source_table = 'absences' AND w.source_table_uuid = a.id)
ORDER BY a.id, d.workflow_def_id
ON CONFLICT (workflow_id) DO NOTHING;

-- Deputies (117): while one of them is away, the steps of flows waiting for them go to the other as well
-- (workflow-dues.service.ts). Marta and Marco stand in for each other, as do Ulla and Fido; set only where none is.
UPDATE organization_memberships m SET deputy_user_id = d.deputy::uuid
FROM (VALUES
  ('22222222-2222-2222-2222-222222222224', '22222222-2222-2222-2222-222222222225'),
  ('22222222-2222-2222-2222-222222222225', '22222222-2222-2222-2222-222222222224'),
  ('22222222-2222-2222-2222-222222222226', '22222222-2222-2222-2222-222222222229'),
  ('22222222-2222-2222-2222-222222222229', '22222222-2222-2222-2222-222222222226')
) AS d(person, deputy)
WHERE m.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND m.user_id = d.person::uuid AND m.deputy_user_id IS NULL;

-- A residence permit ending soon (118): Uma's B permit ends 45 days after the seed runs, so the trigger below opens a
-- flow for HR on the demo; set only where she has none.
UPDATE users SET basicdata = COALESCE(basicdata, '{}'::jsonb)
  || jsonb_build_object('residencePermitCode', 'B', 'residencePermitValidUntil', to_char(CURRENT_DATE + 45, 'YYYY-MM-DD'))
WHERE email = 'uma@acme.com' AND NOT COALESCE(basicdata, '{}'::jsonb) ? 'residencePermitCode';

-- Auslöser with a flow type (Admin settings -> Flow-Designer -> Auslöser, the core's Vorlage "Bewilligung erneuern",
-- shared/triggerTemplates.ts): when a permit is about to end, HR (everyone who edits everyone's personal data: Ulla)
-- writes the person an e-mail from the template, the person uploads the new permit in the flow (their own task), and HR
-- records it; Uma's permit above opens one. The type (confidential), its step and the trigger as
-- the Vorlage creates them; HR-Prozesse's events (plugins/hr/seed.sql) stay Free Flows, its Vorlagen are offered there.
UPDATE static_data SET
  "values" = "values" || jsonb_build_object('bewilligung_erneuern', jsonb_build_object('confidential', true,
    'sort', (SELECT COALESCE(max((e.value->>'sort')::numeric), 0) + 1 FROM jsonb_each("values") e))),
  translation = jsonb_build_object(
    'de', COALESCE(translation->'de', '{}'::jsonb) || '{"bewilligung_erneuern":"Bewilligung erneuern"}'::jsonb,
    'en', COALESCE(translation->'en', '{}'::jsonb) || '{"bewilligung_erneuern":"Renew the permit"}'::jsonb,
    'fr', COALESCE(translation->'fr', '{}'::jsonb) || '{"bewilligung_erneuern":"Renouveler l''autorisation"}'::jsonb,
    'it', COALESCE(translation->'it', '{}'::jsonb) || '{"bewilligung_erneuern":"Rinnovare il permesso"}'::jsonb)
WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND entity = 'flows' AND enum_name = 'flow_type'
  AND NOT "values" ? 'bewilligung_erneuern';

INSERT INTO workflow_definitions (organization_id, name, description, steps, config)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow:bewilligung_erneuern', 'A flow of a type with set steps: its steps, one after the other.', '[]'::jsonb,
  '{"version":1,"steps":[{"key":"mail","do":["compose"],"assignTo":"permission:section.basicdata.personalien","reject":"back","mailTo":"about","label":{"de":"E-Mail schreiben","fr":"Écrire un e-mail","it":"Scrivere un''e-mail","en":"Write an e-mail"},"message":{"subject":{"de":"Ihre Bewilligung läuft am {{date}} ab","fr":"Votre autorisation échoit le {{date}}","it":"Il Suo permesso scade il {{date}}","en":"Your permit expires on {{date}}"},"text":{"de":"Guten Tag {{name}}\n\nIhre Aufenthalts- bzw. Arbeitsbewilligung ({{type}}) läuft am {{date}} ab. Bitte leiten Sie die Verlängerung rechtzeitig ein. Sobald Sie die neue Bewilligung erhalten haben, laden Sie bitte eine Kopie in Apensum hoch: unter Flows → Zu erledigen finden Sie die Aufgabe «Neue Bewilligung hochladen».\n\nBei Fragen helfen wir Ihnen gerne weiter.\n\nFreundliche Grüsse\n{{sender}}","fr":"Bonjour {{name}},\n\nVotre autorisation de séjour ou de travail ({{type}}) échoit le {{date}}. Veuillez lancer le renouvellement à temps. Dès que vous aurez reçu la nouvelle autorisation, veuillez en télécharger une copie dans Apensum : sous Flows → À faire, vous trouverez la tâche « Télécharger la nouvelle autorisation ».\n\nNous restons volontiers à votre disposition pour toute question.\n\nMeilleures salutations\n{{sender}}","it":"Buongiorno {{name}},\n\nIl Suo permesso di soggiorno o di lavoro ({{type}}) scade il {{date}}. La preghiamo di avviare per tempo il rinnovo. Non appena avrà ricevuto il nuovo permesso, carichi una copia in Apensum: in Flows → Da fare trova il compito «Caricare il nuovo permesso».\n\nRestiamo volentieri a disposizione per qualsiasi domanda.\n\nCordiali saluti\n{{sender}}","en":"Hello {{name}},\n\nYour residence or work permit ({{type}}) expires on {{date}}. Please start the renewal in time. As soon as you have received the new permit, please upload a copy in Apensum: under Flows → To do you will find the task “Upload the new permit”.\n\nWe are happy to help if you have any questions.\n\nKind regards\n{{sender}}"}}},{"key":"upload","do":["task"],"assignTo":"about","reject":"back","label":{"de":"Neue Bewilligung hochladen","fr":"Télécharger la nouvelle autorisation","it":"Caricare il nuovo permesso","en":"Upload the new permit"},"remindDays":5},{"key":"record","do":["task"],"assignTo":"permission:section.basicdata.personalien","reject":"back","label":{"de":"Neue Bewilligung erfassen","fr":"Saisir la nouvelle autorisation","it":"Registrare il nuovo permesso","en":"Record the new permit"},"remindDays":5}]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND name = 'flow:bewilligung_erneuern');

INSERT INTO flow_triggers (id, organization_id, event, enabled, lead_days, flow_type, target, department_id, confidential)
SELECT 'f1000000-0000-4000-8000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'permitExpires', TRUE, 90, 'bewilligung_erneuern', 'department', 'dddddddd-0000-0000-0000-000000000002', TRUE
WHERE EXISTS (SELECT 1 FROM departments WHERE id = 'dddddddd-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM flow_triggers t WHERE t.organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND t.event = 'permitExpires')
ON CONFLICT (id) DO NOTHING;
