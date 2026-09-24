import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalString, deriveWriteKey, OpenEMRModuleClient, OpenEMRModuleError, signRequest, verifyCanonicalSignature } from '../src/openemrModuleClient.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { abnormalForOpenEMR, labResultsForModule, OpenEMRModuleWriteback, parsePatientMap, verifyObservationReadBack } from '../src/openemrModuleWriteback.js';

// Shared with interface/modules/custom_modules/oe-module-agentforge/tests/run.php.
const vectors = JSON.parse(fs.readFileSync(new URL('./fixtures/hmac-vectors.json', import.meta.url), 'utf8'));

test('shared HMAC vectors: the Node signer reproduces every canonical string and signature', () => {
  assert.equal(deriveWriteKey(vectors.secret).toString('hex'), vectors.write_key_hex);
  assert.ok(vectors.signature_vectors.length >= 3);
  for (const vector of vectors.signature_vectors) {
    const { headers, canonical } = signRequest({ secret: vectors.secret, method: vector.method, query: vector.query, body: vector.body, contextToken: vector.context_token, timestamp: vector.timestamp, nonce: vector.nonce });
    assert.equal(canonical, vector.canonical, vector.name);
    assert.equal(headers['x-agentforge-signature'], vector.signature, vector.name);
    assert.equal(headers['x-agentforge-content-sha256'], vector.body_sha256, vector.name);
    assert.equal(verifyCanonicalSignature(vectors.secret, vector.canonical, vector.signature), true);
    assert.equal(verifyCanonicalSignature(vectors.secret, vector.canonical.replace('\nPOST\n', '\nGET\n').replace('\nGET\n', '\nPUT\n'), vector.signature), false);
  }
});

test('shared context-token vector verifies with the same claims the PHP verifier expects', () => {
  const [vector] = vectors.context_token_vectors;
  const claims = verifySignedContext(vector.token, vectors.secret, () => vector.verify_at);
  for (const [field, value] of Object.entries(vector.expected)) assert.equal(claims[field], value, field);
});

test('canonical string covers every signed field, so changing any one changes the signature', () => {
  const [vector] = vectors.signature_vectors;
  const base = { method: 'POST', route: 'documents', site: 'default', patientUuid: 'p', contentSha256: 'c', bodySha256: 'b', timestamp: 1, nonce: 'n', query: { route: 'documents', site: 'default' }, contextTokenSha256: 't' };
  const signatures = new Set([base, { ...base, route: 'lab-results' }, { ...base, site: 'other' }, { ...base, patientUuid: 'q' }, { ...base, contentSha256: 'd' }, { ...base, bodySha256: 'e' }, { ...base, timestamp: 2 }, { ...base, nonce: 'm' }, { ...base, query: { ...base.query, document_id: '1' } }, { ...base, contextTokenSha256: '' }].map((fields) => canonicalString(fields)));
  assert.equal(signatures.size, 10);
  assert.match(vector.canonical, /^AGENTFORGE-HMAC-SHA256-V1\nPOST\ndocuments\ndefault\n/);
});

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, impl };
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('module client signs requests, adds a correlation id, and never puts bodies in errors', async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse(400, { error: 'invalid_request', issues: ['content_not_pdf', 'Test Patient One 1980-04-12'] }));
  const client = new OpenEMRModuleClient({ baseUrl: 'http://openemr/interface/modules/custom_modules/oe-module-agentforge/public/api.php', secret: vectors.secret, fetchImpl: impl, now: () => 1790000000, nonce: () => '0123456789abcdef0123456789abcdef', correlationId: () => 'af-test-correlation' });
  const error = await client.storeDocument({ patientUuid: 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6', contextToken: 'ctx.token', documentType: 'lab_pdf', filename: 'Test Patient One.pdf', mimeType: 'application/pdf', content: Buffer.from('Test Patient One 1980-04-12') }).catch((caught) => caught);
  assert.ok(error instanceof OpenEMRModuleError);
  assert.equal(error.code, 'OPENEMR_MODULE_INVALID_REQUEST');
  assert.equal(error.httpStatus, 400);
  assert.deepEqual(error.issues, ['content_not_pdf']);
  assert.doesNotMatch(JSON.stringify({ message: error.message, code: error.code, issues: error.issues }), /Test Patient One|1980-04-12/);
  const [{ url, init }] = calls;
  assert.match(url, /\?route=documents&site=default$/);
  assert.equal(init.headers['x-correlation-id'], 'af-test-correlation');
  assert.equal(init.headers['x-agentforge-key-id'], 'v1');
  assert.equal(init.headers['x-agentforge-context-token'], 'ctx.token');
  const expected = signRequest({ secret: vectors.secret, method: 'POST', query: { route: 'documents', site: 'default' }, body: init.body, contextToken: 'ctx.token', timestamp: 1790000000, nonce: '0123456789abcdef0123456789abcdef' });
  assert.equal(init.headers['x-agentforge-signature'], expected.headers['x-agentforge-signature']);
});

