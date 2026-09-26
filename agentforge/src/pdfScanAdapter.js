import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const MAX_PAGES = 6;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RENDERED_PAGE_PIXELS = 20_000_000;

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
      // Tool stderr can echo document content or paths, so only the code leaves this function.
      else reject(new Error('PDF_OCR_COMMAND_FAILED'));
    });
  });
}

/** Read the rendered page size from Tesseract's level-1 (page) TSV row, so citation boxes can be bounds-checked. */
export function parseTsvPageSize(tsv) {
  for (const row of tsv.trim().split(/\r?\n/).slice(1)) {
    const cells = row.split('\t');
    if (cells[0] !== '1') continue;
    const [width, height] = cells.slice(8, 10).map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  }
  return { width: null, height: null };
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

// Medication-list layout: "<label>: <value>" header lines plus one numbered
// row per drug ("Medication 1: Metformin 500 mg twice daily oral", or "Rx 1:").
const MEDICATION_LIST_LABELS = new Map([
  ['patient name', ['patient.name', 'Patient name']], ['name', ['patient.name', 'Patient name']], ['patient', ['patient.name', 'Patient name']],
  ['date of birth', ['patient.date_of_birth', 'Date of birth']], ['dob', ['patient.date_of_birth', 'Date of birth']],
  ['list date', ['medlist.list_date', 'List date']], ['date of list', ['medlist.list_date', 'List date']], ['reviewed on', ['medlist.list_date', 'List date']], ['date reviewed', ['medlist.list_date', 'List date']],
  ['prescriber', ['medlist.prescriber_or_source', 'Prescriber']], ['prescribing clinician', ['medlist.prescriber_or_source', 'Prescriber']], ['source', ['medlist.prescriber_or_source', 'Source']], ['record source', ['medlist.prescriber_or_source', 'Source']],
]);
const MEDICATION_ROW_LABEL = /^(?:medication|med|rx)\s*#?\s*([1-9][0-9]?)$/;
const MEDICATION_LIST_NAME_WITH_DOB = /^(.*?)\s*(?:[-–·•~|,]\s*)*\b(?:dob|date of birth)\s*:\s*(\S+)/i;
const MEDICATION_ROUTE_AT_END = /(?:^|\s)(by mouth|orally|oral|inhaled|inhalation|subcutaneous|topical|sublingual|intravenous|intramuscular|nasal|transdermal|ophthalmic|rectal)\s*$/i;
const MEDICATION_DOSE_UNIT = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|units?|puffs?|tablets?|capsules?|iu)(?![a-z])/i;
const MEDICATION_FREQUENCY = /\b(?:once daily|twice daily|three times daily|four times daily|daily|every (?:morning|evening|\d+ hours)|at bedtime|as needed|weekly)\b.*$/i;
const trimSeparators = (text) => text.replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');

/**
 * Split one medication-row value into its printed parts, e.g. "Metformin 500
 * mg twice daily oral" -> {name, dose, unit, frequency, route}. A part the
 * text does not show is absent from the result; nothing is defaulted.
 */
export function parseMedicationRow(text) {
  let rest = String(text || '').trim();
  const parts = {};
  const route = MEDICATION_ROUTE_AT_END.exec(rest);
  if (route) { parts.route = route[1]; rest = rest.slice(0, route.index).trim(); }
  const dose = MEDICATION_DOSE_UNIT.exec(rest);
  if (dose) {
    parts.dose = dose[1];
    parts.unit = dose[2];
    const name = trimSeparators(rest.slice(0, dose.index));
    const frequency = trimSeparators(rest.slice(dose.index + dose[0].length));
    if (name) parts.name = name;
    if (frequency) parts.frequency = frequency;
  } else {
    const frequency = MEDICATION_FREQUENCY.exec(rest);
    if (frequency) { parts.frequency = trimSeparators(frequency[0]); rest = rest.slice(0, frequency.index); }
    const name = trimSeparators(rest);
    if (name) parts.name = name;
  }
  return parts;
}

function medicationListRows(lines) {
  const fields = [];
  for (const line of lines) {
    const separator = line.text.indexOf(':');
    if (separator < 1) continue;
    const labelKey = line.text.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = line.text.slice(separator + 1).trim();
    if (!value) continue;
    const row = MEDICATION_ROW_LABEL.exec(labelKey);
    if (row) {
      // Every part of a row cites the same verbatim OCR line.
      for (const [part, partValue] of Object.entries(parseMedicationRow(value))) {
        fields.push({ field_id: `medication.${row[1]}.${part}`, label: `Medication ${row[1]} ${part}`, value: partValue, unit: '', quote: line.text, line });
      }
      continue;
    }
    const mapping = MEDICATION_LIST_LABELS.get(labelKey);
    if (!mapping) continue;
    // A one-line header ("Patient: Test Patient One - DOB: 1980-04-12") holds
    // both identity fields; reading it all as the name would compare a
    // name-plus-date string with the chart and report a false mismatch.
    const combined = mapping[0] === 'patient.name' ? MEDICATION_LIST_NAME_WITH_DOB.exec(value) : null;
    if (combined) {
      if (combined[1]) fields.push({ field_id: 'patient.name', label: mapping[1], value: combined[1], unit: '', quote: line.text, line });
      fields.push({ field_id: 'patient.date_of_birth', label: 'Date of birth', value: combined[2], unit: '', quote: line.text, line });
      continue;
    }
    fields.push({ field_id: mapping[0], label: mapping[1], value, unit: '', quote: line.text, line });
  }
  return fields;
}

