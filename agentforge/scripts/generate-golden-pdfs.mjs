// Generates the synthetic golden PDFs in agentforge/test/fixtures/golden/pdf/.
// Hand-written PDF writer; the only binary it shells out to is pdftoppm, used to
// rasterize the image-only "scanned" sample, so run it inside the image built
// from the repo Dockerfile:
//   docker run --rm -v "$PWD:/repo" -w /repo agentforge-gate node agentforge/scripts/generate-golden-pdfs.mjs
// Text is drawn with Source Sans Pro (SIL OFL 1.1), already vendored in this repo,
// because the Docker image has no system fonts for poppler to substitute.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repoRoot, 'agentforge/test/fixtures/golden/pdf');
const fontDir = join(repoRoot, 'Documentation/EHI_Export/docs/fonts/source-sans-pro');
const PAGE = { width: 612, height: 792 };

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
  return {
    widths,
    bbox: [0, 2, 4, 6].map((offset) => scale(font.readInt16BE(head + 36 + offset))),
    ascent: scale(font.readInt16BE(hhea + 4)),
    descent: scale(font.readInt16BE(hhea + 6)),
  };
}

const escapePdf = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);

function writePdf(objects) {
  // objects[i] is the body of object i+1 (string or {dict, stream}).
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
function vectorPdf(items, title, { font, name }) {
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
    `<< /Type /Font /Subtype /TrueType /BaseFont /${name} /FirstChar 32 /LastChar 126 /Widths [${metrics.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor 7 0 R >>`,
    { dict: `<< /Length ${content.length} >>`, stream: content },
    `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${metrics.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.ascent} /StemV 80 /FontFile2 8 0 R >>`,
    { dict: `<< /Length ${font.length} /Length1 ${font.length} >>`, stream: font },
  ]);
}

/** Wrap an 8-bit grayscale raster as a single-page, image-only PDF (no text layer). */
function imagePdf({ width, height, pixels }, title) {
  const data = deflateSync(pixels, { level: 9 });
  const content = Buffer.from(`q ${PAGE.width} 0 0 ${PAGE.height} 0 0 cm /Im1 Do Q`, 'latin1');
  return writePdf([
    '<< /Type /Catalog /Pages 3 0 R >>',
    `<< /Title (${escapePdf(title)}) /Producer (AgentForge synthetic golden generator) >>`,
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>`,
    { dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`, stream: data },
    { dict: `<< /Length ${content.length} >>`, stream: content },
  ]);
}

/** Rasterize a vector PDF with pdftoppm and add seeded speckle noise so it resembles a photocopied scan. */
async function scannedFrom(vector, title) {
  const directory = await mkdtemp(join(tmpdir(), 'golden-scan-'));
  try {
    await writeFile(join(directory, 'in.pdf'), vector);
    const result = spawnSync('pdftoppm', ['-r', '200', '-gray', '-f', '1', '-l', '1', join(directory, 'in.pdf'), join(directory, 'out')]);
    if (result.status !== 0) throw new Error('pdftoppm is required to build the scanned sample; run this script in the agentforge Docker image');
    const pgm = await readFile(join(directory, 'out-1.pgm'));
    const header = pgm.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+255\s/);
    const [width, height] = [Number(header[1]), Number(header[2])];
    const pixels = Buffer.from(pgm.subarray(header[0].length, header[0].length + width * height));
    let seed = 20260924;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < pixels.length; i++) {
      const roll = random();
      if (roll < 0.0015) pixels[i] = 90;
      else if (roll < 0.015) pixels[i] = Math.max(0, pixels[i] - 15);
    }
    return imagePdf({ width, height, pixels }, title);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const lines = (rows, { x = 72, y = 150, step = 30, size = 13 } = {}) => rows.map((text, index) => ({ text, x, y: y + index * step, size }));
const footer = { text: 'Fictional values for software demonstration. Not a real patient record.', x: 72, y: 740, size: 9 };

