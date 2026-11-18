import { test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { extractPdfText, isPdf, MAX_EXTRACTED_CHARS, tidyExtractedText } from '../../apps/api/src/case-document-text';

function pdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

test('a PDF is recognized by its bytes, not its name', () => {
  assert.equal(isPdf(Buffer.from('%PDF-1.7\n...')), true);
  assert.equal(isPdf(Buffer.from('PK\u0003\u0004 a zip')), false);
  assert.equal(isPdf(Buffer.from('%PD')), false);
});

test('the text layer of a PDF is read, across pages, with umlauts', async () => {
  const bytes = await pdf((doc) => {
    doc.fontSize(12).text('Austrittsbericht Jonas Meier');
    doc.text('Diagnose: Paranoide Schizophrenie (ICD-10 F20.01). Mietzinsausstände rund CHF 4\'800.');
    doc.addPage().text('Empfehlung: Prüfung einer Unterstützung in finanziellen Angelegenheiten.');
  });
  const text = await extractPdfText(bytes);
  assert.ok(text, 'text expected');
  for (const part of ['Austrittsbericht Jonas Meier', 'F20.01', 'Mietzinsausstände', 'Prüfung einer Unterstützung']) {
    assert.ok(text.includes(part), part);
  }
});

test('a PDF without a text layer (like a scan), a broken PDF and another file give null', async () => {
  const scan = await pdf((doc) => {
    doc.rect(50, 50, 200, 100).fill('#888');
  });
  assert.equal(await extractPdfText(scan), null);
  assert.equal(await extractPdfText(Buffer.from('%PDF-1.7 not really a pdf')), null);
  assert.equal(await extractPdfText(Buffer.from('plain text')), null);
});

test('extracted text is tidied and clipped', () => {
  assert.equal(tidyExtractedText('  Zeile 1  \r\n\r\n\r\n\r\n   Zeile\t\t2  '), 'Zeile 1\n\nZeile 2');
  assert.equal(tidyExtractedText(' \n\t '), null);
  assert.equal(tidyExtractedText('x'.repeat(MAX_EXTRACTED_CHARS + 10))?.length, MAX_EXTRACTED_CHARS);
});
