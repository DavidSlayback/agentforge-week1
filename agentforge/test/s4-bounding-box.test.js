import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRecordedOcrReplay, extractPdfScanFixture, renderedPageFilename } from '../src/pdfScanAdapter.js';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { parseOrIssues, PageSize, ScanExtractionMetadata } from '../src/schemas.js';
import { citationBoxId, renderScanSourcePreview } from '../src/ui.js';
import { startTestServer, DEMO_KEY_REQUEST } from './helpers/testServer.js';
import { liveOcrSkip } from './helpers/ocrTools.js';

const fixture = new URL('./fixtures/golden/ocr/lab-a.json', import.meta.url);
const recording = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const twoPageRecording = JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/two-page-ocr.json', import.meta.url), 'utf8'));
const pdfPath = new URL(`../../${recording.pdf}`, import.meta.url);
const popplerSkip = liveOcrSkip('page rendering, cached scope checks, invalid pages, and render failures', ['pdfinfo', 'pdftoppm']);
const pathWithoutPoppler = process.env.PATH.split(path.delimiter).filter((directory) =>
  !['pdfinfo', 'pdftoppm'].some((tool) => ['', '.exe'].some((extension) => fs.existsSync(path.join(directory, `${tool}${extension}`)))),
).join(path.delimiter);

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
  const citationTargets = [...html.matchAll(/class="citation-source-link" href="#([^"]+)"/g)].map((match) => match[1]);
  const rowIds = [...html.matchAll(/id="(row-[^"]+)"/g)].map((match) => match[1]);
  const boxLinks = [...html.matchAll(/class="source-box [^"]+" id="[^"]+" href="#([^"]+)"/g)].map((match) => match[1]);
  assert.equal(citationTargets.length, extraction.facts.length);
  assert.ok(citationTargets.every((id) => boxIds.includes(id)), 'every evidence link must target a rendered box');
  assert.equal(boxLinks.length, extraction.facts.length);
  assert.ok(boxLinks.every((id) => rowIds.includes(id)), 'every clickable box must target its evidence row');

  const boxes = [...html.matchAll(/class="source-box [^"]+"[^>]*style="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(boxes.length, extraction.facts.length);
  assert.match(boxes[0], /left:14\.7059%;top:26\.8182%;width:35\.8235%;height:1\.6364%/);
  assert.match(boxes[1], /left:14\.7059%;top:31\.1364%;width:23\.5882%;height:1\.6364%/);

  const verifiedSection = html.match(/<section[^>]*data-section="verified"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  const needsReviewSection = html.match(/<section[^>]*data-section="needs-review"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(verifiedSection, /lab\.hgb\.value/);
  assert.match(needsReviewSection, /data-field-id="lab\.hgb\.value"/);
  assert.match(html, new RegExp(`id="${citationBoxId('lab.hgb.value')}"`));
  assert.equal(citationBoxId('lab.$a1c.value'), 'box-lab--a1c-value');
});

test('synthetic two-page recording draws each fact only on its page using that page dimensions', async () => {
  assert.equal(twoPageRecording.synthetic_only, true);
  const content = fs.readFileSync(pdfPath);
  const replay = createRecordedOcrReplay([twoPageRecording]);
  const envelope = await extractPdfScanFixture({ content, documentType: 'lab_pdf', ocrEngine: replay });
  const extraction = extractScanForm({ sourceDocumentId: 'synthetic-two-page', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', pageCount: envelope.pageCount, content: envelope.content });
  assert.deepEqual(extraction.page_sizes, [
    { page: 1, width: 1000, height: 1200 },
    { page: 2, width: 2000, height: 3000 },
  ]);
  const html = renderScanSourcePreview({
    sourceDocument: { id: 'synthetic-two-page', filename: 'synthetic-two-page.pdf' },
    extraction,
    pageUrl: (page) => `/page/${page}.png`,
  });
  const page1 = html.match(/<div class="pdf-page" data-page="1"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[0] || '';
  const page2 = html.match(/<div class="pdf-page" data-page="2"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[0] || '';
  assert.match(page1, /id="box-lab-hgb-value"/);
  assert.doesNotMatch(page1, /id="box-lab-a1c-value"/);
  assert.match(page2, /id="box-lab-a1c-value"/);
  assert.doesNotMatch(page2, /id="box-lab-hgb-value"/);
  assert.match(page2, /id="box-lab-a1c-value" href="#row-lab-a1c-value" style="left:15%;top:13\.3333%;width:30%;height:2%"/);
});

test('rendered page filename accepts Poppler zero padding', () => {
  assert.equal(renderedPageFilename(['page-01.png', 'page-02.png'], 1), 'page-01.png');
  assert.equal(renderedPageFilename(['page-01.png', 'page-02.png'], 2), 'page-02.png');
});

test('fixture-only source preview explains that no page image is available', async () => {
  const { extraction } = await labExtraction();
  const html = renderScanSourcePreview({ sourceDocument: { id: 'fixture', filename: 'example.scan.txt' }, extraction });
  assert.match(html, /no page image for fixture documents/);
  assert.doesNotMatch(html, /class="pdf-page/);
});

test('PDF preview without page dimensions explains that geometry is unavailable', async () => {
  const { extraction } = await labExtraction();
  const html = renderScanSourcePreview({
    sourceDocument: { id: 'pdf-without-geometry', filename: 'missing-page-sizes.pdf' },
    extraction: { ...extraction, page_sizes: undefined },
  });
  assert.match(html, /page geometry unavailable/);
});

test('page image route enforces signed patient scope and rejects fixtures without Poppler', async (t) => {
  const port = 18834;
  const child = await startTestServer(port);
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  const patient = 'fixture-patient-001';
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const other = await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-002`, DEMO_KEY_REQUEST).then((response) => response.json());
  const upload = async (filename, content) => fetch(`${base}/v1/source-documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename, content_base64: content.toString('base64') }),
  }).then((response) => response.json());
  const { content: pdf } = await labExtraction();
  const pdfDocument = (await upload('filled-lab-a.pdf', pdf)).source_document;
  const imagePath = (id, n, context, patientUuid = context.patient_uuid) => `/v1/source-documents/${id}/pages/${n}.png?patient_uuid=${patientUuid}&demo_token=${encodeURIComponent(context.demo_token)}`;

  const crossPatient = await fetch(`${base}${imagePath(pdfDocument.id, 1, other)}`);
  assert.equal(crossPatient.status, 403);
  const tokenPatientMismatch = await fetch(`${base}${imagePath(pdfDocument.id, 1, other, patient)}`);
  assert.equal(tokenPatientMismatch.status, 403);

  const pageZero = await fetch(`${base}${imagePath(pdfDocument.id, 0, read)}`);
  assert.equal(pageZero.status, 404);

  const malformedId = await fetch(`${base}/v1/source-documents/bad%zz/pages/1.png?patient_uuid=${patient}&demo_token=${encodeURIComponent(read.demo_token)}`);
  assert.equal(malformedId.status, 400);

  const fixtureContent = fs.readFileSync(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url));
  const textDocument = (await upload('lab-layout-a.scan.txt', fixtureContent)).source_document;
  const notPdf = await fetch(`${base}${imagePath(textDocument.id, 1, read)}`);
  assert.equal(notPdf.status, 404);
});

test('page rendering, cached scope checks, invalid pages, and render failures', { skip: popplerSkip }, async (t) => {
  const port = 18835;
  const child = await startTestServer(port);
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  const patient = 'fixture-patient-001';
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const other = await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-002`, DEMO_KEY_REQUEST).then((response) => response.json());
  const upload = async (filename, content) => fetch(`${base}/v1/source-documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename, content_base64: content.toString('base64') }),
  }).then((response) => response.json());
  const { content: pdf } = await labExtraction();
  const pdfDocument = (await upload('render-lab-a.pdf', pdf)).source_document;
  const imagePath = (id, n, context, patientUuid = context.patient_uuid) => `/v1/source-documents/${id}/pages/${n}.png?patient_uuid=${patientUuid}&demo_token=${encodeURIComponent(context.demo_token)}`;

  const image = await fetch(`${base}${imagePath(pdfDocument.id, 1, read)}`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);
  // E9 security review (05a613f3): page images are no-store and no-referrer like every other response.
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(image.headers.get('referrer-policy'), 'no-referrer');
  assert.ok((await image.arrayBuffer()).byteLength > 8);

  const crossPatient = await fetch(`${base}${imagePath(pdfDocument.id, 1, other)}`);
  assert.equal(crossPatient.status, 403, 'a cached page must still be patient-scoped');
  const tokenPatientMismatch = await fetch(`${base}${imagePath(pdfDocument.id, 1, other, patient)}`);
  assert.equal(tokenPatientMismatch.status, 403, 'the signed token must match patient_uuid before cache access');

  const badPage = await fetch(`${base}${imagePath(pdfDocument.id, 99, read)}`);
  assert.equal(badPage.status, 404);

  const corruptDocument = (await upload('corrupt.pdf', Buffer.from('%PDF-1.7 invalid synthetic pdf'))).source_document;
  const renderFailure = await fetch(`${base}${imagePath(corruptDocument.id, 1, read)}`);
  assert.equal(renderFailure.status, 422);
  assert.deepEqual(await renderFailure.json(), { error: 'pdf_page_render_failed' });
});

test('page route reports missing Poppler as 503 without exposing tool errors', async (t) => {
  const port = 18836;
  const child = await startTestServer(port, { PATH: pathWithoutPoppler });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  const patient = 'fixture-patient-001';
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
  const { content: pdf } = await labExtraction();
  const upload = await fetch(`${base}/v1/source-documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename: 'no-poppler.pdf', content_base64: pdf.toString('base64') }),
  }).then((response) => response.json());
  const response = await fetch(`${base}/v1/source-documents/${upload.source_document.id}/pages/1.png?patient_uuid=${patient}&demo_token=${encodeURIComponent(read.demo_token)}`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'ocr_runtime_unavailable' });
});
