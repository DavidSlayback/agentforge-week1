import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationHasExactKeys,
  collectCitations,
  decisionsIncludeOrder,
  findDemographicsLeak,
  everyStageHasDuration,
  retrievalHasHitCount,
  buildLedgerMarkdown,
} from '../scripts/w2-live-acceptance.mjs';

// Every test below is network-free -- pure functions exercised against
// hand-built fixtures shaped like the real contracts documented in
// src/schemas.js (Citation, AnswerClaim), src/supervisor.js (decisions) and
// observability/index.js (TraceRecorder#complete). This script's `main()`
// (the only network-touching code) is never imported or called here, per
// the task: this file must never run against AGENTFORGE_LIVE_URL.

const validCitation = () => ({ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' });

test('citationHasExactKeys accepts the 5 required keys and the 2 optional bounding-box keys', () => {
  assert.equal(citationHasExactKeys(validCitation()), true);
  assert.equal(citationHasExactKeys({ ...validCitation(), bounding_box: [1, 2, 3, 4], coordinate_space: 'page-pixels' }), true);
});

test('citationHasExactKeys rejects a missing required key, an empty value, and an unknown extra key', () => {
  const { source_id, ...missingSourceId } = validCitation();
  assert.equal(citationHasExactKeys(missingSourceId), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), quote_or_value: '' }), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), source_document_id: 'legacy-key' }), false);
  assert.equal(citationHasExactKeys({ ...validCitation(), location: 'legacy-key' }), false);
  assert.equal(citationHasExactKeys(null), false);
  assert.equal(citationHasExactKeys('not-an-object'), false);
});

test('collectCitations finds every citation reachable through a `citation` or `citations` key in a nested answer/extraction tree', () => {
  const tree = {
    typed_outputs: {
      extraction: {
        facts: [{ field_id: 'f1', citation: { ...validCitation(), field_or_chunk_id: 'f1' } }],
        lab_results: [{ test_name: 'Hemoglobin', citation: { ...validCitation(), field_or_chunk_id: 'lab_results[0]' } }],
        intake_form: { demographics: { name: { status: 'observed', citation: { ...validCitation(), source_type: 'document', field_or_chunk_id: 'demographics.name' } } } },
      },
    },
    answer: {
      patient_facts: [{ kind: 'patient_fact', text: 'redacted', citations: [{ ...validCitation(), field_or_chunk_id: 'pf1' }, { ...validCitation(), field_or_chunk_id: 'pf2' }] }],
      guideline_evidence: [{ kind: 'guideline', text: 'redacted', citations: [{ ...validCitation(), source_type: 'guideline', field_or_chunk_id: 'chunk-1' }] }],
    },
  };
  const found = collectCitations(tree);
  const ids = found.map((citation) => citation.field_or_chunk_id).sort();
  assert.deepEqual(ids, ['chunk-1', 'demographics.name', 'f1', 'lab_results[0]', 'pf1', 'pf2']);
});

test('collectCitations returns an empty list for a value with no citation-bearing keys, and never throws on cycles', () => {
  assert.deepEqual(collectCitations({ status: 'ok', count: 3 }), []);
  assert.deepEqual(collectCitations(null), []);
  const cyclic = { name: 'self-referencing' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => collectCitations(cyclic));
});

test('decisionsIncludeOrder is true when EXTRACT, RETRIEVE and ANSWER appear in that order, even with extra decisions interleaved', () => {
  assert.equal(decisionsIncludeOrder([
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'EXTRACT', reason: 'low_confidence_retry' },
    { next: 'RETRIEVE', reason: 'evidence_needed' },
    { next: 'ANSWER', reason: 'facts_and_evidence_ready' },
  ]), true);
});

