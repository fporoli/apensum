import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bookColumns, BOOKING_COLUMNS, type BookingContext } from '../../apps/api/src/expense-booking';
import { missingReceiptAmount } from '../../apps/api/src/expenses.controller';
import { buildReceiptMessages, isHeic, parseReceiptAnswer, receiptImageMime } from '../../apps/api/src/expense-receipt';
import { ExpenseReceiptService } from '../../apps/api/src/expense-receipt.service';

const ctx: BookingContext = {
  reportingCurrency: 'CHF',
  rates: [{ currency: 'EUR', targetCurrency: 'CHF', validFrom: '2026-01-01', rate: 0.93 }],
  mileageRates: { '2000-01-01': '0.70' },
};

test('booking columns: a foreign receipt is booked in CHF with the rate kept', () => {
  const row = { category: 'meals', expense_date: '2026-11-15', original_value: '100.00', original_currency: 'EUR', value: '0', currency: 'EUR', quantity: null };
  assert.deepEqual(bookColumns(row, ctx), { ok: true, columns: { value: '93.00', currency: 'CHF', exchange_rate: '0.93', unit_rate: null } });
  assert.deepEqual(bookColumns({ ...row, original_currency: 'GBP' }, ctx), { ok: false, error: 'exchange-rate-missing' });
});

test('booking columns: mileage clears the receipt amount and keeps the rate per km', () => {
  const row = { category: 'mileage', expense_date: '2026-11-15', original_value: '5', original_currency: 'EUR', value: '1', currency: 'CHF', quantity: '42' };
  assert.deepEqual(bookColumns(row, ctx), {
    ok: true, columns: { value: '29.40', currency: 'CHF', exchange_rate: null, unit_rate: '0.7', original_value: null, original_currency: null },
  });
});

test('booking columns: a date change rebooks (the column list covers it)', () => {
  assert.ok(BOOKING_COLUMNS.includes('expense_date'));
  assert.ok(!BOOKING_COLUMNS.includes('comment' as never));
});

test('the receipt amount is required while the form shows it, never for mileage', () => {
  const missing = { ok: false, error: 'invalid-field', fields: [{ field: 'originalValue', rule: 'required' }] };
  assert.deepEqual(missingReceiptAmount({ category: 'meals', original_value: null }, true), missing);
  assert.equal(missingReceiptAmount({ category: 'meals', original_value: '12.00' }, true), null);
  assert.equal(missingReceiptAmount({ category: 'meals', original_value: null }, false), null, 'template hides it: amount entered directly');
  assert.equal(missingReceiptAmount({ category: 'mileage', original_value: null }, true), null);
});

test('receipt formats are told by their bytes', () => {
  assert.equal(receiptImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(receiptImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(receiptImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(receiptImageMime(Buffer.from('%PDF-1.7')), null);
  assert.equal(isHeic(Buffer.from('\0\0\0\x18ftypheic\0\0')), true);
  assert.equal(isHeic(Buffer.from('\0\0\0\x18ftypM4A \0\0')), false);
});

test('receipt messages: category list, then the image or the PDF text', () => {
  const m = buildReceiptMessages({ imageDataUrl: 'data:image/jpeg;base64,AAAA' }, { meals: 'Verpflegung' });
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /Rate nicht/);
  const parts = m[1].content;
  assert.deepEqual(parts[0], { type: 'text', text: 'Kategorien (Schlüssel: Bezeichnung):\nmeals: Verpflegung' });
  assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'high' } });
  assert.equal(buildReceiptMessages({ text: 'Total 12.00' }, {})[1].content[1].type, 'text');
});

test('receipt answer: only plainly valid values are taken, the rest stays empty', () => {
  const keys = ['meals', 'travel'];
  assert.deepEqual(parseReceiptAnswer('{"date":"2026-11-14","amount":"1\'234,50","currency":"chf","merchant":" Bahnhofbuffet Olten ","category":"meals"}', keys, '2026-11-19'),
    { expenseDate: '2026-11-14', originalValue: 1234.5, originalCurrency: 'CHF', merchant: 'Bahnhofbuffet Olten', category: 'meals' });
  assert.deepEqual(parseReceiptAnswer('```json\n{"date":"2027-01-01","amount":12,"currency":"Fr.","category":"hotel"}\n```', keys, '2026-11-19'),
    { expenseDate: null, originalValue: 12, originalCurrency: null, merchant: null, category: null }, 'future date, odd currency and unknown category dropped');
  assert.throws(() => parseReceiptAnswer('no json', keys, '2026-11-19'), /receipt-unreadable/);
  assert.throws(() => parseReceiptAnswer('{"date":null,"amount":null}', keys, '2026-11-19'), /receipt-unreadable/);
});

test('receipt scan: unreadable formats are refused before anything is reserved or sent', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    AI_MONTHLY_BUDGET_CHF: '5', AZURE_TRANSCRIBE_CHF_PER_HOUR: '1', AZURE_OPENAI_CHF_PER_1M_INPUT: '0.5', AZURE_OPENAI_CHF_PER_1M_OUTPUT: '2',
    AZURE_OPENAI_ENDPOINT: 'https://apensum-openai-ch.openai.azure.com', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1-mini',
  });
  delete process.env.AI_AZURE_ENABLED;
  try {
    let reserved = 0;
    const service = new ExpenseReceiptService({ reserve: async () => { reserved++; return 'x'; } } as never, { settings: async () => ({ monthlyLimitChf: 10 }) } as never);
    assert.equal(service.available(), true);
    await assert.rejects(service.scan('o', 'u', Buffer.from('\0\0\0\x18ftypheic\0\0'), {}, '2026-11-19'), /receipt-heic/);
    await assert.rejects(service.scan('o', 'u', Buffer.from('plain text'), {}, '2026-11-19'), /receipt-format/);
    assert.equal(reserved, 0);
    process.env.AI_AZURE_ENABLED = 'false';
    assert.equal(service.available(), false);
    await assert.rejects(service.scan('o', 'u', Buffer.from([0xff, 0xd8, 0xff]), {}, '2026-11-19'), /ai-provider-not-configured/);
  } finally {
    process.env = saved;
  }
});

test('booking columns: a receipt amount without currency is in the reporting currency; an override is booked as entered', () => {
  const row = { category: 'meals', expense_date: '2026-11-15', original_value: '18.40', original_currency: null, value: '999', quantity: null };
  assert.deepEqual(bookColumns(row, ctx), { ok: true, columns: { value: '18.40', currency: 'CHF', exchange_rate: null, unit_rate: null, original_currency: 'CHF' } });
  const card = { ...row, original_value: '50', original_currency: 'USD', value: '44.15' };
  assert.deepEqual(bookColumns(card, ctx), { ok: false, error: 'exchange-rate-missing' });
  assert.deepEqual(bookColumns(card, ctx, true), { ok: true, columns: { value: '44.15', currency: 'CHF', exchange_rate: '0.883', unit_rate: null } });
});
