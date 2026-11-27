-- The notes plugin's demo data (runs after infra/postgres/seeds/seed.sql, same transaction): a few notes of Acme's
-- people that show Markdown (a task list, a table, headings), sharing and folding (each note folds to its first line):
-- Ueli's own to-do list, a call to return, retro ideas and his training plans; Marta's notes for the customer meeting
-- shared with Ueli and Ulla; Marco's release plan shared with Ueli and Alice; Ulla's onboarding checklist shared with
-- Marco and her year-end list. Re-runnable like the
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
   E'## Eintritt neue Mitarbeiterin\n1. Arbeitsplatz und Laptop bereitstellen\n2. Zugang zu Apensum einrichten\n3. ~~Badge bestellen~~ (erledigt)\n4. Einführung mit dem Team planen'),
  ('ae000000-0000-0000-0000-000000000004', 'ueli@acme.com', '2 hours', '{}'::text[],
   E'Rückruf Lieferant Bürobedarf\nHerr Keller, 044 555 12 34, wegen der falschen Lieferung (Bestellung 4711).\nErreichbar ab 14:00.'),
  ('ae000000-0000-0000-0000-000000000005', 'ueli@acme.com', '6 days', '{}'::text[],
   E'## Sprint-Retro Ideen\n- Daily kürzer halten, 15 Minuten reichen\n- Code-Reviews innert eines Tages\n- **Testdaten** für die Abnahme früher bereitstellen\n- Demo am Freitag mit dem Kunden?'),
  ('ae000000-0000-0000-0000-000000000006', 'ueli@acme.com', '12 days', '{}'::text[],
   E'## Weiterbildung 2027\n| Kurs | Wann | Kosten |\n|---|---|---|\n| Scrum Master | März | CHF 1''800 |\n| Englisch B2 | ab April, wöchentlich | CHF 950 |\n\nMit Marco im Mitarbeitergespräch besprechen.'),
  ('ae000000-0000-0000-0000-000000000007', 'marco@acme.com', '2 days', ARRAY['ueli@acme.com', 'alice@acme.com'],
   E'# Release 3.2 – Ablauf\n- [x] Feature-Freeze am Montag\n- [ ] Abnahme durch den Kunden (Mittwoch)\n- [ ] Release-Notes schreiben (Ueli)\n- [ ] Deployment am Donnerstagabend\n\nBei Problemen: Rollback auf 3.1, Alice ist auf Pikett.'),
  ('ae000000-0000-0000-0000-000000000008', 'ulla@acme.com', '9 days', '{}'::text[],
   E'## Jahresend-Checkliste HR\n- [ ] Ferienguthaben prüfen, Übertrag bis 31.03.\n- [ ] Lohnausweise vorbereiten\n- [ ] Dienstjubiläen 2027 planen\n- [x] Weihnachtsessen reserviert (12.12.)')
) AS n(id, email, age, shared, text)
JOIN users u ON u.email = n.email
ON CONFLICT (id) DO NOTHING;
