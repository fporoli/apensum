// Writes plugins/cases/seed.sql: Acme's demo case, end-to-end encrypted like every case.
//
//   npx tsx plugins/cases/scripts/generate-demo-seed.mts
//
// The server cannot seal a case (it never holds a key), so this script does what the browser does
// (shared/caseCrypto.ts, shared/caseVault.ts): a key pair per demo user under a known passphrase, a case
// key wrapped for each of them, and every row sealed with it. The output is constants, committed as
// seed.sql; run the script again only to change the demo case (it makes new keys every time).
//
// Demo passphrase for Cases: `<name>-cases-demo` (marta@acme.com -> marta-cases-demo).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaseKey, createUserKeys, wrapCaseKey } from '../shared/caseCrypto';
import { sealRow } from '../shared/caseVault';

const ACME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USERS = {
  admin: '11111111-1111-1111-1111-111111111111',
  marta: '22222222-2222-2222-2222-222222222224',
  marco: '22222222-2222-2222-2222-222222222225',
  ulla: '22222222-2222-2222-2222-222222222226',
} as const;
const CASE_ID = 'cafecafe-0000-4000-8000-000000000001';
const INTERVIEWS = ['cafecafe-0000-4000-8000-000000000011', 'cafecafe-0000-4000-8000-000000000012'];
const ASSESSMENT_ID = 'cafecafe-0000-4000-8000-000000000021';
const KESB_TEMPLATE = '00000000-0000-0000-c001-000000000001';

const theCase = {
  title: 'Gefährdungsmeldung Schule: Abklärung Kindeswohl',
  subject_name: 'Lena Beispiel',
  subject_dob: '2016-04-12',
  metadata: {},
  custom: {},
};

const interviews = [
  {
    id: INTERVIEWS[0], role: 'relative', date: '2026-10-14', minutes: 55,
    secrets: {
      interviewee_name: 'Sandra Beispiel (Mutter)',
      transcript_text: [
        'Frau Beispiel erscheint pünktlich und ist zur Zusammenarbeit bereit.',
        'Sie bestätigt, dass Lena seit den Sommerferien oft müde ist und morgens nur schwer aus dem Bett kommt.',
        'Seit der Trennung im Frühling arbeitet sie im Schichtdienst; an drei Abenden pro Woche ist Lena bis 22 Uhr allein oder bei der Nachbarin.',
        'Der Vater lebt in Deutschland und meldet sich unregelmässig. Finanzielle Unterstützung erhält sie nicht.',
        'Sie wünscht sich Hilfe bei der Betreuung am Abend und ist mit einer Familienbegleitung einverstanden.',
      ].join('\n'),
      summary: 'Mutter kooperativ. Betreuungslücke an drei Abenden pro Woche seit der Trennung. Einverstanden mit Familienbegleitung.',
      tags: ['Betreuung', 'Trennung'],
      audio_mime: null,
      audio_key: null,
    },
  },
  {
    id: INTERVIEWS[1], role: 'witness', date: '2026-10-16', minutes: 30,
    secrets: {
      interviewee_name: 'Peter Keller (Klassenlehrer)',
      transcript_text: [
        'Herr Keller unterrichtet Lena seit August in der 4. Klasse.',
        'Seit September fehlte sie an elf Halbtagen, meist ohne Entschuldigung. Sie schläft im Unterricht gelegentlich ein.',
        'Im Kontakt mit Mitschülerinnen ist sie freundlich, zieht sich aber zurück. Die schulischen Leistungen sind gesunken.',
        'Zwei Gespräche mit der Mutter fanden statt; sie war offen, die Absenzen gingen danach kurz zurück.',
        'Die Schule hat die Meldung gemacht, weil die Absenzen im Oktober wieder zunahmen.',
      ].join('\n'),
      summary: 'Elf unentschuldigte Halbtage seit September, Müdigkeit im Unterricht, Leistungsabfall. Mutter bei Gesprächen offen.',
      tags: ['Schule', 'Absenzen'],
      audio_mime: null,
      audio_key: null,
    },
  },
];

const assessment = {
  title: 'Abklärungsbericht Lena Beispiel (Entwurf)',
  sections_content: {
    mandate: 'Die Schule meldete am 2. Oktober 2026 wiederholte unentschuldigte Absenzen und Müdigkeit im Unterricht. Die KESB beauftragte am 6. Oktober 2026 die Abklärung der Betreuungssituation.',
    dossier_analysis: 'Absenzenliste der Schule (11 Halbtage seit September), Bericht des Klassenlehrers, keine früheren Meldungen.',
    interviews_summary: 'Gespräche mit der Mutter (14.10.) und dem Klassenlehrer (16.10.). Beide schildern eine Betreuungslücke am Abend seit der Trennung der Eltern; die Mutter ist kooperativ und wünscht Unterstützung.',
    recommendation: 'Vorläufig: freiwillige Familienbegleitung, Abklärung eines Hortplatzes für drei Abende pro Woche, Standortgespräch mit Schule und Mutter in acht Wochen.',
  },
  custom: {},
};

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

