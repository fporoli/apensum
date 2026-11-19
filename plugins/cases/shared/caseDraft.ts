// Cases: the rule-based assessment draft, pure so the server (plain cases) and the browser (encrypted cases,
// which the server cannot read) build the same text. Erasable TypeScript, type-only imports.
import type { AssessmentTemplate, AssessmentTemplateSection, Case, CaseDocument, CaseInterview } from './cases';

/** Placeholder for every judgement in a rule-based draft: the draft never states findings itself. */
export const OPEN_ASSESSMENT = '[Offen: Beurteilung durch die Fachperson]';

/** A draft out of the case, its documents and interviews: the dossier's facts woven into the template's sections. */
export function buildRuleDraft(
  c: Pick<Case, 'reference_number' | 'title' | 'subject_name' | 'subject_dob' | 'lead_user_name'>,
  template: Pick<AssessmentTemplate, 'name' | 'domain' | 'sections'>,
  documents: Pick<CaseDocument, 'category' | 'title' | 'file_name' | 'extracted_text'>[],
  interviews: Pick<CaseInterview, 'interviewee_name' | 'interviewee_role' | 'interview_date' | 'duration_minutes' | 'summary' | 'summary_stale' | 'transcript_text' | 'transcript_stale'>[],
): { title: string; sections_content: Record<string, string> } {
    const title = `${template.name} — ${c.subject_name} (${c.reference_number})`;
    const sections_content: Record<string, string> = {};

    const sections = template.sections as AssessmentTemplateSection[];

    for (const sec of sections) {
      let draftText = '';
      const key = sec.key.toLowerCase();

      if (key.includes('mandat') || key.includes('ausgangslage') || key.includes('incident') || key.includes('auftrag')) {
        draftText =
          `Dossier: ${c.reference_number}\n` +
          `Betroffene Person: ${c.subject_name}` + (c.subject_dob ? ` (geb. ${c.subject_dob})` : '') + `\n` +
          `Federführende Stelle / Gutachter: ${c.lead_user_name ?? 'Zuständige Fachperson'}\n\n` +
          `Gegenstand der vorliegenden Beurteilung ist die Abklärung betreffend ${c.title}. ` +
          `Die Abklärung erfolgt unter Wahrung des gesetzlichen Verhältnismässigkeitsprinzips sowie der schutzwürdigen Interessen der beteiligten Personen.`;
      } else if (key.includes('akte') || key.includes('dossier') || key.includes('evidence') || key.includes('spuren') || key.includes('vorakten')) {
        if (documents.length === 0) {
          draftText = `Zum aktuellen Zeitpunkt sind im Dossier keine externen Dokumente oder Belege verzeichnet.`;
        } else {
          draftText = `Im vorliegenden Verfahren wurden ${documents.length} Dokument(e) und Beweismittel ausgewertet:\n\n`;
          for (const doc of documents) {
            draftText += `• [${doc.category.toUpperCase()}] ${doc.title} (${doc.file_name ?? 'Aktennotiz'})\n`;
            if (doc.extracted_text) {
              const snippet = doc.extracted_text.slice(0, 300).trim().replace(/\n+/g, ' ');
              draftText += `  Auszug/Erkenntnis: "${snippet}${doc.extracted_text.length > 300 ? '...' : ''}"\n`;
            }
          }
        }
      } else if (key.includes('interview') || key.includes('befragung') || key.includes('einvernahme') || key.includes('exploration') || key.includes('findings')) {
        if (interviews.length === 0) {
          draftText = `Bisher wurden keine Einvernahmen oder Explorationsgespräche protokolliert.`;
        } else {
          draftText = `Die Würdigung stützt sich auf ${interviews.length} durchgeführte Befragung(en):\n\n`;
          for (const inv of interviews) {
            draftText += `• Befragung von ${inv.interviewee_name} (${inv.interviewee_role}) vom ${inv.interview_date} (Dauer: ${inv.duration_minutes} Min.)\n`;
            if (inv.summary && !inv.summary_stale) {
              draftText += `  Zusammenfassung: ${inv.summary}\n`;
            }
            if (inv.transcript_text && !inv.transcript_stale) {
              const preview = inv.transcript_text.slice(0, 250).trim().replace(/\n+/g, ' ');
              draftText += `  Protokollauszug: "${preview}..."\n`;
            }
          }
        }
      } else if (key.includes('gesundheit') || key.includes('health') || key.includes('biography') || key.includes('anamnese') || key.includes('clinical')) {
        const medicalDocs = documents.filter((d) => d.category === 'medical');
        draftText = `Gesundheitliche und anamnestische Abklärung bezüglich ${c.subject_name}:\n\n`;
        if (medicalDocs.length > 0) {
          draftText += `Vorliegende medizinische/psychiatrische Berichte (${medicalDocs.map((m) => m.title).join(', ')}):\n`;
          for (const m of medicalDocs) {
            if (m.extracted_text) {
              draftText += `• ${m.title}: ${m.extracted_text.slice(0, 200).trim()}...\n`;
            }
          }
        } else {
          draftText += `Zurzeit liegen keine Arztberichte im Dossier vor.\n\n${OPEN_ASSESSMENT}`;
        }
      } else if (key.includes('schuld') || key.includes('delict') || key.includes('tat') || key.includes('deduction') || key.includes('rekonstruktion')) {
        draftText =
          `Analyse des Sachverhalts und Handlungsdynamik:\n` +
          `Grundlagen: ${documents.length} Dokument(e); Befragungen von ${interviews.map((i) => i.interviewee_name).join(', ') || '-'}.\n\n` +
          OPEN_ASSESSMENT;
      } else if (key.includes('empfehl') || key.includes('recommendation') || key.includes('antrag') || key.includes('referral') || key.includes('schluss')) {
        // Conclusions, findings and motions are the expert's: the draft names what to decide, never decides it.
        const motions: Record<string, string> = {
          kesb: 'Antrag an die Kindes- und Erwachsenenschutzbehörde (KESB)',
          forensic_psychiatry: 'Beantwortung der richterlichen Fragestellungen',
          police: 'Schlussantrag an die Staatsanwaltschaft',
        };
        draftText = `${motions[template.domain] ?? 'Zusammenfassende Beurteilung und Empfehlung'}:\n\n${OPEN_ASSESSMENT}`;
      } else {
        draftText = sec.promptGuidance
          ? `${sec.promptGuidance}\n\n[Befund für ${c.subject_name} (${c.reference_number}) basierend auf ${documents.length} Dokumenten und ${interviews.length} Befragungen]`
          : `Beurteilung für Abschnitt "${sec.title}".`;
      }

      sections_content[sec.key] = draftText;
    }

    return { title, sections_content };
}
