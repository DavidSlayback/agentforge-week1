import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_PAGES = 6;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => reject(Object.assign(error, { code: 'PDF_OCR_RUNTIME_UNAVAILABLE' })));
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(stdout).toString('utf8')) : reject(new Error(`PDF_OCR_COMMAND_FAILED:${Buffer.concat(stderr).toString('utf8').slice(0, 300)}`)));
  });
}

export function parseTsv(tsv, page) {
  const lines = new Map();
  tsv.trim().split(/\r?\n/).slice(1).forEach((row) => {
    const cells = row.split('\t');
    if (cells.length < 12 || !cells[11]?.trim()) return;
    const [left, top, width, height, rawConfidence] = cells.slice(6, 11).map(Number);
    const confidence = rawConfidence / 100;
    if (![left, top, width, height, confidence].every(Number.isFinite)) return;
    const lineKey = `${cells[1]}:${cells[2]}:${cells[3]}:${cells[4]}`;
    const line = lines.get(lineKey) || { words: [], page, left, top, right: left + width, bottom: top + height, confidence: 1 };
    line.words.push(cells[11].trim()); line.left = Math.min(line.left, left); line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + width); line.bottom = Math.max(line.bottom, top + height);
    line.confidence = Math.min(line.confidence, Math.max(0, Math.min(1, confidence))); lines.set(lineKey, line);
  });
  return [...lines.values()].map((line) => ({ ...line, text: line.words.join(' ') }));
}

const safe = (value) => String(value || '').replace(/[|\r\n]/g, ' ').trim();

export function fieldRows(lines, documentType) {
  const fields = [];
  const patterns = documentType === 'lab_pdf'
    ? [{ id: 'lab.hgb', re: /\b(?:hemoglobin|ha?emoglobin|hgb)\b\s*:?\s*(.*)/i }, { id: 'lab.a1c', re: /\b(?:hemoglobin\s+)?(?:a1c|aic|hba1c)\b\s*:?\s*(.*)/i }]
    : [{ id: 'chief_concern', re: /\b(?:reason for visit|chief concern|presenting problem)\b\s*:?\s*(.*)/i }, { id: 'medication.metformin', re: /\b(?:medications?|current medications?)\b\s*:?\s*(.*)/i }, { id: 'allergy.penicillin', re: /\b(?:allergies|allergy)\b\s*:?\s*(.*)/i }];
  for (const line of lines) for (const pattern of patterns) {
    const match = line.text.match(pattern.re);
    if (!match || fields.some((field) => field.field_id === pattern.id)) continue;
    const tail = match[1] || '';
    const value = documentType === 'lab_pdf' ? (tail.match(/-?\d+(?:[.,]\d+)?\s*%?/i)?.[0] || '') : tail;
    if (!value.trim()) continue;
    const labUnit = documentType === 'lab_pdf' ? tail.slice(tail.indexOf(value) + value.length).match(/^\s*(%|g\/?dL|mmol\/?L)?/i)?.[1] || '' : '';
    fields.push({ field_id: pattern.id, label: match[0].replace(value, '').replace(/:$/, '').trim(), value: value.trim(), unit: labUnit, line });
  }
  return fields;
}

/** Converts PDF pages to OCR word/line regions, then adapts supported assignment fields to w2-scan-v1. */
export async function extractPdfScanFixture({ content, documentType, layoutId = `pdf-ocr-${documentType}` }) {
  if (!Buffer.isBuffer(content) || content.length < 8 || content.subarray(0, 5).toString() !== '%PDF-') throw new Error('SOURCE_DOCUMENT_PDF_INVALID');
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-pdf-'));
  try {
    const pdf = join(directory, 'source.pdf');
    await writeFile(pdf, content);
    const info = await run('pdfinfo', [pdf]);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    if (!pages || pages > MAX_PAGES) throw new Error('PDF_PAGE_LIMIT_EXCEEDED');
    const prefix = join(directory, 'page');
    await run('pdftoppm', ['-f', '1', '-l', String(MAX_PAGES), '-r', '200', '-png', pdf, prefix]);
    const images = (await readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const lines = [];
    for (let i = 0; i < images.length; i++) lines.push(...parseTsv(await run('tesseract', [join(directory, images[i]), 'stdout', 'tsv']), i + 1));
    const extracted = fieldRows(lines, documentType);
    const fixture = [`SYNTHETIC_SCAN_FORM|layout=${layoutId}|page_count=${pages}`];
    for (const { field_id, label, value, unit, line } of extracted) {
      fixture.push(`FIELD|field_id=${field_id}|label=${safe(label)}|value=${safe(value)}|unit=${safe(unit)}|page=${line.page}|box=${line.left},${line.top},${line.right},${line.bottom}|confidence=${line.confidence.toFixed(2)}`);
    }
    return { content: Buffer.from(fixture.join('\n')), pageCount: pages, candidateFields: extracted.length, provider: 'tesseract-local-pdf' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
