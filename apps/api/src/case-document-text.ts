/**
 * Text of an uploaded case document, for `case_documents.extracted_text` (read by the rule-based
 * and the AI assessment drafts). PDFs are read with unpdf (Mozilla's pdf.js, no native code):
 * only their text layer, so a scanned PDF without one yields nothing (no OCR). Best effort:
 * a broken or huge file gives null and never fails the upload.
 */

/** Characters kept and pages read at most. */
export const MAX_EXTRACTED_CHARS = 200_000;
export const MAX_PDF_PAGES = 300;

/** A PDF by its bytes (`%PDF-`), not by the name or MIME type the browser sent. */
export function isPdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.toString('latin1', 0, 5) === '%PDF-';
}

/** Collapses the layout whitespace pdf.js leaves, keeping paragraphs; clipped to the limit. */
export function tidyExtractedText(text: string): string | null {
  const tidy = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy ? tidy.slice(0, MAX_EXTRACTED_CHARS) : null;
}

export async function extractPdfText(bytes: Buffer): Promise<string | null> {
  if (!isPdf(bytes)) return null;
  try {
    const { getDocumentProxy, extractText } = await import('unpdf');
    // A copy: pdf.js takes over (detaches) the buffer it is given. Verbosity 0: errors only, no
    // warnings about the file's structure in the API log.
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    try {
      if (pdf.numPages > MAX_PDF_PAGES) return null;
      const { text } = await extractText(pdf, { mergePages: true });
      return tidyExtractedText(text);
    } finally {
      await pdf.cleanup();
    }
  } catch {
    return null;
  }
}