test('module client maps auth, replay, timeout and scope failures to typed errors', async () => {
  const cases = [[401, 'signature_invalid', 502], [409, 'nonce_replayed', 502], [403, 'demo_patient_not_allowed', 403], [404, 'document_not_found', 404], [503, 'ledger_not_installed', 503], [500, 'write_failed', 502]];
  for (const [status, code, httpStatus] of cases) {
    const client = new OpenEMRModuleClient({ baseUrl: 'http://openemr/api.php', secret: 's', fetchImpl: async () => jsonResponse(status, { error: code }) });
    const error = await client.health().catch((caught) => caught);
    assert.equal(error.code, `OPENEMR_MODULE_${code.toUpperCase()}`);
    assert.equal(error.httpStatus, httpStatus);
  }
  const slow = new OpenEMRModuleClient({ baseUrl: 'http://openemr/api.php', secret: 's', timeoutMs: 10, fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const timeout = await slow.health().catch((caught) => caught);
  assert.equal(timeout.code, 'OPENEMR_MODULE_TIMEOUT');
  assert.equal(timeout.httpStatus, 504);
  const down = new OpenEMRModuleClient({ baseUrl: 'http://openemr/api.php', secret: 's', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await down.health().catch((caught) => caught)).code, 'OPENEMR_MODULE_UNREACHABLE');
  assert.throws(() => new OpenEMRModuleClient({ baseUrl: '', secret: 's' }), /OPENEMR_MODULE_NOT_CONFIGURED/);
});

test('module client re-checks document bytes read back from OpenEMR', async () => {
  const client = new OpenEMRModuleClient({ baseUrl: 'http://openemr/api.php', secret: 's', fetchImpl: async () => jsonResponse(200, { document_id: 57, content_base64: Buffer.from('%PDF-1').toString('base64'), content_sha256: '0'.repeat(64) }) });
  assert.equal((await client.getDocument({ patientUuid: 'p', contextToken: 't', documentId: 57 }).catch((caught) => caught)).code, 'OPENEMR_MODULE_CONTENT_HASH_MISMATCH');
});

test('lab results map to LOINC rows literally; unmapped analytes are reported, not guessed', () => {
  const citation = (field) => ({ source_type: 'document', source_id: 'openemr-doc-57', page_or_section: 'page 1', field_or_chunk_id: `${field}.value`, quote_or_value: 'x', bounding_box: [1, 2, 3, 4] });
  const { results, unmapped } = labResultsForModule({ lab_results: [
    { test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12.0-16.0', collection_date: '2026-09-20', abnormal_flag: 'normal', confidence: 0.9, citation: citation('lab.hgb') },
    { test_name: 'A1C', value: '6.1', unit: '%', reference_range: 'under 5.7', collection_date: '09/20/2026', abnormal_flag: 'abnormal', confidence: 0.9, citation: citation('lab.a1c') },
    { test_name: 'Ferritin', value: '40', unit: 'ng/mL', reference_range: '', collection_date: '2026-09-20', abnormal_flag: 'unknown', confidence: 0.9, citation: citation('lab.ferritin') },
  ] });
  assert.deepEqual(results.map((row) => [row.field_id, row.loinc_code, row.abnormal, row.collection_date, row.reference_range]), [['lab.hgb', '718-7', 'no', '2026-09-20', '12.0-16.0'], ['lab.a1c', '4548-4', 'yes', '2026-09-20', 'under 5.7']]);
  assert.deepEqual(unmapped, [{ field_id: 'lab.ferritin', reason: 'loinc_unmapped' }]);
  assert.equal(abnormalForOpenEMR('unknown'), '');
  assert.equal(abnormalForOpenEMR('high'), 'high');
});

test('observation read-back requires every stored result, with matching code and value', () => {
  const rows = [{ field_id: 'lab.hgb', loinc_code: '718-7', value: '13.2' }, { field_id: 'lab.a1c', loinc_code: '4548-4', value: '6.1' }];
  const lab = { results: [{ field_id: 'lab.hgb', observation_id: 'o1' }, { field_id: 'lab.a1c', observation_id: 'o2' }] };
  const resource = (id, code, value) => ({ resource: { id, code: { coding: [{ code }] }, valueQuantity: { value } } });
  assert.equal(verifyObservationReadBack({ entry: [resource('o1', '718-7', 13.2), resource('o2', '4548-4', 6.1)] }, lab, rows).verified, true);
  assert.deepEqual(verifyObservationReadBack({ entry: [resource('o1', '718-7', 13.2)] }, lab, rows).missing_observation_ids, ['o2']);
  assert.deepEqual(verifyObservationReadBack({ entry: [resource('o1', '718-7', 13.2), resource('o2', '4548-4', 7.2)] }, lab, rows).mismatched_field_ids, ['lab.a1c']);
  assert.equal(verifyObservationReadBack({ entry: [] }, { results: [] }, []).verified, false);
});

test('module writeback maps only allowlisted demo patients and forwards launcher tokens unchanged', () => {
  const secret = 'synthetic-test-secret';
  const openemrUuid = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';
  const writeback = new OpenEMRModuleWriteback({ client: {}, secret, patientMap: parsePatientMap(`fixture-patient-001=${openemrUuid}`), demoPatientAllowlist: new Set([openemrUuid]) });
  const demo = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', secret }), secret);
  const minted = writeback.moduleContext(demo, 'fixture-patient-001', 'write-source-document');
  assert.equal(minted.patientUuid, openemrUuid);
  const mintedClaims = verifySignedContext(minted.contextToken, secret);
  assert.equal(mintedClaims.issuer, 'synthetic-demo');
  assert.equal(mintedClaims.patient_uuid, openemrUuid);
  const other = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-002', clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', secret }), secret);
  assert.throws(() => writeback.moduleContext(other, 'fixture-patient-002', 'write-source-document'), (error) => error.code === 'OPENEMR_DEMO_PATIENT_NOT_ALLOWED' && error.httpStatus === 403);
  const launcherToken = issueSignedContext({ patient_uuid: openemrUuid, clinician_uuid: 'a2c37ca7-696f-41cd-be17-ce0e5ae0a9a3', scope: 'write-source-document', acl: 'write', issuer: 'openemr-module', authn: 'openemr-session', secret });
  const launcher = verifySignedContext(launcherToken, secret);
  assert.equal(writeback.moduleContext(launcher, openemrUuid, 'write-source-document').contextToken, launcherToken);
  assert.throws(() => new OpenEMRModuleWriteback({ client: {}, secret, patientMap: parsePatientMap(`fixture-patient-001=${openemrUuid}`), demoPatientAllowlist: new Set() }), /OPENEMR_DEMO_PATIENT_MAP_NOT_ALLOWLISTED/);
  assert.throws(() => parsePatientMap('fixture-patient-001=not-a-uuid'), /OPENEMR_DEMO_PATIENT_MAP_INVALID/);
});

