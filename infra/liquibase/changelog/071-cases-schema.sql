--liquibase formatted sql

-- Cases & Assessments plugin schema:
-- Provides high-stakes case management for child & adult protection (KESB), forensic psychoanalysts,
-- and police investigation departments.
-- A case holds related evidence documents, interview recordings/transcripts, and synthesizes them
-- into standardized, client-changeable assessments.

--changeset worktime:071-cases-schema
CREATE SCHEMA IF NOT EXISTS cases;

-- Cases / dossiers
CREATE TABLE cases.cases (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reference_number      TEXT         NOT NULL,
    title                 TEXT         NOT NULL,
    domain                TEXT         NOT NULL DEFAULT 'kesb',
    subject_name          TEXT         NOT NULL,
    subject_dob           DATE,
    status                TEXT         NOT NULL DEFAULT 'open',
    lead_user_id          UUID         REFERENCES users(id) ON DELETE SET NULL,
    confidentiality       TEXT         NOT NULL DEFAULT 'standard',
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_cases_status CHECK (status IN ('open', 'in_progress', 'review', 'completed', 'archived')),
    CONSTRAINT chk_cases_confidentiality CHECK (confidentiality IN ('standard', 'confidential', 'strictly_confidential')),
    CONSTRAINT chk_cases_domain CHECK (domain IN ('kesb', 'forensic_psychiatry', 'police', 'social', 'custom'))
);
CREATE INDEX idx_cases_org_status ON cases.cases (organization_id, status);
CREATE INDEX idx_cases_org_lead ON cases.cases (organization_id, lead_user_id);
CREATE INDEX idx_cases_ref ON cases.cases (organization_id, reference_number);

-- Related documents / evidence
CREATE TABLE cases.case_documents (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id               UUID         NOT NULL REFERENCES cases.cases(id) ON DELETE CASCADE,
    document_id           UUID         REFERENCES documents(id) ON DELETE SET NULL,
    title                 TEXT         NOT NULL,
    category              TEXT         NOT NULL DEFAULT 'evidence',
    extracted_text        TEXT,
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_case_docs_category CHECK (category IN ('court_decree', 'medical', 'police_report', 'evidence', 'correspondence', 'financial', 'other'))
);
CREATE INDEX idx_case_docs_case ON cases.case_documents (case_id);

-- Interviews & transcripts
CREATE TABLE cases.case_interviews (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id               UUID         NOT NULL REFERENCES cases.cases(id) ON DELETE CASCADE,
    interviewee_name      TEXT         NOT NULL,
    interviewee_role      TEXT         NOT NULL DEFAULT 'subject',
    interview_date        DATE         NOT NULL DEFAULT CURRENT_DATE,
    duration_minutes      INTEGER      DEFAULT 0,
    interviewer_user_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
    audio_document_id     UUID         REFERENCES documents(id) ON DELETE SET NULL,
    transcript_text       TEXT         NOT NULL,
    summary               TEXT,
    tags                  TEXT[]       NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_case_interviews_role CHECK (interviewee_role IN ('subject', 'witness', 'relative', 'expert', 'officer', 'informant', 'other'))
);
CREATE INDEX idx_case_interviews_case ON cases.case_interviews (case_id);