const DOCUMENTS = {
  'gen-lab-c-table.pdf': (font) => vectorPdf([
    { text: 'NORTHWIND CLINICAL LABORATORY', x: 72, y: 72, size: 16 },
    { text: 'Laboratory results', x: 72, y: 96, size: 12 },
    { text: 'Name: Test Patient One', x: 72, y: 140, size: 12 },
    { text: 'DOB: 1980-04-12', x: 72, y: 162, size: 12 },
    { text: 'Collected 2026-09-18', x: 360, y: 140, size: 12 },
    { rule: [72, 190, 540] },
    { text: 'Test', x: 72, y: 212, size: 12 }, { text: 'Result', x: 230, y: 212, size: 12 }, { text: 'Units', x: 300, y: 212, size: 12 }, { text: 'Reference range', x: 370, y: 212, size: 12 }, { text: 'Flag', x: 500, y: 212, size: 12 },
    { rule: [72, 222, 540] },
    { text: 'Hemoglobin', x: 72, y: 246, size: 12 }, { text: '12.6', x: 230, y: 246, size: 12 }, { text: 'g/dL', x: 300, y: 246, size: 12 }, { text: '12.0-16.0', x: 370, y: 246, size: 12 },
    { text: 'Hemoglobin A1C', x: 72, y: 272, size: 12 }, { text: '6.4', x: 230, y: 272, size: 12 }, { text: '%', x: 300, y: 272, size: 12 }, { text: '4.0-5.6', x: 370, y: 272, size: 12 }, { text: 'H', x: 500, y: 272, size: 12 },
    footer,
  ], 'Synthetic lab report, table layout', font),
  'gen-lab-d-flags.pdf': (font) => vectorPdf([
    { text: 'SYNTHETIC LABORATORY REPORT - FOLLOW-UP PANEL', x: 72, y: 72, size: 15 },
    { text: 'Patient: Test Patient One   DOB: 1980-04-12', x: 72, y: 104, size: 12 },
    ...lines([
      'Hemoglobin test name: Hemoglobin', 'Hemoglobin value: 10.4', 'Hemoglobin unit: g/dL', 'Hemoglobin reference range: 12.0-16.0', 'Hemoglobin collection date: 2026-08-14', 'Hemoglobin abnormal: L',
      'A1C test name: A1C', 'A1C  value: 8.3', 'A1C unit: %', 'A1C reference range: 4.0-5.6', 'A1C collection date: 2026-08-14', 'A1C abnormal: H',
    ], { y: 150, step: 32, size: 12 }),
    footer,
  ], 'Synthetic lab report with H/L flags', fonts.semibold),
  'gen-intake-c-conflict.pdf': (font) => vectorPdf([
    { text: 'PATIENT INTAKE QUESTIONNAIRE', x: 72, y: 72, size: 16 },
    ...lines([
      'Patient name: Test Conflict', 'Date of birth: 1968-07-21', 'Telephone: 555-0142', 'Chief concern: Morning headaches for one month',
      'Current medications: Amlodipine 5 mg daily', 'Allergies: Latex', 'Family history: Father had hypertension',
    ], { y: 130, step: 40 }),
    footer,
  ], 'Synthetic intake form for fixture-patient-002', font),
  'gen-lab-e-scanned.pdf': async (font) => scannedFrom(vectorPdf([
    { text: 'SYNTHETIC LAB REPORT - SCANNED COPY', x: 72, y: 72, size: 15 },
    { text: 'Patient: Test Patient One   DOB: 1980-04-12', x: 72, y: 104, size: 12 },
    ...lines([
      'Hemoglobin test name: Hemoglobin', 'Hemoglobin value: 14.1', 'Hemoglobin unit: g/dL', 'Hemoglobin reference range: 12.0-16.0', 'Hemoglobin collection date: 2026-07-02', 'Hemoglobin abnormal: No',
      'A1C test name: A1C', 'A1C value: 5.4', 'A1C unit: %', 'A1C reference range: 4.0-5.6', 'A1C collection date: 2026-07-02', 'A1C abnormal: No',
    ], { y: 150, step: 32, size: 14 }),
    footer,
  ], 'vector source', font), 'Synthetic image-only scanned lab report'),
  'gen-blank-page.pdf': (font) => vectorPdf([], 'Synthetic blank page', font),
  'gen-corrupt.pdf': async () => Buffer.from('%PDF-1.4\n%synthetic corrupt upload: header only, no objects, no xref\n\x00\x01\x02garbage\n', 'latin1'),
};

// Semibold for the H/L sample: with the regular weight Tesseract misreads its "A1C" labels as "AlC".
const fonts = {
  regular: { font: await readFile(join(fontDir, 'source-sans-pro-v10-latin-regular.ttf')), name: 'SourceSansPro-Regular' },
  semibold: { font: await readFile(join(fontDir, 'source-sans-pro-v10-latin-600.ttf')), name: 'SourceSansPro-Semibold' },
};
await mkdir(outDir, { recursive: true });
for (const [name, build] of Object.entries(DOCUMENTS)) {
  await writeFile(join(outDir, name), await build(fonts.regular));
  console.log(`wrote ${name}`);
}