test('N1: a context is forwarded only for its own patient, and a minted token never exceeds the caller scope', () => {
  const secret = 'synthetic-test-secret';
  const patientA = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';
  const patientB = '11111111-2222-4333-8444-555555555555';
  const writeback = new OpenEMRModuleWriteback({ client: {}, secret, patientMap: parsePatientMap(`fixture-patient-001=${patientA},fixture-patient-002=${patientB}`), demoPatientAllowlist: new Set([patientA, patientB]) });
  const launcherForA = verifySignedContext(issueSignedContext({ patient_uuid: patientA, clinician_uuid: 'a2c37ca7-696f-41cd-be17-ce0e5ae0a9a3', scope: 'write-source-document', acl: 'write', issuer: 'openemr-module', authn: 'openemr-session', secret }), secret);
  assert.throws(() => writeback.moduleContext(launcherForA, patientB, 'write-source-document'), (error) => error.code === 'OPENEMR_CONTEXT_PATIENT_MISMATCH' && error.httpStatus === 403);
  const demoForOne = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', secret }), secret);
  assert.throws(() => writeback.moduleContext(demoForOne, 'fixture-patient-002', 'write-source-document'), (error) => error.code === 'OPENEMR_CONTEXT_PATIENT_MISMATCH');
  const readForOne = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret }), secret);
  assert.throws(() => writeback.moduleContext(readForOne, 'fixture-patient-001', 'write-source-document'), (error) => error.code === 'OPENEMR_WRITE_CONTEXT_REQUIRED');
  const minted = verifySignedContext(writeback.moduleContext(readForOne, 'fixture-patient-001').contextToken, secret);
  assert.deepEqual([minted.scope, minted.acl, minted.patient_uuid], ['read-briefing', 'read', patientA]);
  const nonAllowlisted = new OpenEMRModuleWriteback({ client: {}, secret, demoPatientAllowlist: new Set([patientB]) });
  assert.throws(() => nonAllowlisted.moduleContext(launcherForA, patientA, 'write-source-document'), (error) => error.code === 'OPENEMR_DEMO_PATIENT_NOT_ALLOWED');
});