// Any "Medication 123:"-style label, including numbers the row map refuses.
const MEDICATION_ANY_ROW_LABEL = /^(?:medication|med|rx)\s*#?\s*\d+$/;

/** A line whose text reads like a drug row: a dose with its unit, a route at the end, or a dosing frequency. */
const looksLikeMedicationRow = (text) => MEDICATION_DOSE_UNIT.test(text) || MEDICATION_ROUTE_AT_END.test(text) || MEDICATION_FREQUENCY.test(text);

/**
 * Lines of a medication list that look like a drug row but were not read as
 * one: an unlabeled row ("Warfarin 5 mg once daily oral"), or a numbered row
 * whose number the row map refuses ("Medication 100:"). A dropped drug is the
 * worst failure a medication list can have, so each one is reported as an
 * unreadable field (reason codes only, never the text), which keeps the
 * extraction QUALIFIED instead of complete.
 */
export function unreadMedicationRows(lines, documentType, layoutId = '') {
  if (documentType !== 'medication_list' || layoutId !== `pdf-ocr-${documentType}`) return [];
  const unread = [];
  for (const line of lines) {
    const separator = line.text.indexOf(':');
    const labelKey = separator > 0 ? line.text.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const value = separator > 0 ? line.text.slice(separator + 1).trim() : line.text.trim();
    if (separator > 0 && MEDICATION_ROW_LABEL.test(labelKey)) continue;
    if (separator > 0 && MEDICATION_LIST_LABELS.has(labelKey)) continue;
    if (separator > 0 && MEDICATION_ANY_ROW_LABEL.test(labelKey)) unread.push({ field_id: `medication.unread.${unread.length + 1}`, reason: 'medication_row_number_out_of_range' });
    else if (looksLikeMedicationRow(separator > 0 ? value : line.text)) unread.push({ field_id: `medication.unread.${unread.length + 1}`, reason: 'unlabeled_medication_row' });
  }
  return unread;
}

export function fieldRows(lines, documentType, layoutId = '') {
  // Only the PDF-OCR layout is defined for medication lists; any other layout
  // reads nothing rather than borrowing the intake patterns below.
  if (documentType === 'medication_list') return layoutId === `pdf-ocr-${documentType}` ? medicationListRows(lines) : [];
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
      // `quote` is the verbatim OCR line text, not the canonical label below
      // (`mapping[1]`) — a citation must show what the form actually says.
      fields.push({ field_id: mapping[0], label: mapping[1], value, unit: '', quote: line.text, line });
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
    fields.push({ field_id: pattern.id, label: match[0].replace(value, '').replace(/:$/, '').trim(), value: value.trim(), unit: labUnit, quote: line.text, line });
  }
  return fields;
}

const assertPdf = (content) => {
  if (!Buffer.isBuffer(content) || content.length < 8 || content.subarray(0, 5).toString() !== '%PDF-') throw new Error('SOURCE_DOCUMENT_PDF_INVALID');
};

/**
 * Render a PDF with pdftoppm (200 DPI) and OCR each page with Tesseract.
 *
 * Args:
 *   content: PDF bytes.
 *   includeImages: Also return each page PNG as base64 (needed only by a
 *     vision scan provider).
 *
 * Returns:
 *   `{pageCount, pages: [{page, width, height, lines, image_base64?}]}` where
 *   `lines` are Tesseract lines with pixel boxes and min-word confidence.
 */
/**
 * `psm` is Tesseract's `--psm` (page-segmentation mode) flag: `6` (default)
 * assumes a uniform block of text; `4` assumes a single column of
 * variable-sized text. The supervisor's `low_confidence_retry` decision
 * (supervisor.js) re-OCRs once at the alternate mode when mean confidence is
 * below 0.7 -- some scanned layouts read better one way than the other.
 */
