import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPdfScanFixture } from '../src/pdfScanAdapter.js';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { validateScanExtraction } from '../src/scanFormContracts.js';

const fixturePath = (name) => fileURLToPath(new URL(`../../docs/agentforge/fixtures/scan-forms/pdf-samples/${name}`, import.meta.url));
const manifest = JSON.parse(await readFile(fixturePath('manifest.json'), 'utf8'));
if (manifest.synthetic_only !== true) throw new Error('PDF benchmark manifest must be synthetic only.');

const results = [];
for (const item of manifest.samples) {
  const sourceDocumentId = `benchmark-${item.layout}`;
  const content = await readFile(fixturePath(item.filename));
  const prepared = await extractPdfScanFixture({ content, documentType: item.document_type });
  const extraction = extractScanForm({ sourceDocumentId, documentType: item.document_type, layoutId: `pdf-ocr-${item.document_type}`, pageCount: prepared.pageCount, content: prepared.content });
  const validation = validateScanExtraction(extraction, { sourceDocumentId, documentType: item.document_type, layoutId: `pdf-ocr-${item.document_type}` });
  const actual = Object.fromEntries(extraction.facts.map((fact) => [fact.field_id, fact.value]));
  const expected = item.expected_fields;
  const exact = Object.keys(expected).filter((field) => actual[field] === expected[field]);
  const citations = extraction.facts.filter((fact) => fact.citation.page >= 1 && fact.citation.page <= prepared.pageCount && fact.citation.coordinate_space === 'raster_pixels_200dpi' && fact.citation.bounding_box.length === 4 && fact.citation.bounding_box[2] > fact.citation.bounding_box[0] && fact.citation.bounding_box[3] > fact.citation.bounding_box[1]).length;
  results.push({ layout: item.layout, document_type: item.document_type, render_style: item.render_style, page_count: prepared.pageCount, expected_fields: Object.keys(expected).length, accepted_fields: extraction.facts.length, exact_value_matches: exact.length, valid_contract: validation.valid, cited_fields: citations, status: extraction.status, source_bytes: content.length, source_sha256: createHash('sha256').update(content).digest('hex') });
}

const summary = {
  schema_version: 'agentforge-w2-pdf-sample-benchmark-v1',
  synthetic_only: true,
  provider: 'tesseract-local-pdf',
  layouts: results.length,
  expected_fields: results.reduce((total, item) => total + item.expected_fields, 0),
  accepted_fields: results.reduce((total, item) => total + item.accepted_fields, 0),
  exact_value_matches: results.reduce((total, item) => total + item.exact_value_matches, 0),
  cited_fields: results.reduce((total, item) => total + item.cited_fields, 0),
  passed: results.every((item) => item.expected_fields === item.accepted_fields && item.expected_fields === item.exact_value_matches && item.valid_contract && item.expected_fields === item.cited_fields && item.status === 'complete'),
  cases: results,
  limitation: manifest.limitation,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
