import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRecordedOcrReplay, extractPdfScanFixture } from '../src/pdfScanAdapter.js';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { parseOrIssues, PageSize, ScanExtractionMetadata } from '../src/schemas.js';
import { citationBoxId, renderScanSourcePreview } from '../src/ui.js';
import { startTestServer } from './helpers/testServer.js';

const fixture = new URL('./fixtures/golden/ocr/lab-a.json', import.meta.url);
const recording = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const pdfPath = new URL(`../../${recording.pdf}`, import.meta.url);
const hasPdftoppm = (() => {
  const probe = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  return !probe.error && probe.status !== null;
})();

async function labExtraction() {
  const content = fs.readFileSync(pdfPath);
  const replay = createRecordedOcrReplay([recording]);
  const envelope = await extractPdfScanFixture({ content, documentType: 'lab_pdf', ocrEngine: replay });
  const extraction = extractScanForm({ sourceDocumentId: 'lab-a', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', pageCount: envelope.pageCount, content: envelope.content });
  return { content, envelope, extraction };
}

test('recorded OCR page dimensions survive the scan-envelope extraction round trip', async () => {
  const { envelope, extraction } = await labExtraction();
  assert.match(envelope.content.toString('utf8'), /page_sizes=1:1700x2200/);
  assert.deepEqual(extraction.page_sizes, [{ page: 1, width: 1700, height: 2200 }]);
  assert.equal(parseOrIssues(PageSize, extraction.page_sizes[0]).ok, true);
  assert.equal(parseOrIssues(PageSize, { page: 1, width: 0, height: 2200 }).ok, false);
  assert.equal(parseOrIssues(ScanExtractionMetadata, {}).ok, true, 'older text fixtures may omit page_sizes');
});

test('golden lab preview draws every fact at its recorded pixel percentages and links to existing boxes', async () => {
  const { extraction } = await labExtraction();
  const html = renderScanSourcePreview({
    sourceDocument: { id: 'lab-a', filename: 'filled-lab-a.pdf' },
    extraction,
    pageUrl: (page) => `/page/${page}.png`,
    patient_uuid: 'fixture-patient-001',
    demo_token: 'test-token',
  });

  assert.equal((html.match(/class="source-box /g) || []).length, extraction.facts.length);
  assert.match(html, /<img[^>]+src="\/page\/1\.png"[^>]+alt="Page 1 of filled-lab-a\.pdf"/);
  const boxIds = [...html.matchAll(/id="(box-[^"]+)"/g)].map((match) => match[1]);
  const targetIds = [...html.matchAll(/href="#(box-[^"]+)"/g)].map((match) => match[1]);
  assert.equal(targetIds.length, extraction.facts.length);
  assert.ok(targetIds.every((id) => boxIds.includes(id)), 'every evidence link must target a rendered box');

  const boxes = [...html.matchAll(/class="source-box [^"]+"[^>]*style="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(boxes.length, extraction.facts.length);
  assert.match(boxes[0], /left:14\.7059%;top:26\.8182%;width:35\.8235%;height:1\.6364%/);
  assert.match(boxes[1], /left:14\.7059%;top:31\.1364%;width:23\.5882%;height:1\.6364%/);

  const verifiedSection = html.split('id="evidence-heading"')[1].split('data-section="low-confidence"')[0];
  assert.doesNotMatch(verifiedSection, /lab\.hgb\.value/);
  assert.match(html, new RegExp(`id="${citationBoxId('lab.hgb.value')}"`));
  assert.equal(citationBoxId('lab.$a1c.value'), 'box-lab--a1c-value');
});

test('fixture-only source preview explains that no page image is available', async () => {
  const { extraction } = await labExtraction();
  const html = renderScanSourcePreview({ sourceDocument: { id: 'fixture', filename: 'example.scan.txt' }, extraction });
  assert.match(html, /no page image for fixture documents/);
  assert.doesNotMatch(html, /class="pdf-page/);
});

test('page image route enforces patient scope and rejects non-PDF and out-of-range pages', async (t) => {
  const port = 18834;
  const child = await startTestServer(port);
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  const patient = 'fixture-patient-001';
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
  const other = await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-002`).then((response) => response.json());
  const upload = async (filename, content) => fetch(`${base}/v1/source-documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename, content_base64: content.toString('base64') }),
  }).then((response) => response.json());
  const { content: pdf } = await labExtraction();
  const pdfDocument = (await upload('filled-lab-a.pdf', pdf)).source_document;
  const imagePath = (id, n, context) => `/v1/source-documents/${id}/pages/${n}.png?patient_uuid=${context.patient_uuid}&demo_token=${encodeURIComponent(context.demo_token)}`;

  const crossPatient = await fetch(`${base}${imagePath(pdfDocument.id, 1, other)}`);
  assert.equal(crossPatient.status, 403);

  const badPage = await fetch(`${base}${imagePath(pdfDocument.id, 99, read)}`);
  assert.equal(badPage.status, 404);

  const fixtureContent = fs.readFileSync(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url));
  const textDocument = (await upload('lab-layout-a.scan.txt', fixtureContent)).source_document;
  const notPdf = await fetch(`${base}${imagePath(textDocument.id, 1, read)}`);
  assert.equal(notPdf.status, 404);

  const corruptDocument = (await upload('corrupt.pdf', Buffer.from('%PDF-1.7 invalid synthetic pdf'))).source_document;
  const renderFailure = await fetch(`${base}${imagePath(corruptDocument.id, 1, read)}`);
  assert.equal(renderFailure.status, 422);
  assert.deepEqual(await renderFailure.json(), { error: 'pdf_page_render_failed' });

  if (hasPdftoppm) {
    const image = await fetch(`${base}${imagePath(pdfDocument.id, 1, read)}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/png/);
    assert.equal(image.headers.get('cache-control'), 'private, max-age=300');
    assert.ok((await image.arrayBuffer()).byteLength > 8);
  } else {
    t.diagnostic('Skipped PNG render assertion: pdftoppm is not on PATH.');
  }
});
