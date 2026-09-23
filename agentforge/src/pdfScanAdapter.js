import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_PAGES = 6;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('PDF_OCR_COMMAND_TIMEOUT'));
    }, COMMAND_TIMEOUT_MS);
    timer.unref();
    const collect = (target) => (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        settled = true; clearTimeout(timer); child.kill('SIGKILL');
        reject(new Error('PDF_OCR_OUTPUT_LIMIT_EXCEEDED'));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(Object.assign(error, { code: 'PDF_OCR_RUNTIME_UNAVAILABLE' }));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`PDF_OCR_COMMAND_FAILED:${Buffer.concat(stderr).toString('utf8').slice(0, 300)}`));
    });
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

export function fieldRows(lines, documentType, layoutId = '') {
  if (layoutId === `pdf-ocr-${documentType}`) {
    const labels = documentType === 'lab_pdf'
      ? new Map([
        ['hemoglobin test name', ['lab.hgb.test_name', 'Hemoglobin test name']], ['hgb test name', ['lab.hgb.test_name', 'Hemoglobin test name']],
        ['hemoglobin value', ['lab.hgb.value', 'Hemoglobin value']], ['hgb value', ['lab.hgb.value', 'Hemoglobin value']],
        ['hemoglobin unit', ['lab.hgb.unit', 'Hemoglobin unit']], ['hgb unit', ['lab.hgb.unit', 'Hemoglobin unit']],
        ['hemoglobin reference range', ['lab.hgb.reference_range', 'Hemoglobin reference range']], ['hgb reference range', ['lab.hgb.reference_range', 'Hemoglobin reference range']],
        ['hemoglobin collection date', ['lab.hgb.collection_date', 'Hemoglobin collection date']], ['hgb collection date', ['lab.hgb.collection_date', 'Hemoglobin collection date']],
        ['hemoglobin abnormal', ['lab.hgb.abnormal', 'Hemoglobin abnormal']], ['hgb abnormal', ['lab.hgb.abnormal', 'Hemoglobin abnormal']],
        ['a1c test name', ['lab.a1c.test_name', 'A1C test name']], ['hba1c test name', ['lab.a1c.test_name', 'A1C test name']],
        ['a1c value', ['lab.a1c.value', 'A1C value']], ['hba1c value', ['lab.a1c.value', 'A1C value']],
        ['a1c unit', ['lab.a1c.unit', 'A1C unit']], ['hba1c unit', ['lab.a1c.unit', 'A1C unit']],
        ['a1c reference range', ['lab.a1c.reference_range', 'A1C reference range']], ['hba1c reference range', ['lab.a1c.reference_range', 'A1C reference range']],
        ['a1c collection date', ['lab.a1c.collection_date', 'A1C collection date']], ['hba1c collection date', ['lab.a1c.collection_date', 'A1C collection date']],
        ['a1c abnormal', ['lab.a1c.abnormal', 'A1C abnormal']], ['hba1c abnormal', ['lab.a1c.abnormal', 'A1C abnormal']],
      ])
      : new Map([
        ['patient name', ['patient.name', 'Patient name']], ['name', ['patient.name', 'Patient name']],
        ['date of birth', ['patient.date_of_birth', 'Date of birth']], ['dob', ['patient.date_of_birth', 'Date of birth']],
        ['phone', ['patient.phone', 'Phone']], ['telephone', ['patient.phone', 'Phone']],
        ['reason for visit', ['chief_concern', 'Reason for visit']], ['chief concern', ['chief_concern', 'Chief concern']],
        ['current medications', ['medications', 'Current medications']], ['medications', ['medications', 'Medications']], ['medication', ['medications', 'Medications']],
        ['allergies', ['allergies', 'Allergies']], ['allergy', ['allergies', 'Allergies']],
        ['family history', ['family_history', 'Family history']],
      ]);
    const fields = [];
    for (const line of lines) {
      const separator = line.text.indexOf(':');
      if (separator < 1) continue;
      const labelKey = line.text.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ');
      const mapping = labels.get(labelKey);
      const value = line.text.slice(separator + 1).trim();
      if (!mapping || !value) continue;
      fields.push({ field_id: mapping[0], label: mapping[1], value, unit: '', line });
    }
    return fields;
  }
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
export async function extractPdfScanFixture({ content, documentType, layoutId = `pdf-ocr-${documentType}`, scanProvider = null }) {
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
    const renderedPages = [];
    for (let i = 0; i < images.length; i++) {
      renderedPages.push({
        page: i + 1,
        image_base64: (await readFile(join(directory, images[i]))).toString('base64'),
        lines: parseTsv(await run('tesseract', [join(directory, images[i]), 'stdout', 'tsv']), i + 1),
      });
    }
    const modelResult = scanProvider ? await scanProvider.extract({ documentType, pages: renderedPages }) : null;
    const extracted = modelResult
      ? modelResult.fields
      : fieldRows(renderedPages.flatMap((page) => page.lines), documentType, layoutId);
    const fixture = [`SYNTHETIC_SCAN_FORM|layout=${layoutId}|page_count=${pages}`];
    for (const field of extracted) {
      const line = field.line;
      const page = field.page || line?.page;
      const box = field.box || [line?.left, line?.top, line?.right, line?.bottom];
      const confidence = field.confidence ?? line?.confidence ?? 0;
      fixture.push(`FIELD|field_id=${field.field_id}|label=${safe(field.label)}|value=${safe(field.value)}|unit=${safe(field.unit)}|quote=${safe(field.quote)}|page=${page}|box=${box.join(',')}|confidence=${confidence.toFixed(2)}`);
    }
    return { content: Buffer.from(fixture.join('\n')), pageCount: pages, candidateFields: extracted.length, provider: modelResult ? modelResult.model : 'tesseract-local-pdf' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
