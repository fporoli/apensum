// Cases: the assessment as a Word document, built where the content is readable (the browser), so it works for
// encrypted cases too and nothing is sent anywhere. No dependency: a .docx is a ZIP of XML (the xlsx writer's zip).
// The layout follows the server's PDF (api/cases.service.ts); labels are German like the PDF's.
import { zipStored } from '@worktime3/shared/xlsx';
import type { AssessmentTemplateSection } from './cases';

export interface DocxInput {
  title: string;
  templateName: string;
  version: number;
  status: string;
  createdAt: string;
  confidentiality: string;
  case: { reference_number: string; subject_name: string; subject_dob: string | null; lead_user_name?: string | null };
  sections: AssessmentTemplateSection[];
  contents: Record<string, string>;
  documents: { category: string; title: string; file_name?: string | null }[];
  interviews: { interview_date: string; interviewee_name: string; interviewee_role: string; duration_minutes: number }[];
  /** The date printed in the signature block (default: today). */
  date?: string;
}

const enc = new TextEncoder();
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

interface RunStyle { bold?: boolean; italic?: boolean; size?: number; color?: string }

const run = (text: string, st: RunStyle = {}) =>
  `<w:r><w:rPr>${st.bold ? '<w:b/>' : ''}${st.italic ? '<w:i/>' : ''}${st.color ? `<w:color w:val="${st.color}"/>` : ''}${st.size ? `<w:sz w:val="${st.size * 2}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (text: string, st: RunStyle = {}, opts: { align?: 'left' | 'center' | 'both'; after?: number } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${opts.after ?? 120}"/>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ''}</w:pPr>${run(text, st)}</w:p>`;

/** Each line of a text becomes its own paragraph (Word has no soft newline in a run without <w:br/>). */
const block = (text: string, st: RunStyle = {}, opts: { align?: 'left' | 'center' | 'both'; after?: number } = {}) =>
  text.split(/\r?\n/).map((line) => para(line, st, opts)).join('');

const row = (label: string, value: string) =>
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>${para(label, { bold: true, size: 10 }, { after: 40 })}</w:tc>` +
  `<w:tc><w:tcPr><w:tcW w:w="6200" w:type="dxa"/></w:tcPr>${para(value, { size: 10 }, { after: 40 })}</w:tc></w:tr>`;

const CONFIDENTIALITY: Record<string, string> = {
  strictly_confidential: 'STRENG VERTRAULICH — AMTS- UND BERUFSGEHEIMNIS (ART. 321 STGB)',
  confidential: 'VERTRAULICH — DIENSTGEHEIMNIS',
};

/** The assessment as a .docx file (bytes). */
export function buildAssessmentDocx(input: DocxInput): Uint8Array<ArrayBuffer> {
  const primary = '1E3A8A', slate = '475569', crimson = 'B91C1C';
  const c = input.case;
  const body: string[] = [];

  body.push(para(CONFIDENTIALITY[input.confidentiality] ?? 'AMTLICHE BEURTEILUNG', { bold: true, size: 9, color: crimson }, { align: 'center', after: 200 }));
  body.push(para(input.title, { bold: true, size: 18, color: primary }, { after: 80 }));
  body.push(para(`Vorlage: ${input.templateName} (Version ${input.version})`, { italic: true, size: 10, color: slate }, { after: 200 }));

  body.push(
    `<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:tblBorders>` +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join('') +
      `</w:tblBorders></w:tblPr>` +
      row('Geschäfts-Nr. / Referenz:', c.reference_number) +
      row('Betroffene Person / Explorand:', `${c.subject_name}${c.subject_dob ? ` (geb. ${c.subject_dob})` : ''}`) +
      row('Federführung / Gutachter:', c.lead_user_name ?? 'Zuständige Amtsstelle') +
      row('Status & Datum:', `${input.status.toUpperCase()} — Erstellt am ${input.createdAt.slice(0, 10)}`) +
      `</w:tbl>`,
  );
  body.push(para('', {}, { after: 120 }));

  body.push(para('Verzeichnis der berücksichtigten Akten & Einvernahmen:', { bold: true, size: 11, color: primary }, { after: 80 }));
  if (input.documents.length === 0 && input.interviews.length === 0) {
    body.push(para('Keine gesonderten Aktenanhänge oder Protokolle verzeichnet.', { size: 9 }));
  } else {
    if (input.documents.length) {
      body.push(para(`Aktenbestand (${input.documents.length}):`, { bold: true, size: 9 }, { after: 40 }));
      for (const d of input.documents) body.push(para(`• [${d.category}] ${d.title}${d.file_name ? ` (${d.file_name})` : ''}`, { size: 9 }, { after: 20 }));
    }
    if (input.interviews.length) {
      body.push(para(`Einvernahmen & Befragungsprotokolle (${input.interviews.length}):`, { bold: true, size: 9 }, { after: 40 }));
      for (const i of input.interviews) body.push(para(`• ${i.interview_date}: ${i.interviewee_name} (${i.interviewee_role}, ${i.duration_minutes} Min.)`, { size: 9 }, { after: 20 }));
    }
  }
  body.push(para('', {}, { after: 200 }));

  for (const sec of input.sections) {
    body.push(para(sec.title, { bold: true, size: 12, color: primary }, { after: 40 }));
    if (sec.description) body.push(para(sec.description, { italic: true, size: 8.5, color: slate }, { after: 80 }));
    body.push(block(input.contents[sec.key] || 'Keine Angaben verfasst.', { size: 9.5 }, { align: 'both', after: 80 }));
    body.push(para('', {}, { after: 120 }));
  }

  const date = input.date ?? new Date().toLocaleDateString('de-CH');
  body.push(para(`Ort und Datum: ...................................., den ${date}`, { size: 9.5 }, { after: 400 }));
  body.push(para('Unterschrift Gutachter / Fallführung:                              Genehmigung Amtsleitung / KESB:', { size: 9.5 }, { after: 600 }));
  body.push(para(`${c.lead_user_name ?? 'Fachgutachter'}                                                    Behördenpräsidium / Fachdienst`, { bold: true, size: 9.5 }));

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1200" w:left="1100" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', document],
  ];
  return zipStored(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
