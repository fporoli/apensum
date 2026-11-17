import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { buildCsv, buildXlsx, columnName } from './xlsx.ts';

/** The stored entries of a ZIP (enough for archives this module writes), checking each CRC. */
function entries(buf) {
  const b = Buffer.from(buf);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < b.readUInt16LE(eocd + 10); i++) {
    const crc = b.readUInt32LE(p + 16);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString();
    const start = local + 30 + b.readUInt16LE(local + 26);
    const data = b.subarray(start, start + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out[name] = data.toString();
    p += 46 + nameLen;
  }
  return out;
}

test('columnName counts like Excel', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('buildXlsx: a valid package with header, numbers as numbers, escaped text and totals', () => {
  const files = entries(buildXlsx('Projekt: Stunden?', [{ header: 'Person', kind: 'text' }, { header: 'Stunden', kind: 'number' }], [['Anna <A&B>', 3.5], ['Ueli', null]], ['Total', 3.5]));
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">Anna &lt;A&amp;B&gt;<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B2" s="2"><v>3.5<\/v><\/c>/);
  assert.match(sheet, /<row r="3"><c r="A3"[^>]*>.*Ueli.*<\/row>/);
  assert.match(sheet, /<c r="B4" s="3"><v>3.5<\/v><\/c>/, 'bold total');
  assert.match(files['xl/workbook.xml'], /name="Projekt  Stunden "/, 'no characters Excel forbids in sheet names');
});

test('buildXlsx gives the same bytes for the same input', () => {
  const a = buildXlsx('S', [{ header: 'x', kind: 'number' }], [[1]]);
  const b = buildXlsx('S', [{ header: 'x', kind: 'number' }], [[1]]);
  assert.deepEqual(a, b);
});

test('buildCsv: BOM, semicolons, quoting, two decimals at most', () => {
  assert.equal(
    buildCsv(['Name', 'Stunden'], [['Muster; Anna', 1.006], ['Ueli "U"', null], ['Zoë', 2]]),
    '﻿Name;Stunden\r\n"Muster; Anna";1.01\r\n"Ueli ""U""";\r\nZoë;2\r\n',
  );
});