export async function pdfToOcrLines(content, { includeImages = false, psm = 6 } = {}) {
  assertPdf(content);
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-pdf-'));
  try {
    const pdf = join(directory, 'source.pdf');
    await writeFile(pdf, content);
    const info = await run('pdfinfo', [pdf]);
    const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    if (!pageCount || pageCount > MAX_PAGES) throw new Error('PDF_PAGE_LIMIT_EXCEEDED');
    const prefix = join(directory, 'page');
    await run('pdftoppm', ['-f', '1', '-l', String(MAX_PAGES), '-r', '200', '-png', pdf, prefix]);
    const images = (await readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      const tsv = await run('tesseract', [join(directory, images[i]), 'stdout', '--psm', String(psm), 'tsv']);
      pages.push({
        page: i + 1,
        ...parseTsvPageSize(tsv),
        lines: parseTsv(tsv, i + 1),
        ...(includeImages ? { image_base64: (await readFile(join(directory, images[i]))).toString('base64') } : {}),
      });
    }
    return { pageCount, pages };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Render one source page in the same 200 DPI pixel space used by Tesseract. */
export function renderedPageFilename(names, page) {
  return names.find((name) => new RegExp(`^page-0*${page}\\.png$`).test(name)) || null;
}

function pagePixelCount(pdfInfo, page) {
  const size = pdfInfo.match(new RegExp(`^(?:Page(?:\\s+${page})?\\s+size|size):\\s*([\\d.]+) x ([\\d.]+) pts`, 'mi'));
  if (!size) throw Object.assign(new Error('PDF_PAGE_INFO_INVALID'), { code: 'PDF_PAGE_INFO_INVALID' });
  const pixels = Math.ceil(Number(size[1]) * 200 / 72) * Math.ceil(Number(size[2]) * 200 / 72);
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAX_RENDERED_PAGE_PIXELS) throw Object.assign(new Error('PDF_PAGE_RENDER_FAILED'), { code: 'PDF_PAGE_RENDER_FAILED' });
  return pixels;
}

export async function renderPdfPagePng(content, page) {
  assertPdf(content);
  if (!Number.isInteger(page) || page < 1) throw Object.assign(new Error('PDF_PAGE_NOT_FOUND'), { code: 'PDF_PAGE_NOT_FOUND' });
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-page-'));
  try {
    const pdf = join(directory, 'source.pdf');
    await writeFile(pdf, content);
    let documentInfo;
    try { documentInfo = await run('pdfinfo', [pdf]); }
    catch (error) {
      if (error.code === 'PDF_OCR_RUNTIME_UNAVAILABLE') throw error;
      throw Object.assign(new Error('PDF_PAGE_INFO_INVALID'), { code: 'PDF_PAGE_INFO_INVALID' });
    }
    const pageCount = Number(documentInfo.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    if (!pageCount) throw Object.assign(new Error('PDF_PAGE_INFO_INVALID'), { code: 'PDF_PAGE_INFO_INVALID' });
    if (pageCount > MAX_PAGES) throw Object.assign(new Error('PDF_PAGE_LIMIT_EXCEEDED'), { code: 'PDF_PAGE_LIMIT_EXCEEDED' });
    if (page > pageCount) throw Object.assign(new Error('PDF_PAGE_NOT_FOUND'), { code: 'PDF_PAGE_NOT_FOUND' });
    let pageInfo = documentInfo;
    if (page > 1) {
      try { pageInfo = await run('pdfinfo', ['-f', String(page), '-l', String(page), pdf]); }
      catch (error) {
        if (error.code === 'PDF_OCR_RUNTIME_UNAVAILABLE') throw error;
        throw Object.assign(new Error('PDF_PAGE_INFO_INVALID'), { code: 'PDF_PAGE_INFO_INVALID' });
      }
    }
    pagePixelCount(pageInfo, page);
    const prefix = join(directory, 'page');
    try { await run('pdftoppm', ['-r', '200', '-f', String(page), '-l', String(page), '-png', pdf, prefix]); }
    catch (error) {
      if (error.code === 'PDF_OCR_RUNTIME_UNAVAILABLE') throw error;
      throw Object.assign(new Error('PDF_PAGE_RENDER_FAILED'), { code: 'PDF_PAGE_RENDER_FAILED' });
    }
    const imageName = renderedPageFilename(await readdir(directory), page);
    if (!imageName) throw Object.assign(new Error('PDF_PAGE_RENDER_FAILED'), { code: 'PDF_PAGE_RENDER_FAILED' });
    const imagePath = join(directory, imageName);
    const imageStats = await stat(imagePath);
    if (imageStats.size < 8 || imageStats.size > MAX_COMMAND_OUTPUT_BYTES) throw Object.assign(new Error('PDF_PAGE_RENDER_FAILED'), { code: 'PDF_PAGE_RENDER_FAILED' });
    const image = await readFile(imagePath);
    if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Object.assign(new Error('PDF_PAGE_RENDER_FAILED'), { code: 'PDF_PAGE_RENDER_FAILED' });
    return image;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Production OCR engine: the real poppler + Tesseract binaries. */
export const tesseractOcrEngine = Object.freeze({ name: 'tesseract-local-pdf', recognize: pdfToOcrLines });

/** Default page-segmentation mode label, matching Tesseract's own default. */
export const DEFAULT_OCR_MODE = 'psm6';
/** The one alternate mode the low-confidence retry decision tries. */
export const ALTERNATE_OCR_MODE = 'psm4';
const OCR_MODE_PSM = Object.freeze({ [DEFAULT_OCR_MODE]: 6, [ALTERNATE_OCR_MODE]: 4 });

/**
 * OCR engine that replays OCR output previously recorded from the real
 * binaries (`scripts/record-golden-ocr.mjs`), keyed by the PDF's SHA-256 and
 * (optionally) the OCR mode it was recorded at. A recording with no
 * `ocr_mode` is treated as the default mode, so every recording made before
 * S6 (the low-confidence-retry feature) still matches unchanged. A caller
 * that asks for a mode with no matching recording gets `RECORDED_OCR_NOT_FOUND`
 * rather than a silent, misleading fallback to a different mode's output --
 * it exists so the eval gate runs the post-OCR path deterministically on
 * machines without Tesseract, and it never OCRs anything itself.
 */
export function createRecordedOcrReplay(recordings) {
  const byKey = new Map(recordings.map((recording) => [`${recording.pdf_sha256}:${recording.ocr_mode || DEFAULT_OCR_MODE}`, recording]));
  return Object.freeze({
    name: 'tesseract-recorded-replay',
    async recognize(content, { psm } = {}) {
      assertPdf(content);
      const mode = Object.entries(OCR_MODE_PSM).find(([, value]) => value === psm)?.[0] || DEFAULT_OCR_MODE;
      const recording = byKey.get(`${createHash('sha256').update(content).digest('hex')}:${mode}`);
      if (!recording) throw new Error('RECORDED_OCR_NOT_FOUND');
      if (recording.error) throw new Error(recording.error);
      return { pageCount: recording.page_count, pages: structuredClone(recording.pages) };
    },
  });
}

/** Converts PDF pages to OCR word/line regions, then adapts supported assignment fields to w2-scan-v1. */
export async function extractPdfScanFixture({ content, documentType, layoutId = `pdf-ocr-${documentType}`, scanProvider = null, ocrMode = DEFAULT_OCR_MODE, ocrEngine = tesseractOcrEngine }) {
  assertPdf(content);
  const psm = OCR_MODE_PSM[ocrMode] ?? 6;
  const { pageCount: pages, pages: renderedPages } = await ocrEngine.recognize(content, { includeImages: Boolean(scanProvider), psm });
  if (scanProvider && renderedPages.some((page) => !page.image_base64)) throw new Error('SCAN_PROVIDER_REQUIRES_PAGE_IMAGES');
  const ocrLines = renderedPages.flatMap((page) => page.lines);
  const modelResult = scanProvider ? await scanProvider.extract({ documentType, pages: renderedPages }) : null;
  const extracted = modelResult
    ? modelResult.fields
    : fieldRows(ocrLines, documentType, layoutId);
  const pageSizes = renderedPages
    .filter((page) => Number.isInteger(page.page) && Number.isInteger(page.width) && Number.isInteger(page.height) && page.width > 0 && page.height > 0)
    .map((page) => `${page.page}:${page.width}x${page.height}`);
  const fixture = [`SYNTHETIC_SCAN_FORM|layout=${layoutId}|page_count=${pages}${pageSizes.length ? `|page_sizes=${pageSizes.join(',')}` : ''}`];
  for (const field of extracted) {
    const line = field.line;
    const page = field.page || line?.page;
    const box = field.box || [line?.left, line?.top, line?.right, line?.bottom];
    const confidence = field.confidence ?? line?.confidence ?? 0;
    fixture.push(`FIELD|field_id=${field.field_id}|label=${safe(field.label)}|value=${safe(field.value)}|unit=${safe(field.unit)}|quote=${safe(field.quote)}|page=${page}|box=${box.join(',')}|confidence=${confidence.toFixed(2)}`);
  }
  // Read from the OCR lines whichever provider mapped the fields.
  for (const row of unreadMedicationRows(ocrLines, documentType, layoutId)) fixture.push(`UNREADABLE|field_id=${row.field_id}|reason=${row.reason}`);
  // `ocrText` stays in memory for document-type detection; it is never logged or traced.
  return { content: Buffer.from(fixture.join('\n')), pageCount: pages, candidateFields: extracted.length, provider: modelResult ? modelResult.model : ocrEngine.name, ocrText: ocrLines.map((line) => line.text).join('\n'), ocrMode };
}