test('decisionsIncludeOrder is false when the order is wrong, a step is missing, or decisions is not an array', () => {
  assert.equal(decisionsIncludeOrder([
    { next: 'RETRIEVE', reason: 'evidence_needed' },
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'ANSWER', reason: 'facts_and_evidence_ready' },
  ]), false, 'RETRIEVE before EXTRACT must fail');
  assert.equal(decisionsIncludeOrder([
    { next: 'EXTRACT', reason: 'extraction_needed' },
    { next: 'RETRIEVE', reason: 'evidence_needed' },
  ]), false, 'missing ANSWER must fail');
  assert.equal(decisionsIncludeOrder(null), false);
  assert.equal(decisionsIncludeOrder(undefined), false);
});

test('findDemographicsLeak reports which demographic fields leaked into patient_fact claim text, never the values', () => {
  const demographics = { name: 'Test Patient One', dob: '1980-04-12', phone: '555-0100' };
  const leaking = [
    { kind: 'patient_fact', text: 'The chart lists test patient one as the record holder.' },
    { kind: 'guideline', text: 'A1C target under 5.7% per ADA Standards.' },
  ];
  const leaked = findDemographicsLeak(leaking, demographics);
  assert.deepEqual(leaked, ['name']);
  // The returned array never contains the raw value itself.
  assert.ok(!leaked.some((field) => field.includes('Test Patient One')));
});

test('findDemographicsLeak returns an empty list when no patient_fact claim mentions a demographic value', () => {
  const demographics = { name: 'Test Patient One', dob: '1980-04-12', phone: '555-0100' };
  const safe = [
    { kind: 'patient_fact', text: 'A1C rose from 6.1% to 7.2% between visits.' },
    { kind: 'guideline', text: 'Recommend re-check in three months.' },
  ];
  assert.deepEqual(findDemographicsLeak(safe, demographics), []);
});

test('findDemographicsLeak skips demographic values shorter than 3 characters and missing/undefined fields', () => {
  assert.deepEqual(findDemographicsLeak([{ kind: 'patient_fact', text: 'anything' }], { sex: 'M', phone: undefined, name: null }), []);
});

test('everyStageHasDuration requires a non-empty stages array where every entry has a numeric durationMs', () => {
  assert.equal(everyStageHasDuration([{ name: 'extraction', durationMs: 120 }, { name: 'retrieval', durationMs: 40 }]), true);
  assert.equal(everyStageHasDuration([{ name: 'extraction', durationMs: 120 }, { name: 'retrieval' }]), false);
  assert.equal(everyStageHasDuration([]), false);
  assert.equal(everyStageHasDuration(null), false);
});

test('retrievalHasHitCount requires at least one retrieval attempt with a numeric hit_count', () => {
  assert.equal(retrievalHasHitCount({ attempts: [{ tool: 'evidence-retriever', provider: 'hybrid:gemini-embedding-2+alibaba-qwen:qwen3.8-flash', hit_count: 3 }] }), true);
  assert.equal(retrievalHasHitCount({ attempts: [{ tool: 'evidence-retriever', status: 'failed' }] }), false);
  assert.equal(retrievalHasHitCount({ attempts: [] }), false);
  assert.equal(retrievalHasHitCount(null), false);
});

test('buildLedgerMarkdown renders one table row per result, with evidence JSON escaped for markdown table cells', () => {
  const markdown = buildLedgerMarkdown([
    { id: 'W2-C1', check: 'upload lab pdf', pass: true, evidence: { document_id: 42 } },
    { id: 'W2-C7', check: 'citation | shape', pass: false, evidence: { invalid_citations: 1 } },
  ], { sha: 'abc1234', timestamp: '2026-09-24T00:00:00.000Z' });
  const lines = markdown.trim().split('\n');
  assert.equal(lines.length, 4, 'header + separator + 2 rows');
  assert.match(lines[0], /requirement id \| check \| PASS\/FAIL \| evidence \| SHA \| timestamp/);
  assert.match(lines[2], /W2-C1/);
  assert.match(lines[2], /PASS/);
  assert.match(lines[2], /abc1234/);
  assert.match(lines[3], /W2-C7/);
  assert.match(lines[3], /FAIL/);
  assert.match(lines[3], /citation \\\| shape/, 'a pipe inside a cell must be escaped so it does not break the table');
});
