import type { AssessmentTemplateSection } from '../shared/cases';

/**
 * AI draft of an assessment (cases.controller.ts `assessments/ai-draft`), allowed per template
 * (`assessment_templates.ai_allowed`). Pure: builds the messages from the case material and reads
 * the model's answer back, so both are tested without a provider. The model may only restate what
 * the material says; gaps and every judgement are left to the expert as `[Offen: …]` markers.
 */

export interface AiDraftMaterial {
  caseInfo: { reference: string; title: string; subjectName: string; subjectDob: string | null; domain: string; lead: string | null };
  template: { name: string; description: string | null; sections: AssessmentTemplateSection[] };
  documents: { title: string; category: string; fileName: string | null; text: string | null }[];
  interviews: { name: string; role: string; date: string; summary: string | null; transcript: string | null }[];
}

/** Characters of one document's text, one transcript, and all material together, sent at most. */
export const AI_DOC_CHARS = 20_000;
export const AI_TRANSCRIPT_CHARS = 30_000;
export const AI_TOTAL_CHARS = 300_000;
/** Answer tokens allowed (also what the cost estimate assumes). */
export const AI_DRAFT_MAX_TOKENS = 8_000;
/** Characters kept per section of the answer. */
export const AI_SECTION_CHARS = 20_000;

const SYSTEM = [
  'Du unterstützt eine Fachperson in der Schweiz beim Entwurf eines Gutachtens bzw. Berichts.',
  'Regeln:',
  '1. Verwende ausschliesslich Tatsachen aus dem gelieferten Material. Erfinde nichts: keine Diagnosen, Befunde, Daten, Zitate oder Personen.',
  '2. Ziehe keine rechtlichen oder fachlichen Schlussfolgerungen und stelle keine Anträge, die nicht ausdrücklich im Material stehen.',
  '   Wo der Abschnitt eine Beurteilung oder Empfehlung verlangt, schreibe "[Offen: Beurteilung durch die Fachperson]" und fasse nur die dafür relevanten Fakten zusammen.',
  '3. Fehlt eine Information, schreibe "[Offen: <was fehlt>]".',
  '4. Nenne bei Aussagen die Quelle in Klammern, z. B. "(Befragung Anna Muster, 2026-03-02)" oder "(Dokument: Arztbericht)".',
  '5. Schreibe sachlich, in der Sprache der Abschnittstitel, Schweizer Schreibweise (ss statt ß).',
  '6. Antworte nur mit JSON: {"sections": {"<Abschnitts-key>": "<Text>", ...}} mit genau den Keys der Vorlage.',
].join('\n');

function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max)} […gekürzt]` : t;
}

export function buildAiDraftMessages(m: AiDraftMaterial): { role: 'system' | 'user'; content: string }[] {
  const parts: string[] = [];
  const c = m.caseInfo;
  parts.push(
    `# Fall\nDossier: ${c.reference}\nTitel: ${c.title}\nBetroffene Person: ${c.subjectName}${c.subjectDob ? ` (geb. ${c.subjectDob})` : ''}\n` +
      `Bereich: ${c.domain}\nFederführung: ${c.lead ?? '-'}`,
  );
  const sections = [...m.template.sections].sort((a, b) => a.order - b.order);
  parts.push(
    `# Vorlage: ${m.template.name}\n${m.template.description ?? ''}\n\n` +
      sections
        .map((s) => `## key: ${s.key}\nTitel: ${s.title}${s.description ? `\nInhalt: ${s.description}` : ''}${s.promptGuidance ? `\nAnleitung: ${s.promptGuidance}` : ''}`)
        .join('\n\n'),
  );
  let used = parts.join('\n\n').length;
  const add = (block: string) => {
    if (used + block.length > AI_TOTAL_CHARS) return false;
    parts.push(block);
    used += block.length;
    return true;
  };
  let skipped = 0;
  for (const d of m.documents) {
    const block = `# Dokument: ${d.title} (${d.category}${d.fileName ? `, ${d.fileName}` : ''})\n${clip(d.text, AI_DOC_CHARS) || '[kein Text extrahiert]'}`;
    if (!add(block)) skipped++;
  }
  for (const i of m.interviews) {
    const block =
      `# Befragung: ${i.name} (${i.role}), ${i.date}\n` +
      (i.summary ? `Zusammenfassung: ${i.summary.trim()}\n` : '') +
      `Transkript:\n${clip(i.transcript, AI_TRANSCRIPT_CHARS) || '[kein Transkript]'}`;
    if (!add(block)) skipped++;
  }
  if (skipped) parts.push(`# Hinweis\n${skipped} weitere Unterlage(n) wurden wegen der Grösse nicht mitgeschickt.`);
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** The model's JSON answer as section texts: only the template's keys, strings, clipped. */
export function parseAiDraft(answer: string, sections: AssessmentTemplateSection[]): Record<string, string> {
  const raw = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ai-draft-invalid');
  }
  const obj = parsed && typeof parsed === 'object' ? (parsed as { sections?: unknown }).sections ?? parsed : null;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ai-draft-invalid');
  const out: Record<string, string> = {};
  for (const s of sections) {
    const value = (obj as Record<string, unknown>)[s.key];
    if (typeof value === 'string' && value.trim()) out[s.key] = value.trim().slice(0, AI_SECTION_CHARS);
  }
  if (Object.keys(out).length === 0) throw new Error('ai-draft-invalid');
  return out;
}
