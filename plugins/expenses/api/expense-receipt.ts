/**
 * Receipt recognition for the expense form (POST organizations/:orgId/expenses/scan-receipt): a photo
 * or PDF of a receipt goes to Azure OpenAI in Switzerland, which returns date, amount, currency,
 * merchant and a category from the organization's list. Only a suggestion: the person checks the
 * form before saving. Pure: builds the messages and reads the answer, so both are tested without
 * a provider. The call itself (budget, provider) is ExpenseReceiptService.
 */

/** Answer tokens allowed (also what the cost estimate assumes). */
export const RECEIPT_MAX_TOKENS = 400;
/** Characters of a PDF's text sent at most. */
export const RECEIPT_TEXT_CHARS = 12_000;
/** Input characters an image counts as for the cost estimate (~3000 tokens at high detail, on the high side). */
export const RECEIPT_IMAGE_ESTIMATE_CHARS = 9_000;

/** Image formats the model reads, from the file bytes (not the name or the browser's MIME type). */
export function receiptImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('latin1', 0, 6))) return 'image/gif';
  return null;
}

/** An iPhone photo (HEIC/HEIF), which the model can't read: the browser should send JPEG. */
export function isHeic(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|heif|mif1|msf1)$/.test(bytes.toString('latin1', 8, 12));
}

const SYSTEM = [
  'Du liest einen Kassenbeleg oder eine Rechnung für eine Spesenabrechnung in der Schweiz.',
  'Antworte nur mit JSON: {"date": "YYYY-MM-DD" | null, "amount": number | null, "currency": "ISO-4217" | null, "merchant": string | null, "category": <einer der Schlüssel> | null}.',
  'Regeln:',
  '1. amount ist der bezahlte Gesamtbetrag (Total inkl. MWST und Trinkgeld, falls ausgewiesen), als Zahl mit Punkt.',
  '2. currency nur, wenn sie auf dem Beleg steht oder eindeutig ist (z. B. "Fr." oder "CHF" = CHF, "€" = EUR).',
  '3. date ist das Belegdatum. Zweistellige Jahre sind 20xx.',
  '4. category nur aus der gelieferten Liste wählen; passt keine sicher, dann null.',
  '5. Ist etwas unleserlich oder fehlt es, gib null zurück. Rate nicht.',
].join('\n');

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

/** The chat messages: the category list, then the receipt as an image (data URL) or as its PDF text. */
export function buildReceiptMessages(receipt: { imageDataUrl?: string; text?: string }, categories: Record<string, string>) {
  const list = Object.entries(categories).map(([key, label]) => `${key}: ${label}`).join('\n') || '(keine)';
  const parts: Part[] = [{ type: 'text', text: `Kategorien (Schlüssel: Bezeichnung):\n${list}` }];
  if (receipt.imageDataUrl) parts.push({ type: 'image_url', image_url: { url: receipt.imageDataUrl, detail: 'high' } });
  if (receipt.text) {
    const t = receipt.text.trim();
    parts.push({ type: 'text', text: `Text des Belegs:\n${t.length > RECEIPT_TEXT_CHARS ? t.slice(0, RECEIPT_TEXT_CHARS) : t}` });
  }
  return [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: parts },
  ];
}

export interface ReceiptSuggestion {
  expenseDate: string | null;
  originalValue: number | null;
  originalCurrency: string | null;
  merchant: string | null;
  category: string | null;
}

/**
 * The model's answer as form values; anything not plainly valid becomes null, so a wrong guess
 * is left empty rather than filled in. `today` bounds the date (no receipts from the future).
 */
export function parseReceiptAnswer(answer: string | null | undefined, categoryKeys: readonly string[], today: string): ReceiptSuggestion {
  const raw = (answer ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    o = parsed as Record<string, unknown>;
  } catch {
    throw new Error('receipt-unreadable');
  }
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !Number.isNaN(Date.parse(`${o.date}T00:00:00Z`))
    && o.date <= today && o.date >= '2000-01-01' ? o.date : null;
  const amountRaw = typeof o.amount === 'string' ? Number(o.amount.replace(/['\s]/g, '').replace(',', '.')) : o.amount;
  const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0 && amountRaw < 10_000_000 ? Math.round(amountRaw * 100) / 100 : null;
  const currency = typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim()) ? o.currency.trim().toUpperCase() : null;
  const merchant = typeof o.merchant === 'string' && o.merchant.trim() ? o.merchant.trim().slice(0, 120) : null;
  const category = typeof o.category === 'string' && categoryKeys.includes(o.category) ? o.category : null;
  if (date === null && amount === null) throw new Error('receipt-unreadable');
  return { expenseDate: date, originalValue: amount, originalCurrency: currency, merchant, category };
}
