// Generates docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-c.pdf:
// a second synthetic vector lab report for fixture-patient-001, collected
// EARLIER than filled-lab-a.pdf (2026-06-18 vs 2026-09-20) with different
// hemoglobin and A1C values, so the lab trend chart (E5) has two points per
// test. Same field labels as layout A, so the existing OCR label map reads it.
// Fictional values only.
//
// Kept separate from generate-golden-pdfs.mjs on purpose: it needs no
// pdftoppm, so it runs on any host with Node:
//   node agentforge/scripts/generate-lab-trend-sample.mjs
// Then re-record its OCR inside the Docker image (record-golden-ocr.mjs).
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outPath = join(repoRoot, 'docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-c.pdf');
const fontPath = join(repoRoot, 'Documentation/EHI_Export/docs/fonts/source-sans-pro/source-sans-pro-v10-latin-700.ttf');
const FONT_NAME = 'SourceSansPro-Bold';
const PAGE = { width: 612, height: 792 };

/** Glyph widths (codes 32..126), bbox, ascent and descent of a TrueType font, in 1/1000 em. */
function ttfMetrics(font) {
  const tables = new Map();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    tables.set(font.toString('latin1', at, at + 4), font.readUInt32BE(at + 8));
  }
  const head = tables.get('head'); const hhea = tables.get('hhea'); const hmtx = tables.get('hmtx'); const cmap = tables.get('cmap');
  const unitsPerEm = font.readUInt16BE(head + 18);
  const scale = (value) => Math.round((value * 1000) / unitsPerEm);
  const numberOfHMetrics = font.readUInt16BE(hhea + 34);
  const advance = (glyph) => font.readUInt16BE(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));
  let format4 = null;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const at = cmap + 4 + i * 8;
    const offset = cmap + font.readUInt32BE(at + 4);
    if (font.readUInt16BE(at) === 3 && font.readUInt16BE(at + 2) === 1 && font.readUInt16BE(offset) === 4) format4 = offset;
  }
  if (format4 === null) throw new Error('TTF_CMAP_FORMAT4_MISSING');
  const segCount = font.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14; const starts = ends + segCount * 2 + 2; const deltas = starts + segCount * 2; const rangeOffsets = deltas + segCount * 2;
  const glyphFor = (code) => {
    for (let s = 0; s < segCount; s++) {
      if (code > font.readUInt16BE(ends + s * 2)) continue;
      const start = font.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = font.readInt16BE(deltas + s * 2);
      const rangeOffset = font.readUInt16BE(rangeOffsets + s * 2);
      if (!rangeOffset) return (code + delta) & 0xffff;
      const glyph = font.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
  const widths = [];
  for (let code = 32; code <= 126; code++) widths.push(scale(advance(glyphFor(code))));
  return { widths, bbox: [0, 2, 4, 6].map((offset) => scale(font.readInt16BE(head + 36 + offset))), ascent: scale(font.readInt16BE(hhea + 4)), descent: scale(font.readInt16BE(hhea + 6)) };
}

const escapePdf = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);

function writePdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const parts = typeof object === 'string'
      ? [Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1')]
      : [Buffer.from(`${index + 1} 0 obj\n${object.dict}\nstream\n`, 'latin1'), object.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
    parts.forEach((part) => { chunks.push(part); length += part.length; });
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 2 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

/** One-page vector PDF: `items` are `{text, x, y, size}` (points from top-left) or `{rule: [x1, y, x2]}`. */
function vectorPdf(items, title, font) {
  const metrics = ttfMetrics(font);
  const ops = ['0 0 0 rg 0 0 0 RG 0.8 w'];
  for (const item of items) {
    if (item.rule) ops.push(`${item.rule[0]} ${PAGE.height - item.rule[1]} m ${item.rule[2]} ${PAGE.height - item.rule[1]} l S`);
    else ops.push(`BT /F1 ${item.size || 12} Tf ${item.x} ${PAGE.height - item.y} Td (${escapePdf(item.text)}) Tj ET`);
  }
  const content = Buffer.from(ops.join('\n'), 'latin1');
  return writePdf([
    '<< /Type /Catalog /Pages 3 0 R >>',
    `<< /Title (${escapePdf(title)}) /Producer (AgentForge synthetic golden generator) >>`,
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`,
    `<< /Type /Font /Subtype /TrueType /BaseFont /${FONT_NAME} /FirstChar 32 /LastChar 126 /Widths [${metrics.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor 7 0 R >>`,
    { dict: `<< /Length ${content.length} >>`, stream: content },
    `<< /Type /FontDescriptor /FontName /${FONT_NAME} /Flags 32 /FontBBox [${metrics.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.ascent} /StemV 80 /FontFile2 8 0 R >>`,
    { dict: `<< /Length ${font.length} /Length1 ${font.length} >>`, stream: font },
  ]);
}

const rows = [
  'Hemoglobin test name: Hemoglobin', 'Hemoglobin value: 12.4', 'Hemoglobin unit: g/dL', 'Hemoglobin reference range: 12.0-16.0', 'Hemoglobin collection date: 2026-06-18', 'Hemoglobin abnormal: No',
  'A1C test name: A1C', 'A1C value: 6.8', 'A1C unit: %', 'A1C reference range: under 5.7', 'A1C collection date: 2026-06-18', 'A1C abnormal: Yes',
];
const items = [
  { text: 'SYNTHETIC LABORATORY REPORT - LAYOUT C', x: 72, y: 72, size: 14 },
  { text: 'Lab results (earlier visit)', x: 72, y: 100, size: 16 },
  { text: 'Patient: Test Patient One - DOB: 1980-04-12', x: 72, y: 128, size: 12 },
  { rule: [72, 146, 540] },
  ...rows.map((text, index) => ({ text, x: 76, y: 184 + index * 36 + (index >= 6 ? 24 : 0), size: 14 })),
  { text: 'Fictional values for software demonstration. Not a real patient record.', x: 72, y: 740, size: 9 },
];

await writeFile(outPath, vectorPdf(items, 'Synthetic lab report, layout C (earlier collection date)', await readFile(fontPath)));
console.log(`wrote ${outPath}`);
