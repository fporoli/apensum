import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildAssessmentDocx } from '../shared/caseDocx';

/** Reads a stored (uncompressed) zip: name -> text, by walking the local headers. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true), nameLen = v.getUint16(p + 26, true), extra = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
    out[name] = new TextDecoder().decode(bytes.subarray(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size));
    p += 30 + nameLen + extra + size;
  }
  return out;
}

const sections = [
  { key: 'a', title: '1. Ausgangslage', description: 'Anlass', promptGuidance: '', isRequired: true, order: 1 },
  { key: 'b', title: '2. Würdigung', description: '', promptGuidance: '', isRequired: true, order: 2 },
];

test('the Word file is a valid package with the content, escaped', () => {
  const bytes = buildAssessmentDocx({
    title: 'Gutachten <Müller> & Co', templateName: 'KESB', version: 3, status: 'draft', createdAt: '2026-05-01T10:00:00Z', confidentiality: 'strictly_confidential',
    case: { reference_number: 'K-1', subject_name: 'Max "Muster"', subject_dob: '1980-01-02', lead_user_name: 'Anna' },
    sections, contents: { a: 'Zeile eins\nZeile <zwei>', b: '' },
    documents: [{ category: 'medical', title: 'Bericht', file_name: 'b.pdf' }],
    interviews: [{ interview_date: '2026-01-01', interviewee_name: 'Eva', interviewee_role: 'witness', duration_minutes: 30 }],
    date: '01.05.2026',
  });
  const files = unzip(bytes);
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
  const doc = files['word/document.xml'];
  assert.match(doc, /Gutachten &lt;Müller&gt; &amp; Co/);
  assert.match(doc, /Max &quot;Muster&quot; \(geb\. 1980-01-02\)/);
  assert.match(doc, /STRENG VERTRAULICH/);
  assert.match(doc, /Zeile eins/);
  assert.match(doc, /Zeile &lt;zwei&gt;/);
  assert.match(doc, /Keine Angaben verfasst\./); // empty section
  assert.match(doc, /\[medical\] Bericht \(b\.pdf\)/);
  assert.ok(!/<zwei>|<Müller>/.test(doc));
  // every & is part of an entity; tags are balanced for the elements used
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(doc));
  for (const tag of ['w:p', 'w:r', 'w:t', 'w:tbl', 'w:tr', 'w:tc']) {
    assert.equal((doc.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length, (doc.match(new RegExp(`</${tag}>`, 'g')) ?? []).length, tag);
  }
});

test('same input, same bytes', () => {
  const input = { title: 'T', templateName: 'N', version: 1, status: 'draft', createdAt: '2026-01-01', confidentiality: 'standard', case: { reference_number: 'R', subject_name: 'S', subject_dob: null }, sections, contents: {}, documents: [], interviews: [], date: 'x' };
  assert.deepEqual(buildAssessmentDocx(input), buildAssessmentDocx(input));
});
