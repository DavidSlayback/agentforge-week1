import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRecordedOcrReplay, extractPdfScanFixture, tesseractOcrEngine } from '../src/pdfScanAdapter.js';
import { AgentForgeService } from '../src/service.js';
import { liveOcrSkip } from './helpers/ocrTools.js';

const golden = new URL('./fixtures/golden/', import.meta.url);
const repoRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', golden), 'utf8'));
// The extension suite's documents (E4 medication lists) are held to the same recording rules.
const extensionManifest = JSON.parse(fs.readFileSync(new URL('extension-manifest.json', golden), 'utf8'));
const pdfDocuments = [...manifest.documents, ...extensionManifest.documents].filter((doc) => doc.pdf);
const recordingFor = (doc) => JSON.parse(fs.readFileSync(new URL(`ocr/${doc.id}.json`, golden), 'utf8'));

test('every golden PDF has an OCR recording made from exactly these bytes', () => {
  for (const doc of pdfDocuments) {
    const recording = recordingFor(doc);
    const sha = createHash('sha256').update(fs.readFileSync(new URL(doc.pdf, repoRoot))).digest('hex');
    assert.equal(recording.pdf_sha256, sha, `${doc.id}: re-run scripts/record-golden-ocr.mjs in the Docker image`);
    assert.equal(recording.engine, 'tesseract-local-pdf');
  }
});

const skipParity = liveOcrSkip('live Tesseract OCR matches the committed recordings', ['pdftoppm', 'tesseract', 'pdfinfo']);

/**
 * The OCR options the deployed scan path passes by default, captured from
 * `extractPdfScanFixture` itself, so parity is checked at the mode production
 * runs (H5: S6 switched the default to psm 6 while the recordings were psm 3,
 * and a parity check that called the engine with its own defaults missed it).
 */
async function productionOcrOptions() {
  let captured = null;
  const spy = { name: 'spy', recognize: async (content, options) => { captured = { psm: options.psm }; return tesseractOcrEngine.recognize(content, options); } };
  const labA = pdfDocuments.find((doc) => doc.id === 'lab-a');
  await extractPdfScanFixture({ content: fs.readFileSync(new URL(labA.pdf, repoRoot)), documentType: 'lab_pdf', ocrEngine: spy });
  assert.ok(captured && Number.isInteger(captured.psm), 'the scan path must pass an explicit page-segmentation mode');
  return captured;
}

test('live Tesseract OCR matches the committed recordings line for line', { skip: skipParity }, async () => {
  const options = await productionOcrOptions();
  for (const doc of pdfDocuments) {
    const recording = recordingFor(doc);
    const content = fs.readFileSync(new URL(doc.pdf, repoRoot));
    if (recording.error) {
      await assert.rejects(tesseractOcrEngine.recognize(content, options), (error) => String(error.message).startsWith(recording.error), doc.id);
      continue;
    }
    const live = await tesseractOcrEngine.recognize(content, options);
    assert.equal(live.pageCount, recording.page_count, doc.id);
    assert.equal(live.pages.length, recording.pages.length, doc.id);
    live.pages.forEach((page, index) => {
      const recorded = recording.pages[index];
      assert.deepEqual([page.width, page.height], [recorded.width, recorded.height], `${doc.id} page size`);
      assert.deepEqual(page.lines.map((line) => line.text), recorded.lines.map((line) => line.text), `${doc.id} line text drifted`);
      assert.deepEqual(page.lines.map((line) => [line.left, line.top, line.right, line.bottom]), recorded.lines.map((line) => [line.left, line.top, line.right, line.bottom]), `${doc.id} line boxes drifted`);
      assert.deepEqual(page.lines.map((line) => line.confidence.toFixed(2)), recorded.lines.map((line) => line.confidence.toFixed(2)), `${doc.id} line confidences drifted`);
    });
  }
});

test('recorded OCR replay feeds the same post-OCR mapping and refuses PDFs it has no recording for', async () => {
  const replay = createRecordedOcrReplay(pdfDocuments.map(recordingFor));
  const labA = pdfDocuments.find((doc) => doc.id === 'lab-a');
  const prepared = await extractPdfScanFixture({ content: fs.readFileSync(new URL(labA.pdf, repoRoot)), documentType: 'lab_pdf', ocrEngine: replay });
  assert.equal(prepared.provider, 'tesseract-recorded-replay');
  assert.equal(prepared.candidateFields, 12);
  assert.match(prepared.content.toString('utf8'), /FIELD\|field_id=lab\.a1c\.abnormal\|.*\|value=Yes\|/);
  await assert.rejects(replay.recognize(Buffer.from('%PDF-1.4 unrecorded')), /RECORDED_OCR_NOT_FOUND/);
  const corrupt = pdfDocuments.find((doc) => doc.id === 'gen-corrupt');
  await assert.rejects(replay.recognize(fs.readFileSync(new URL(corrupt.pdf, repoRoot))), /PDF_OCR_COMMAND_FAILED/);
});

test('the production default OCR engine is the real pdftoppm + Tesseract binaries', () => {
  assert.equal(tesseractOcrEngine.name, 'tesseract-local-pdf');
  const service = new AgentForgeService({ chartAdapter: { authorize: () => ({ status: 'blocked' }) }, writeback: null, provider: null });
  assert.equal(service.ocrEngine, null, 'a service built without an ocrEngine must fall through to the real binaries');
  const source = fs.readFileSync(new URL('../src/pdfScanAdapter.js', import.meta.url), 'utf8');
  assert.match(source, /ocrEngine = tesseractOcrEngine \}/);
});
