import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfScanFixture, fieldRows, parseTsv } from '../src/pdfScanAdapter.js';

test('Tesseract word rows group into a cited synthetic intake field', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t20\t30\t65\t15\t95\tReason',
    '5\t1\t1\t1\t1\t2\t90\t30\t40\t15\t93\tfor',
    '5\t1\t1\t1\t1\t3\t135\t30\t55\t15\t92\tvisit',
    '5\t1\t1\t1\t1\t4\t200\t30\t70\t15\t91\tFatigue',
  ].join('\n');
  const lines = parseTsv(tsv, 1);
  const fields = fieldRows(lines, 'intake_form');
  assert.equal(lines.length, 1);
  assert.equal(fields[0].field_id, 'chief_concern');
  assert.equal(fields[0].value, 'Fatigue');
  assert.deepEqual(fields[0].line && [fields[0].line.left, fields[0].line.top, fields[0].line.right, fields[0].line.bottom], [20, 30, 270, 45]);
});

test('PDF OCR adapter rejects non-PDF content before invoking system tools', async () => {
  await assert.rejects(extractPdfScanFixture({ content: Buffer.from('not a pdf'), documentType: 'lab_pdf' }), /SOURCE_DOCUMENT_PDF_INVALID/);
});
