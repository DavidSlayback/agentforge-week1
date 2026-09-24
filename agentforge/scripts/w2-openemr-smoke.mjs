#!/usr/bin/env node
/**
 * Post-deploy smoke for the W2 OpenEMR round-trip (PLAN S8, W2-C1/W2-C2).
 * Run it AFTER deploying, never as a unit test: it writes to the deployed
 * OpenEMR for the allowlisted synthetic patient.
 *
 * Public mode (from any machine):
 *   node agentforge/scripts/w2-openemr-smoke.mjs --base https://<host>/agentforge-w2
 *   Uploads the synthetic lab-a and intake-a PDFs for fixture-patient-001
 *   through the public W2 API, requires OpenEMR ids in the responses, repeats
 *   the upload and requires the same ids with duplicate=true, reads the lab
 *   values back through OpenEMR's FHIR Observation service, checks the stored
 *   bytes, and checks that the module endpoint is 404 on the public host.
 *
 * Module mode (inside the agentforge-w2 container, which has the secret):
 *   docker exec <agentforge-w2 container> node scripts/w2-openemr-smoke.mjs --module-checks
 *   Signed health, then unsigned / skewed / replayed / wrong-patient /
 *   non-allowlisted requests, each of which must be rejected.
 *
 * Output is one JSON line per check (ids, statuses and codes only; no names,
 * dates of birth or document text). Exit code 1 when any check fails.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueSignedContext } from '../src/accessContext.js';
import { OpenEMRModuleClient, signRequest } from '../src/openemrModuleClient.js';

const args = process.argv.slice(2);
const arg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const samplesDir = path.join(repoRoot, 'docs/agentforge/fixtures/scan-forms/pdf-samples');
const results = [];
const record = (check, pass, detail = {}) => { results.push(pass); console.log(JSON.stringify({ check, result: pass ? 'PASS' : 'FAIL', ...detail })); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function publicSmoke(base) {
  const patient = arg('--patient') || 'fixture-patient-001';
  const origin = new URL(base).origin;
  const getJson = async (url) => { const response = await fetch(url); return { status: response.status, body: await response.json().catch(() => ({})) }; };
  const postJson = async (route, body) => { const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json().catch(() => ({})) }; };

  const health = await getJson(`${base}/health`);
  record('w2_health', health.status === 200, { git_sha: health.body.git_sha });
  const write = await getJson(`${base}/v1/source-document-context?patient_uuid=${patient}`);
  const read = await getJson(`${base}/v1/demo-context?patient_uuid=${patient}`);
  record('demo_contexts_issued', write.status === 200 && read.status === 200);
  const ctx = { write: write.body.demo_token, read: read.body.demo_token, clinician: read.body.clinician_uuid };
  const manifest = JSON.parse(fs.readFileSync(path.join(samplesDir, 'manifest.json'), 'utf8'));

  for (const sample of ['lab-a', 'intake-a']) {
    const entry = manifest.samples.find((item) => item.layout === sample);
    const content = fs.readFileSync(path.join(samplesDir, entry.filename));
    const passes = [];
    for (const pass of [1, 2]) {
      const upload = await postJson('/v1/source-documents', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: ctx.write, document_type: entry.document_type, filename: entry.filename, content_base64: content.toString('base64') });
      const sourceId = upload.body.source_document?.id;
      record(`${sample}_upload_pass${pass}`, upload.status === 200 && upload.body.source_document?.persistence_boundary === 'openemr-module' && Number.isInteger(upload.body.openemr?.document_id) && upload.body.duplicate === (pass === 2), { status: upload.status, error: upload.body.error, document_id: upload.body.openemr?.document_id, duplicate: upload.body.duplicate });
      if (upload.status !== 200) return;
      const scan = await postJson('/v1/scan-supervisor', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: ctx.read, source_document_id: sourceId, message: 'documented values' });
      const openemr = scan.body.openemr || {};
      const labOk = entry.document_type !== 'lab_pdf' || (Number.isInteger(openemr.procedure_order_id) && openemr.observation_ids?.length === 2 && openemr.read_path === 'openemr-fhir-service-in-process' && openemr.read_back?.verified === true);
      record(`${sample}_extract_persist_pass${pass}`, scan.status === 200 && openemr.status === 'persisted' && Number.isInteger(openemr.derived_document_id) && labOk && openemr.duplicate === (pass === 2), { status: scan.status, error: scan.body.error, document_id: openemr.document_id, derived_document_id: openemr.derived_document_id, procedure_order_id: openemr.procedure_order_id, observation_ids: openemr.observation_ids, read_path: openemr.read_path, duplicate: openemr.duplicate, unmapped: openemr.unmapped_lab_results });
      passes.push({ sourceId, document_id: openemr.document_id, derived_document_id: openemr.derived_document_id, procedure_order_id: openemr.procedure_order_id, observation_ids: JSON.stringify(openemr.observation_ids || []) });
    }
    record(`${sample}_reupload_same_ids`, JSON.stringify(passes[0]) === JSON.stringify(passes[1]), { first: passes[0], second: passes[1] });

    const stored = await getJson(`${base}/v1/source-documents/${encodeURIComponent(passes[0].sourceId)}?patient_uuid=${patient}&demo_token=${encodeURIComponent(ctx.read)}`);
    const storedBytes = Buffer.from(stored.body.content_base64 || '', 'base64');
    record(`${sample}_openemr_bytes_identical`, stored.status === 200 && sha256(storedBytes) === sha256(content), { status: stored.status, sha256_matches: sha256(storedBytes) === sha256(content) });

    if (entry.document_type === 'lab_pdf') {
      const bundle = await getJson(`${base}/v1/source-documents/${encodeURIComponent(passes[0].sourceId)}/openemr-observations?patient_uuid=${patient}&demo_token=${encodeURIComponent(ctx.read)}`);
      const values = Object.fromEntries((bundle.body.entry || []).map(({ resource }) => [resource.code?.coding?.find((coding) => coding.system?.includes('loinc'))?.code ?? resource.code?.coding?.[0]?.code, String(resource.valueQuantity?.value ?? resource.valueString)]));
      const expected = { '718-7': entry.expected_fields['lab.hgb.value'], '4548-4': entry.expected_fields['lab.a1c.value'] };
      record('lab_a_fhir_observation_readback', bundle.status === 200 && bundle.body.read_path === 'openemr-fhir-service-in-process' && Object.entries(expected).every(([code, value]) => Number(values[code]) === Number(value)), { status: bundle.status, read_path: bundle.body.read_path, codes: Object.keys(values) });
    }
  }

  for (const method of ['GET', 'POST']) {
    const response = await fetch(`${origin}/interface/modules/custom_modules/oe-module-agentforge/public/api.php?route=health&site=default`, { method, ...(method === 'POST' ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}) });
    record(`module_endpoint_public_404_${method.toLowerCase()}`, response.status === 404, { status: response.status });
  }
}

async function moduleChecks() {
  const url = process.env.AGENTFORGE_OPENEMR_MODULE_URL;
  const secret = process.env.AGENTFORGE_DEMO_SECRET;
  const allowed = String(process.env.AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS || '').split(/[\s,]+/).filter(Boolean)[0];
  if (!url || !secret || !allowed) { record('module_env_present', false); return; }
  const client = new OpenEMRModuleClient({ baseUrl: url, secret });
  const health = await client.health().then((body) => ({ ok: body.status === 'ok' }), (error) => ({ ok: false, code: error.code }));
  record('module_signed_health', health.ok, health);

  const send = async ({ timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(16).toString('hex'), headers = null, query = { route: 'health', site: 'default' }, contextToken = null } = {}) => {
    const signed = headers || signRequest({ secret, method: 'GET', query, body: '', contextToken, timestamp, nonce }).headers;
    const target = new URL(url);
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    const response = await fetch(target, { headers: signed });
    return { status: response.status, error: (await response.json().catch(() => ({}))).error };
  };
  const unsigned = await send({ headers: {} });
  record('module_unsigned_rejected', unsigned.status === 401 && unsigned.error === 'signature_invalid', unsigned);
  const skewed = await send({ timestamp: Math.floor(Date.now() / 1000) - 400 });
  record('module_skewed_timestamp_rejected', skewed.status === 401 && skewed.error === 'timestamp_skew', skewed);
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const first = await send({ nonce, timestamp });
  const replay = await send({ nonce, timestamp });
  record('module_nonce_replay_rejected', first.status === 200 && replay.status === 409 && replay.error === 'nonce_replayed', { first: first.status, replay });
  const otherPatient = crypto.randomUUID();
  const token = issueSignedContext({ patient_uuid: allowed, clinician_uuid: 'smoke-check', scope: 'write-source-document', acl: 'write', ttlSeconds: 240, secret });
  const mismatch = await send({ query: { route: 'lab-observations', site: 'default', patient_uuid: otherPatient, source_document_id: '1' }, contextToken: token });
  record('module_wrong_patient_rejected', mismatch.status === 403 && mismatch.error === 'patient_scope_mismatch', mismatch);
  const notAllowed = await send({ query: { route: 'lab-observations', site: 'default', patient_uuid: otherPatient, source_document_id: '1' }, contextToken: issueSignedContext({ patient_uuid: otherPatient, clinician_uuid: 'smoke-check', scope: 'write-source-document', acl: 'write', ttlSeconds: 240, secret }) });
  record('module_non_allowlisted_demo_patient_rejected', notAllowed.status === 403 && notAllowed.error === 'demo_patient_not_allowed', notAllowed);
}

if (args.includes('--module-checks')) await moduleChecks();
else {
  const base = (arg('--base') || process.env.AGENTFORGE_W2_URL || '').replace(/\/$/, '');
  if (!base) { console.error('Pass --base https://<host>/agentforge-w2 or set AGENTFORGE_W2_URL.'); process.exit(2); }
  await publicSmoke(base);
}
const failed = results.filter((pass) => !pass).length;
console.log(JSON.stringify({ summary: failed ? 'FAIL' : 'PASS', checks: results.length, failed }));
process.exit(failed ? 1 : 0);