-- Client-changeable assessment templates
CREATE TABLE cases.assessment_templates (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id       UUID         REFERENCES organizations(id) ON DELETE CASCADE,
    name                  TEXT         NOT NULL,
    domain                TEXT         NOT NULL DEFAULT 'kesb',
    description           TEXT,
    sections              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    letterhead_config     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_default            BOOLEAN      NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_assessment_templates_org ON cases.assessment_templates (organization_id);

-- Assessments (evaluations / Gutachten)
CREATE TABLE cases.assessments (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id               UUID         NOT NULL REFERENCES cases.cases(id) ON DELETE CASCADE,
    template_id           UUID         NOT NULL REFERENCES cases.assessment_templates(id) ON DELETE RESTRICT,
    title                 TEXT         NOT NULL,
    status                TEXT         NOT NULL DEFAULT 'draft',
    sections_content      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    author_user_id        UUID         REFERENCES users(id) ON DELETE SET NULL,
    final_document_id     UUID         REFERENCES documents(id) ON DELETE SET NULL,
    version               INTEGER      NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_assessments_status CHECK (status IN ('draft', 'in_review', 'final', 'signed'))
);
CREATE INDEX idx_assessments_case ON cases.assessments (case_id);

-- Seed standard Swiss assessment templates (available globally)
INSERT INTO cases.assessment_templates (id, organization_id, name, domain, description, is_default, sections)
VALUES
(
    '00000000-0000-0000-c001-000000000001',
    NULL,
    'KESB Gefährdungsabklärung & Massnahmenantrag',
    'kesb',
    'Standardisiertes Abklärungsdossier für den Kindes- und Erwachsenenschutz (Art. 388 ff. ZGB)',
    true,
    '[
        {"key": "mandate", "title": "1. Ausgangslage & Gefährdungsmeldung", "description": "Anlass der Abklärung, beteiligte Behörden und Meldepersonen", "promptGuidance": "Fasse den Anlass der Gefährdungsmeldung und den formellen Auftrag der KESB zusammen.", "isRequired": true, "order": 1},
        {"key": "dossier_analysis", "title": "2. Aktenanalyse & Vorgeschichte", "description": "Auswertung vorliegender Amts- und Fachberichte", "promptGuidance": "Synthetisiere die wesentlichen Erkenntnisse aus den vorhandenen Akten und Vorberichten.", "isRequired": true, "order": 2},
        {"key": "interviews_summary", "title": "3. Befragungen & Stellungnahmen", "description": "Aussagen der betroffenen Person und Angehörigen", "promptGuidance": "Stelle die Aussagen aus den Einvernahmeprotokollen mit Zeitstempeln und Zitaten gegenüber.", "isRequired": true, "order": 3},
        {"key": "personal_health", "title": "4. Persönliche & gesundheitliche Situation", "description": "Urteilsfähigkeit, psychische und somatische Verfassung", "promptGuidance": "Beurteile den Gesundheitszustand und die Urteilsfähigkeit unter Verweis auf Arztberichte.", "isRequired": true, "order": 4},
        {"key": "social_housing", "title": "5. Wohn- & Betreuungssituation", "description": "Soziales Netz, Wohnumfeld und familiäre Ressourcen", "promptGuidance": "Beschreibe die Wohnsituation und das vorhandene Unterstützungsumfeld.", "isRequired": true, "order": 5},
        {"key": "financial", "title": "6. Finanzielle Verhältnisse & Administration", "description": "Einkommen, Schulden, Betreibungen, Vermögensverwaltung", "promptGuidance": "Fasse die finanzielle Lage, Betreibungsregisterauszüge und Administrationsfähigkeit zusammen.", "isRequired": true, "order": 6},
        {"key": "risk_assessment", "title": "7. Schutzbedürftigkeit & Verhältnismässigkeit", "description": "Schutzbedarf gemäss Art. 388 ZGB und Subsidiaritätsprüfung", "promptGuidance": "Prüfe die Notwendigkeit behördlicher Massnahmen und deren Verhältnismässigkeit.", "isRequired": true, "order": 7},
        {"key": "recommendation", "title": "8. Empfohlene behördliche Massnahme", "description": "Konkreter Massnahmenantrag (Begleit-, Vertretungs- oder Mitwirkungsbeistandschaft)", "promptGuidance": "Formuliere den konkreten Antrag an die KESB inklusive Aufgabenbereiche nach Art. 391 ff. ZGB.", "isRequired": true, "order": 8}
    ]'::jsonb
),
(
    '00000000-0000-0000-c001-000000000002',
    NULL,
    'Forensisch-psychiatrisches Gutachten',
    'forensic_psychiatry',
    'Strafrechtliches Gutachten zur Schuldfähigkeit (Art. 19/20 StGB) und Massnahmebedürftigkeit (Art. 56 ff. StGB)',
    true,
    '[
        {"key": "mandate", "title": "1. Auftrag & Fragestellungen des Gerichts", "description": "Auftraggeber, Beweisbeschluss und rechtliche Fragen", "promptGuidance": "Nenne die verfahrensleitende Behörde und die konkreten Fragen des Beweisbeschlusses.", "isRequired": true, "order": 1},
        {"key": "file_study", "title": "2. Aktenlage & Voraktenanalyse", "description": "Polizeirapporte, Strafregister, frühere Gutachten", "promptGuidance": "Fasse die aktenkundigen Vorstrafen und früheren Begutachtungen chronologisch zusammen.", "isRequired": true, "order": 2},
        {"key": "biography", "title": "3. Biographische Anamnese", "description": "Kindheit, Entwicklung, psychosozialer Werdegang", "promptGuidance": "Stelle die Lebensgeschichte und prägende Belastungsfaktoren strukturiert dar.", "isRequired": true, "order": 3},
        {"key": "clinical_exploration", "title": "4. Psychiatrische Exploration & Befund", "description": "Psychopathologischer Status bei den Explorationsterminen", "promptGuidance": "Dokumentiere den psychopathologischen Befund mit Verweisen auf die Explorationsgespräche.", "isRequired": true, "order": 4},
        {"key": "delict_analysis", "title": "5. Deliktsrekonstruktion & Handlungsdynamik", "description": "Tatablauf, innere Verfassung, Substanzkonsum zum Tatzeitpunkt", "promptGuidance": "Analysiere den Tatablauf und die psychische Verfassung des Exploranden während der Tat.", "isRequired": true, "order": 5},
        {"key": "diagnosis", "title": "6. Diagnostische Einordnung", "description": "Diagnosen nach ICD-10 / ICD-11 / DSM-5", "promptGuidance": "Leite die psychiatrischen Diagnosen nach anerkannten Kriterien her.", "isRequired": true, "order": 6},
        {"key": "culpability", "title": "7. Beurteilung der Schuldfähigkeit", "description": "Einsichts- und Steuerungsfähigkeit (Art. 19/20 StGB)", "promptGuidance": "Beurteile fundiert die Einsichts- und Steuerungsfähigkeit zum Deliktzeitpunkt.", "isRequired": true, "order": 7},
        {"key": "risk_prognosis", "title": "8. Kriminal- & Legalprognose", "description": "Rückfallrisiko für einschlägige Straftaten", "promptGuidance": "Formuliere eine strukturierte Risikobeurteilung bezüglich erneuter Delinquenz.", "isRequired": true, "order": 8},
        {"key": "intervention_recommendation", "title": "9. Massnahmeempfehlung & Therapierbarkeit", "description": "Therapeutische Massnahmen gemäss Art. 59, 60, 63 StGB", "promptGuidance": "Empfehle evidenzbasierte Behandlungsmassnahmen oder Vollzugsmodalitäten.", "isRequired": true, "order": 9}
    ]'::jsonb
),
(
    '00000000-0000-0000-c001-000000000003',
    NULL,
    'Polizeilicher Ermittlungs- & Situationsbericht',
    'police',
    'Zusammenfassender Ermittlungsbericht für die Staatsanwaltschaft (Art. 306/307 StPO)',
    true,
    '[
        {"key": "incident", "title": "1. Sachverhalt & Tatzeit/Tatort", "description": "Ort, Zeit und Meldungseingang", "promptGuidance": "Schildere den polizeilich festgestellten Sachverhalt präzise und objektiv.", "isRequired": true, "order": 1},
        {"key": "parties", "title": "2. Beteiligte Personen & Rollen", "description": "Beschuldigte, Geschädigte, Auskunftspersonen", "promptGuidance": "Führe alle beteiligten Personen mit Personalien und rechtlicher Rolle auf.", "isRequired": true, "order": 2},
        {"key": "evidence", "title": "3. Gesicherte Spuren & Beweismittel", "description": "Spurensicherung, sichergestellte Gegenstände, Dokumente", "promptGuidance": "Dokumentiere die sichergestellten Beweismittel und deren Relevanz.", "isRequired": true, "order": 3},
        {"key": "interview_findings", "title": "4. Einvernahmeprotokolle & Aussagewürdigung", "description": "Gegenüberstellung von Beschuldigten- und Zeugenaussagen", "promptGuidance": "Vergleiche die Einvernahmeaussagen, hebe Übereinstimmungen und Widersprüche hervor.", "isRequired": true, "order": 4},
        {"key": "deduction", "title": "5. Ermittlungsergebnisse & Ablaufrekonstruktion", "description": "Chronologische Rekonstruktion und Kriminalanalyse", "promptGuidance": "Stelle die chronologische Ereigniskette anhand der Beweislage dar.", "isRequired": true, "order": 5},
        {"key": "prosecutor_referral", "title": "6. Schlussbeurteilung & Überweisung", "description": "Antrag an die zuständige Staatsanwaltschaft", "promptGuidance": "Formuliere den formellen Abschluss und die Übergabe an die Staatsanwaltschaft.", "isRequired": true, "order": 6}
    ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
