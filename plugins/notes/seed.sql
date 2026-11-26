-- The notes plugin's demo data (runs after infra/postgres/seeds/seed.sql, same transaction): a few notes of Acme's
-- people that show Markdown (a task list, a table, headings) and sharing: Ueli's own to-do list, Marta's notes for the
-- customer meeting shared with Ueli and Ulla, Ulla's onboarding checklist shared with Marco. Re-runnable like the
-- core's seed: fixed ids, ON CONFLICT DO NOTHING (a note changed or deleted in the demo stays as it is).
INSERT INTO notes.notes (id, organization_id, user_id, text, created_at, shared_with)
SELECT n.id::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', u.id, n.text, now() - n.age::interval,
       COALESCE((SELECT array_agg(s.id) FROM users s WHERE s.email = ANY(n.shared)), '{}')
FROM (VALUES
  ('ae000000-0000-0000-0000-000000000001', 'ueli@acme.com', '3 days', '{}'::text[],
   E'## Diese Woche\n- [x] Monatsrapport Oktober prüfen\n- [ ] Ferienantrag Dezember stellen\n- [ ] Laptop-Update installieren\n\nParkplatzkarte bis **Ende Monat** erneuern.'),
  ('ae000000-0000-0000-0000-000000000002', 'marta@acme.com', '1 day', ARRAY['ueli@acme.com', 'ulla@acme.com'],
   E'# Kundentermin Fussballverband\nDonnerstag, 9:00, Stadionweg 12\n\n| Wer | Was |\n|---|---|\n| Marta | Offerte vorstellen |\n| Ueli | Zeitplan |\n| Ulla | Vertrag |\n\n> Unterlagen bitte bis Mittwoch in den Projektordner.'),
  ('ae000000-0000-0000-0000-000000000003', 'ulla@acme.com', '5 days', ARRAY['marco@acme.com'],
   E'## Eintritt neue Mitarbeiterin\n1. Arbeitsplatz und Laptop bereitstellen\n2. Zugang zu Apensum einrichten\n3. ~~Badge bestellen~~ (erledigt)\n4. Einführung mit dem Team planen')
) AS n(id, email, age, shared, text)
JOIN users u ON u.email = n.email
ON CONFLICT (id) DO NOTHING;