const out: string[] = [];
const keys: Record<string, { publicKey: string; wrappedPrivateKey: string; salt: string; iterations: number }> = {};
for (const name of Object.keys(USERS)) keys[name] = await createUserKeys(`${name}-cases-demo`);
const caseKey = await createCaseKey();
const wrapped: Record<string, string> = {};
for (const [name, k] of Object.entries(keys)) wrapped[name] = await wrapCaseKey(caseKey, k.publicKey);

const caseEnc = (await sealRow(caseKey, 'case', CASE_ID, theCase)).enc;
const interviewEnc = await Promise.all(interviews.map(async (i) => (await sealRow(caseKey, 'interview', i.id, i.secrets)).enc));
const assessmentEnc = (await sealRow(caseKey, 'assessment', ASSESSMENT_ID, assessment)).enc;

out.push(`-- GENERATED by plugins/cases/scripts/generate-demo-seed.mts; do not edit, run the script again.
--
-- The Cases plugin's demo data (runs after infra/postgres/seeds/seed.sql, same transaction): Acme gets the
-- Cases module and one KESB case with two interviews and an assessment draft, led by Marta. Every case is
-- end-to-end encrypted (docs/CASES_ENCRYPTION.md), so the rows hold only ciphertext; the texts are in the script.
--
-- Admin, Marta, Marco and Ulla get a Cases key pair whose passphrase is \`<name>-cases-demo\`
-- (marta@acme.com -> marta-cases-demo), and each holds the case key. A person who set up their own
-- passphrase before keeps it: they get no copy of the case key (it would not open with theirs), so the case
-- shows locked for them until reset-seed. Re-runnable like the core's seed.

-- Cases is off by default: switch it on for Acme unless an admin chose already.
UPDATE organizations
SET settings = settings || jsonb_build_object('modules', COALESCE(settings->'modules', '{}'::jsonb) || '{"cases": true}'::jsonb)
WHERE id = ${q(ACME)} AND NOT COALESCE(settings->'modules' ? 'cases', false);

INSERT INTO cases.user_keys (user_id, public_key, wrapped_private_key, salt, iterations)
VALUES
${Object.entries(keys).map(([name, k]) => `  (${q(USERS[name as keyof typeof USERS])}, ${q(k.publicKey)},\n   ${q(k.wrappedPrivateKey)}, ${q(k.salt)}, ${k.iterations})`).join(',\n')}
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO cases.cases (id, organization_id, reference_number, title, domain, subject_name, subject_dob, status, lead_user_id, confidentiality, metadata, custom, enc)
VALUES (${q(CASE_ID)}, ${q(ACME)}, 'KESB-2026-0142', '', 'kesb', '', NULL, 'in_progress', ${q(USERS.marta)}, 'confidential', '{}', '{}',
  ${json(caseEnc)})
ON CONFLICT (id) DO NOTHING;

-- A copy of the case key only for those whose key pair is the seeded one.
INSERT INTO cases.case_keys (case_id, user_id, wrapped_key, granted_by)
SELECT ${q(CASE_ID)}, v.user_id::uuid, v.wrapped_key, ${q(USERS.marta)}
FROM (VALUES
${Object.entries(wrapped).map(([name, w]) => `  (${q(USERS[name as keyof typeof USERS])}, ${q(keys[name].publicKey)}, ${q(w)})`).join(',\n')}
) AS v(user_id, public_key, wrapped_key)
JOIN cases.user_keys uk ON uk.user_id = v.user_id::uuid AND uk.public_key = v.public_key
ON CONFLICT (case_id, user_id) DO NOTHING;

INSERT INTO cases.case_interviews (id, case_id, interviewee_name, interviewee_role, interview_date, duration_minutes, interviewer_user_id, transcript_text, summary, tags, enc)
VALUES
${interviews.map((i, n) => `  (${q(i.id)}, ${q(CASE_ID)}, '', ${q(i.role)}, ${q(i.date)}, ${i.minutes}, ${q(USERS.marta)}, '', NULL, '{}',\n   ${json(interviewEnc[n])})`).join(',\n')}
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases.assessments (id, case_id, template_id, title, status, sections_content, author_user_id, custom, enc)
VALUES (${q(ASSESSMENT_ID)}, ${q(CASE_ID)}, ${q(KESB_TEMPLATE)}, '', 'draft', '{}', ${q(USERS.marta)}, '{}',
  ${json(assessmentEnc)})
ON CONFLICT (id) DO NOTHING;
`);

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed.sql');
writeFileSync(target, out.join(''));
console.log(`wrote ${target}`);
