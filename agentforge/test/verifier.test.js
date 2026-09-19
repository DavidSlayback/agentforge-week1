import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../src/verifier.js';

test('complete verification fails when any coverage group is unavailable', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    claims: [],
    coverage: [{ group: 'notes', status: 'failed', records: 0, attempts: 3, error_class: 'upstream_unavailable' }],
    qualification: { required: true, reasons: ['notes:failed'] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('COMPLETE_WITH_UNAVAILABLE_COVERAGE'));
});

test('verification rejects read operations outside the canonical allowlist', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'write_chart' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('WRITE_CAPABLE_BEHAVIOR'));
});

test('successful empty coverage is distinct from unavailable coverage', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [
      { group: 'identity', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'encounters', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'problems', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'medications', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'notes', status: 'empty', records: 0, attempts: 1, error_class: null },
    ],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'passed');
});

test('complete verification fails when canonical coverage groups are missing', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [{ group: 'identity', status: 'success', records: 1, attempts: 1, error_class: null }],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('COMPLETE_COVERAGE_GROUP_MISSING'));
});
