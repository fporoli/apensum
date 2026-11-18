/**
 * AI summary of one interview transcript (cases.controller.ts `interviews/:id/summarize`, when the
 * organization chose a model for summaries). Pure: builds the messages and reads the answer back,
 * so both are tested without a provider. Like the assessment draft (case-ai-draft.ts), the model
 * restates only what the transcript says and marks gaps; the person reviews it before saving.
 */

/** Characters of the transcript sent at most, and of the summary kept. */
export const AI_SUMMARY_TRANSCRIPT_CHARS = 60_000;
export const AI_SUMMARY_CHARS = 6_000;
/** Answer tokens allowed (also what the cost estimate assumes). */
export const AI_SUMMARY_MAX_TOKENS = 1_500;

const SYSTEM = [
  'Du fasst eine Befragung für eine Fachperson in der Schweiz zusammen.',
  'Regeln:',
  '1. Verwende ausschliesslich Aussagen aus dem Transkript. Erfinde nichts: keine Diagnosen, Daten, Zitate oder Personen.',
  '2. Gib wieder, was die befragte Person sagt, ohne es zu bewerten oder rechtliche bzw. fachliche Schlüsse zu ziehen.',
  '3. Ist eine Stelle unverständlich oder widersprüchlich, schreibe "[Offen: <was unklar ist>]".',
  '4. Höchstens 12 kurze Punkte, je eine Zeile beginnend mit "- ", wichtigste Aussagen zuerst.',
  '5. Schreibe in der Sprache des Transkripts (Schweizerdeutsch als Hochdeutsch), Schweizer Schreibweise (ss statt ß).',
  '6. Antworte nur mit den Punkten, ohne Einleitung.',
].join('\n');

export function buildAiSummaryMessages(interview: { name: string; role: string; date: string; transcript: string }) {
  const t = interview.transcript.trim();
  const transcript = t.length > AI_SUMMARY_TRANSCRIPT_CHARS ? `${t.slice(0, AI_SUMMARY_TRANSCRIPT_CHARS)} […gekürzt]` : t;
  return [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: `# Befragung: ${interview.name} (${interview.role}), ${interview.date}\nTranskript:\n${transcript}` },
  ];
}

/** The model's answer as the summary draft; throws 'ai-summary-invalid' when there is none. */
export function parseAiSummary(answer: string | null | undefined): string {
  const text = (answer ?? '').trim().replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
  if (!text || text.includes('\0')) throw new Error('ai-summary-invalid');
  return text.length > AI_SUMMARY_CHARS ? `${text.slice(0, AI_SUMMARY_CHARS - 1).trimEnd()}…` : text;
}
