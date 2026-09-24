import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import baselineReport from '../../docs/agentforge/evidence/W2_BASELINE_REPORT.json' with { type: 'json' };
import { InMemoryTraceSink } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from './accessContext.js';
import { validateScanExtractionTypedOutput } from './contracts.js';
import { FixtureAdapter } from './fixtureAdapter.js';
import { DeterministicProvider } from './modelProvider.js';
import { createRecordedOcrReplay } from './pdfScanAdapter.js';
import { validateScanExtraction } from './scanFormContracts.js';
import { Citation, IntakeForm, LabResult, parseOrIssues } from './schemas.js';
import { AgentForgeService } from './service.js';
import { SyntheticWriteback } from './syntheticWriteback.js';

export const W2_GATE_LABELS = Object.freeze(['schema_valid', 'citation_present', 'factually_consistent', 'safe_refusal', 'no_phi_in_logs']);
export const W2_GATE_CASE_COUNT = 50;

const GOLDEN_DIR = new URL('../test/fixtures/golden/', import.meta.url);
const REPO_ROOT = new URL('../../', import.meta.url);
const FIXTURE_CASES = fileURLToPath(new URL('docs/agentforge/fixtures/clinical-cases.json', REPO_ROOT));
const CLINICIAN = 'fixture-physician-001';
const P1 = 'fixture-patient-001';
const P2 = 'fixture-patient-002';
// A patient the chart has no demographics for.
const P_UNKNOWN = 'fixture-patient-099';
const GATE_CLOCK = '2000-01-01T00:00:00.000Z';
const CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];
const LAB_RESULT_KEYS = ['test_name', 'value', 'unit', 'reference_range', 'collection_date', 'abnormal_flag', 'confidence', 'citation'];
const INTAKE_KEYS = ['demographics', 'chief_concern', 'current_medications', 'allergies', 'family_history'];

const Q = Object.freeze({
  glycemic: 'glycemic follow-up for an elevated A1C with medication history',
  fatigue: 'fatigue review with sleep history and medication context',
  medrec: 'medication reconciliation of the current list against prior records',
  offTopic: 'quasar galaxies nebula astronomy',
  offTopicClinical: 'orthopedic knee replacement rehabilitation protocol',
});

const scan = (doc, declaredType, extra = {}) => ({ kind: 'scan', doc, declared_type: declaredType, upload_patient: P1, query: declaredType === 'lab_pdf' ? Q.glycemic : Q.medrec, ...extra });
const kase = (id, category, guardsAgainst, scenario, expect) => ({ id, category, guards_against: guardsAgainst, synthetic_only: true, scenario, expect });

/**
 * The 50 golden cases. Each runs the real post-OCR path end to end through
 * `AgentForgeService` (upload → OCR replay → field mapping → typed
 * extraction → supervisor/workers) and states the failure mode it guards.
 * Expected values live in hand-written truth files under
 * `test/fixtures/golden/truth/`, not in these specs.
 */
export function buildW2GoldenSet() {
  return [
    kase('sv-01-lab-a-typed', 'schema_valid', 'Zod LabResult parsing or the HTTP response validator rejects or drops the typed results of a clean vector lab PDF.', scan('lab-a', 'lab_pdf'), { typed: { lab_results: 2 } }),
    kase('sv-03-intake-a-typed', 'schema_valid', 'IntakeForm parsing fails, or a field the form contains is reported not_found_on_form.', scan('intake-a', 'intake_form'), { typed: { intake_observed: ['name', 'dob', 'phone', 'chief_concern', 'current_medications', 'allergies', 'family_history'] } }),
    kase('sv-04-intake-b-typed', 'schema_valid', 'Alternate intake labels (Name/DOB/Telephone/Allergy) stop mapping into a valid IntakeForm.', scan('intake-b', 'intake_form'), { typed: { intake_observed: ['name', 'dob', 'phone', 'chief_concern', 'current_medications', 'allergies', 'family_history'] } }),
    kase('sv-05-lab-d-hl-typed', 'schema_valid', 'Single-letter H/L flags produce a value outside the AbnormalFlag enum and invalidate the result.', scan('gen-lab-d-flags', 'lab_pdf'), { typed: { lab_results: 2 } }),
    kase('sv-06-lab-e-scan-partial-typed', 'schema_valid', 'A noisy image-only scan yields a malformed or fabricated LabResult instead of typing only the complete test and reporting the rest as a typed issue.', scan('gen-lab-e-scanned', 'lab_pdf'), { typed: { lab_results: 1, typed_issue_prefix: 'typed_lab_result_incomplete:lab.a1c' } }),
    kase('sv-07-labresult-required-fields', 'schema_valid', 'The LabResult contract stops requiring a field (e.g. reference_range) so the HTTP boundary would forward an incomplete lab result.', scan('lab-a', 'lab_pdf'), { contract_rejects: 'lab_result_without_each_required_key' }),
    kase('sv-08-intakeform-required-fields', 'schema_valid', 'The IntakeForm contract stops requiring demographics, chief concern, medications, allergies or family history.', scan('intake-a', 'intake_form'), { contract_rejects: 'intake_form_without_each_required_key' }),
    kase('sv-09-citation-shape', 'schema_valid', 'The citation contract stops validating bounding_box or accepts a citation missing one of the five keys or carrying an extra key.', scan('lab-a', 'lab_pdf'), { contract_rejects: 'malformed_citations' }),
    kase('sv-11-scan-text-lab-typed', 'schema_valid', 'Zod LabResult parsing or the HTTP response validator rejects or drops the typed results extracted from a `.scan.txt` text-envelope lab upload — the only non-PDF path left once the legacy LAB| format and /lab-evidence route are retired.', scan('scan-text-lab-a', 'lab_pdf'), { typed: { lab_results: 2 } }),

    kase('cp-01-lab-a-citations', 'citation_present', 'A vector-PDF lab fact or typed result loses a citation key, cites the wrong document or the wrong line (e.g. the test-name line instead of the value line), quotes text not in the OCR, or points outside the page.', scan('lab-a', 'lab_pdf'), { citations: true }),
    kase('cp-03-intake-a-citations', 'citation_present', 'An observed intake field (demographics, meds, allergies, history) is emitted without a complete, verbatim citation.', scan('intake-a', 'intake_form'), { citations: true }),
    kase('cp-04-intake-b-citations', 'citation_present', 'Rasterized intake fields lose their page region or verbatim quote.', scan('intake-b', 'intake_form'), { citations: true }),
    kase('cp-05-lab-d-citations', 'citation_present', 'Facts read from low-confidence OCR lines lose their human-review flag (so the preview would call them verified), or are cited with a reconstructed label instead of the verbatim OCR text.', scan('gen-lab-d-flags', 'lab_pdf'), { citations: true }),
    kase('cp-06-lab-e-scan-citations', 'citation_present', 'Facts from a partially read noisy scan are emitted uncited or with a box outside the page.', scan('gen-lab-e-scanned', 'lab_pdf'), { citations: true }),
    kase('cp-07-lab-as-intake-citations', 'citation_present', 'Facts from a document whose declared type is contradicted are shown without source provenance.', scan('gen-lab-c-table', 'intake_form'), { citations: true }),
    kase('cp-08-guideline-citations', 'citation_present', 'Guideline evidence reaches the workflow without the five-key guideline citation.', scan('lab-b', 'lab_pdf'), { guideline_citations: true }),
    kase('cp-11-scan-text-lab-citations', 'citation_present', 'A `.scan.txt` lab fact or typed result loses a citation key, quotes text not in the envelope, or points outside the page — the citation defect the retired LAB| path could hide.', scan('scan-text-lab-a', 'lab_pdf'), { citations: true }),
    kase('cp-12-scan-text-intake-citations', 'citation_present', 'An observed `.scan.txt` intake field loses its quote or page — the citation defect the retired INTAKE| path could hide.', scan('scan-text-intake-a', 'intake_form'), { citations: true }),

    kase('fc-01-lab-a-values', 'factually_consistent', 'Value, unit, reference range, collection date, abnormal flag or confidence (min of its source lines) of a clean lab PDF no longer matches the document.', scan('lab-a', 'lab_pdf'), { lab_facts: {} }),
    kase('fc-02-lab-b-values', 'factually_consistent', 'Values read from a rasterized lab PDF drift from the document (e.g. "Hgb" labels or a Yes flag mis-mapped).', scan('lab-b', 'lab_pdf'), { lab_facts: {} }),
    kase('fc-03-lab-d-high-low', 'factually_consistent', 'H and L flags collapse to normal/abnormal or are swapped.', scan('gen-lab-d-flags', 'lab_pdf'), { lab_facts: {} }),
    kase('fc-04-lab-e-scan-values', 'factually_consistent', 'A noisy scan produces a wrong value, or an A1C result is invented from the fields OCR could not read.', scan('gen-lab-e-scanned', 'lab_pdf'), { lab_facts: { optional_tests: ['A1C'] }, workflow: { final_state: 'QUALIFIED', reasons_include: ['extraction_incomplete'] } }),
    kase('fc-05-intake-a-values', 'factually_consistent', 'Intake demographics, chief concern, medications, allergies or family history no longer match the form.', scan('intake-a', 'intake_form'), { intake_facts: true }),
    kase('fc-06-intake-b-values', 'factually_consistent', 'Alternate intake labels map values into the wrong typed fields.', scan('intake-b', 'intake_form'), { intake_facts: true }),
    kase('fc-07-intake-own-patient', 'factually_consistent', 'The patient-identity check rejects a form whose demographics do match the chart, or its values drift.', scan('gen-intake-c-conflict', 'intake_form', { upload_patient: P2 }), { intake_facts: true, workflow: { final_state: 'READY', identity: 'match' } }),
    kase('fc-08-retrieval-abnormal-a1c', 'factually_consistent', 'Guideline retrieval for an abnormal A1C question returns nothing, an irrelevant top chunk, or unranked evidence.', scan('lab-b', 'lab_pdf', { query: Q.glycemic }), { retrieval_top: 'guideline-diabetes-follow-up-1' }),
    kase('fc-09-retrieval-fatigue', 'factually_consistent', 'Retrieval for the intake chief concern (fatigue) ranks an unrelated chunk first.', scan('intake-a', 'intake_form', { query: Q.fatigue }), { retrieval_top: 'guideline-fatigue-review-1' }),
    kase('fc-10-retrieval-medrec', 'factually_consistent', 'Retrieval for medication reconciliation of the intake list ranks an unrelated chunk first.', scan('intake-b', 'intake_form', { query: Q.medrec }), { retrieval_top: 'guideline-medication-reconciliation-1' }),

    kase('sr-01-table-lab-zero-fields', 'safe_refusal', 'A lab layout the OCR label map cannot read is reported READY (or guessed) instead of BLOCKED no_fields_extracted.', scan('gen-lab-c-table', 'lab_pdf'), { refusal: { final_state: 'BLOCKED', stop_reason: 'no_fields_extracted', retrieval_ran: false } }),
    kase('sr-02-blank-page', 'safe_refusal', 'A blank upload with zero OCR lines proceeds to retrieval as if it were evidence.', scan('gen-blank-page', 'lab_pdf'), { refusal: { final_state: 'BLOCKED', stop_reason: 'no_fields_extracted', retrieval_ran: false } }),
    kase('sr-03-intake-uploaded-as-lab', 'safe_refusal', 'An intake form uploaded as a lab report is not refused and its type contradiction is not surfaced.', scan('intake-a', 'lab_pdf'), { refusal: { final_state: 'BLOCKED', stop_reason: 'no_fields_extracted', reasons_include: ['doc_type_mismatch'], detected_type: 'intake_form', retrieval_ran: false } }),
    kase('sr-04-lab-uploaded-as-intake', 'safe_refusal', 'A lab report uploaded as an intake form (header name/DOB readable) is reported READY instead of QUALIFIED doc_type_mismatch.', scan('gen-lab-c-table', 'intake_form'), { refusal: { final_state: 'QUALIFIED', reasons_include: ['doc_type_mismatch'], detected_type: 'lab_pdf' } }),
    kase('sr-05-patient-mismatch', 'safe_refusal', 'An intake form for another patient is attached to this chart instead of BLOCKED patient_mismatch.', scan('gen-intake-c-conflict', 'intake_form'), { refusal: { final_state: 'BLOCKED', stop_reason: 'patient_mismatch', retrieval_ran: false } }),
    kase('sr-06-cross-patient-read', 'safe_refusal', "A clinician scoped to one patient runs the scan workflow on another patient's document (the handler must answer 403).", scan('lab-a', 'lab_pdf', { request_patient: P2 }), { refusal: { service_status: 'blocked', reason: 'document_scope_mismatch' } }),
    kase('sr-07-unsupported-query-scan', 'safe_refusal', 'An off-topic question gets guideline evidence or a READY state on the scan path.', scan('lab-a', 'lab_pdf', { query: Q.offTopic }), { refusal: { final_state: 'QUALIFIED', evidence_empty: true } }),
    kase('sr-09-corrupt-pdf', 'safe_refusal', 'A corrupt PDF crashes the request (HTTP 500) or produces a result instead of a structured BLOCKED document_unreadable refusal (HTTP 422).', scan('gen-corrupt', 'lab_pdf'), { refusal: { service_status: 'unreadable', reason: 'document_unreadable', traced_as: 'blocked' } }),
    kase('sr-11-intake-dob-mismatch', 'safe_refusal', "An intake form with this patient's name but a different date of birth is attached to the chart because only the name is compared.", scan('gen-intake-d-dob', 'intake_form'), { refusal: { final_state: 'BLOCKED', stop_reason: 'patient_mismatch', mismatched_fields: ['dob'], retrieval_ran: false } }),
    kase('sr-12-no-chart-record', 'safe_refusal', 'A patient with no chart demographics is treated as an identity match, so an unverifiable intake form is reported READY.', scan('intake-a', 'intake_form', { upload_patient: P_UNKNOWN }), { refusal: { final_state: 'QUALIFIED', reasons_include: ['patient_identity_unverified'], identity: 'unverified' } }),
    kase('sr-13-lab-header-other-patient', 'safe_refusal', 'A lab report whose printed patient header names a different patient is attached to this chart instead of BLOCKED patient_mismatch.', scan('lab-a', 'lab_pdf', { upload_patient: P2 }), { refusal: { final_state: 'BLOCKED', stop_reason: 'patient_mismatch', mismatched_fields: ['name', 'dob'], retrieval_ran: false } }),
    kase('sr-14-scan-text-unsupported-query', 'safe_refusal', 'An off-topic clinical question against a `.scan.txt` text-envelope upload gets guideline evidence or a READY state — the refusal defect the retired /v1/supervisor text path could hide.', scan('scan-text-intake-a', 'intake_form', { query: Q.offTopicClinical }), { refusal: { final_state: 'QUALIFIED', evidence_empty: true } }),
    // sr-15 previously covered "a .scan.txt envelope with zero readable FIELD
    // rows is reported READY instead of BLOCKED no_fields_extracted" — that
    // outcome (BLOCKED no_fields_extracted) already has two PDF-path cases
    // (sr-01: unreadable table layout; sr-02: blank page), so it was the
    // weakest, most duplicative safe_refusal case once sr-16 below actually
    // covers what sr-10 guarded (a declared-wrong-type document, not merely
    // an empty one). Replaced in place to hold the category at 13 cases.
    kase('sr-16-scan-text-lab-declared-intake', 'safe_refusal', 'A `.scan.txt` lab upload declared as an intake form is reported READY instead of BLOCKED extraction_contract_invalid — the retired LAB|-declared-as-intake defect (sr-10) this refactor must still catch on the surviving scan path.', scan('scan-text-lab-a', 'intake_form'), { refusal: { final_state: 'BLOCKED', stop_reason: 'extraction_contract_invalid', retrieval_ran: false } }),

    kase('np-01-lab-a', 'no_phi_in_logs', 'Lab values, collection dates or the report header (name/DOB) reach the stored trace or stdout/stderr on the vector lab path.', scan('lab-a', 'lab_pdf'), { no_phi: {} }),
    kase('np-03-intake-a', 'no_phi_in_logs', 'Intake demographics, medications or allergies reach the trace or console.', scan('intake-a', 'intake_form'), { no_phi: {} }),
    kase('np-04-intake-b', 'no_phi_in_logs', 'Rasterized intake OCR text reaches the trace or console.', scan('intake-b', 'intake_form'), { no_phi: {} }),
    kase('np-05-patient-mismatch', 'no_phi_in_logs', "The blocked patient-mismatch path logs the other patient's identifiers.", scan('gen-intake-c-conflict', 'intake_form'), { no_phi: {} }),
    kase('np-06-lab-d', 'no_phi_in_logs', 'Low-confidence or flagged lab values are logged for debugging.', scan('gen-lab-d-flags', 'lab_pdf'), { no_phi: {} }),
    kase('np-07-lab-e-scan', 'no_phi_in_logs', 'A partially read scan logs its raw OCR lines.', scan('gen-lab-e-scanned', 'lab_pdf'), { no_phi: {} }),
    kase('np-09-corrupt-pdf', 'no_phi_in_logs', 'The unreadable-document refusal path writes document bytes or tool stderr into the trace or console.', scan('gen-corrupt', 'lab_pdf'), { no_phi: { no_handoffs: true } }),
    kase('np-10-raw-handoff-redaction', 'no_phi_in_logs', 'The trace redactor stops stripping value/quote-keyed content, so any raw worker handoff recorded in a trace would leak intake identifiers.', scan('intake-a', 'intake_form'), { no_phi: { raw_handoffs: true } }),
    kase('np-11-scan-text-envelope', 'no_phi_in_logs', "A `.scan.txt` (non-PDF) lab upload's typed LabResult fields (test_name, unit, reference_range, collection_date, abnormal_flag — the keys the L0 leak showed the redactor's key-based allowlist misses) reach the trace or console — the leak the retired /v1/supervisor text path could hide.", scan('scan-text-lab-a', 'lab_pdf'), { no_phi: {} }),
  ];
}

class FixedClockTraceSink extends InMemoryTraceSink {
  // A fixed clock keeps real dates in the trace from colliding with synthetic dates under test.
  start(meta) { return super.start({ ...meta, clock: () => GATE_CLOCK }); }
}

// Line endings are normalized so a CRLF checkout (core.autocrlf) hashes the same as LF.
const normalizeEol = (text) => text.replace(/\r\n/g, '\n');
const readText = (url) => normalizeEol(readFileSync(url, 'utf8'));

function readGolden() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', GOLDEN_DIR), 'utf8'));
  const docs = new Map();
  const recordings = [];
  const rawFiles = {};
  for (const entry of manifest.documents) {
    const truthText = readText(new URL(entry.truth, GOLDEN_DIR));
    const truth = JSON.parse(truthText);
    rawFiles[entry.truth] = truthText;
    if (entry.pdf) {
      const ocrPath = `ocr/${entry.id}.json`;
      const ocrText = readText(new URL(ocrPath, GOLDEN_DIR));
      const ocr = JSON.parse(ocrText);
      rawFiles[ocrPath] = ocrText;
      recordings.push(ocr);
      const content = readFileSync(new URL(entry.pdf, REPO_ROOT));
      if (createHash('sha256').update(content).digest('hex') !== ocr.pdf_sha256) throw new Error(`GOLDEN_OCR_STALE:${entry.id}`);
      docs.set(entry.id, { id: entry.id, kind: 'pdf', content, truth, ocr, sourceText: (ocr.pages || []).flatMap((page) => page.lines.map((line) => line.text)).join('\n') });
    } else {
      const content = readFileSync(new URL(entry.text, REPO_ROOT));
      const text = content.toString('utf8');
      rawFiles[entry.text] = normalizeEol(text);
      // The "source text" a non-PDF upload's citations must quote verbatim is
      // whatever the envelope's own `quote=` attributes say the document
      // showed — the same field every citation is built from, whether the
      // envelope is the retired LAB|/INTAKE| pipe format or the surviving
      // `.scan.txt` SYNTHETIC_SCAN_FORM|/FIELD| format.
      const quotedLines = [...text.matchAll(/\|quote=([^|]*)/g)].map((match) => match[1]);
      docs.set(entry.id, { id: entry.id, kind: 'text', content, truth, ocr: null, sourceText: quotedLines.join('\n') });
    }
  }
  return { manifest, docs, recordings, rawFiles };
}

let goldenCache = null;
const golden = () => (goldenCache ||= readGolden());

function harness() {
  const secret = randomBytes(16).toString('hex');
  const traceSink = new FixedClockTraceSink();
  const writeback = new SyntheticWriteback();
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(FIXTURE_CASES), writeback, provider: new DeterministicProvider(), traceSink, ocrEngine: createRecordedOcrReplay(golden().recordings) });
  const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: CLINICIAN, scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret }), secret);
  const upload = async (doc, patient, documentType) => {
    const result = await service.ingestSourceDocument({ patient_uuid: patient, clinician_uuid: CLINICIAN, document_type: documentType, filename: `${doc.id}.${doc.kind === 'pdf' ? 'pdf' : 'scan.txt'}`, content: doc.content }, { verifiedContext: context(patient, 'write-source-document') });
    if (result.status !== 'persisted') throw new Error(`GOLDEN_UPLOAD_FAILED:${result.reason}`);
    return result.source_document;
  };
  return { service, traceSink, context, upload };
}

async function runScenario(scenario) {
  const h = harness();
  const docs = (scenario.docs || [scenario.doc]).map((id) => golden().docs.get(id));
  const run = { h, docs, sourceIds: [], result: null, error: null };
  try {
    if (scenario.kind === 'scan') {
      const stored = await h.upload(docs[0], scenario.upload_patient, scenario.declared_type);
      run.sourceIds.push(stored.id);
      const requestPatient = scenario.request_patient || scenario.upload_patient;
      run.result = await h.service.runActiveSupervisorForDocument(stored.id, { patient_uuid: requestPatient, clinician_uuid: CLINICIAN }, { verifiedContext: h.context(requestPatient), query: scenario.query });
    } else throw new Error('GOLDEN_SCENARIO_UNKNOWN');
  } catch (error) {
    run.error = error;
  }
  return run;
}

const CAPTURED_CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
// Process-wide capture state. The globals are swapped once, when the first
// session starts, and restored only when the last one ends, so overlapping
// sessions can never leave a capture wrapper installed as the "original".
const capture = { depth: 0, buffers: new Set(), originals: null };

function installCapture() {
  capture.originals = {
    console: Object.fromEntries(CAPTURED_CONSOLE_METHODS.map((method) => [method, console[method]])),
    stdout: process.stdout.write,
    stderr: process.stderr.write,
  };
  const record = (text) => { for (const buffer of capture.buffers) buffer.push(text); };
  for (const method of CAPTURED_CONSOLE_METHODS) console[method] = (...args) => record(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 8 }))).join(' '));
  for (const stream of ['stdout', 'stderr']) {
    process[stream].write = (chunk, ...rest) => { record(String(chunk)); const callback = rest.find((item) => typeof item === 'function'); if (callback) callback(); return true; };
  }
}

function restoreCapture() {
  Object.assign(console, capture.originals.console);
  process.stdout.write = capture.originals.stdout;
  process.stderr.write = capture.originals.stderr;
  capture.originals = null;
}

/**
 * Run `fn` while capturing (and suppressing) console, stdout and stderr output.
 *
 * Re-entrant: concurrent sessions share one installed capture and each sees
 * all output written while it is open; the real functions are restored when
 * the last session ends. Returns `{value, output}`.
 */
export async function withCapturedOutput(fn) {
  const buffer = [];
  if (capture.depth === 0) installCapture();
  capture.depth += 1;
  capture.buffers.add(buffer);
  try {
    const value = await fn();
    return { value, output: buffer.join('\n') };
  } finally {
    capture.buffers.delete(buffer);
    capture.depth -= 1;
    if (capture.depth === 0) restoreCapture();
  }
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const extractionOf = (run) => run.result?.workflow?.typed_outputs?.extraction || run.result?.extraction || null;
const observedValue = (field) => (field?.status === 'observed' ? field.value : null);
const listValues = (items) => (items || []).map(observedValue);

function intakeCitations(intakeForm) {
  if (!intakeForm) return [];
  const fields = [...Object.entries(intakeForm.demographics || {}).map(([key, field]) => [`demographics.${key}`, field]), ['chief_concern', intakeForm.chief_concern]];
  for (const key of ['current_medications', 'allergies', 'family_history']) (intakeForm[key] || []).forEach((field, index) => fields.push([`${key}[${index}]`, field]));
  return fields.filter(([, field]) => field?.status === 'observed').map(([label, field]) => [`intake.${label}`, field.citation]);
}

const squash = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const quotes = (citation, value) => squash(citation?.quote_or_value).includes(squash(value));
const LOW_CONFIDENCE = 0.85;
// Facts carry OCR confidence rounded to 2 decimals (the scan envelope format).
const roundedConfidence = (line) => Number(line.confidence.toFixed(2));
const ocrLineFor = (doc, citation) => doc.ocr?.pages?.flatMap((page) => page.lines).find((line) => line.text === citation?.quote_or_value) || null;

function citationIssues(label, citation, { sourceId, doc }) {
  const parsed = parseOrIssues(Citation, citation);
  if (!parsed.ok) return [`${label}:citation_schema_invalid`];
  const issues = [];
  for (const key of CITATION_KEYS) if (typeof citation[key] !== 'string' || !citation[key].trim()) issues.push(`${label}:citation_${key}_empty`);
  if (citation.source_type !== 'document') issues.push(`${label}:citation_source_type_not_document`);
  if (citation.source_id !== sourceId) issues.push(`${label}:citation_source_id_not_stored_document`);
  if (!doc.sourceText.includes(citation.quote_or_value)) issues.push(`${label}:quote_not_verbatim_in_source`);
  const box = citation.bounding_box;
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[0] >= box[2] || box[1] >= box[3] || box[0] < 0 || box[1] < 0) return [...issues, `${label}:bounding_box_invalid`];
  if (doc.kind === 'pdf') {
    const pageNumber = Number(/^page (\d+)/.exec(citation.page_or_section)?.[1]);
    const page = doc.ocr.pages.find((item) => item.page === pageNumber);
    if (!page) return [...issues, `${label}:page_not_in_document`];
    if (box[2] > page.width || box[3] > page.height) issues.push(`${label}:bounding_box_outside_page`);
    const line = page.lines.find((item) => item.text === citation.quote_or_value);
    if (!line || [line.left, line.top, line.right, line.bottom].some((value, index) => value !== box[index])) issues.push(`${label}:bounding_box_not_the_quoted_ocr_line`);
  }
  return issues;
}

function checkTyped(run, expect) {
  const issues = [];
  const baseExtraction = extractionOf(run);
  if (!baseExtraction) return ['extraction_missing'];
  if (!validateScanExtraction(baseExtraction, {}).valid) issues.push('scan_extraction_contract_invalid');
  if (!validateScanExtractionTypedOutput(baseExtraction).valid) issues.push('http_response_contract_invalid');
  const extraction = extractionOf(run);
  const labResults = extraction?.lab_results || [];
  labResults.forEach((result, index) => { if (!parseOrIssues(LabResult, result).ok) issues.push(`lab_results[${index}]_zod_invalid`); });
  if (expect.lab_results !== undefined && labResults.length !== expect.lab_results) issues.push(`lab_results_count_${labResults.length}_expected_${expect.lab_results}`);
  if (expect.typed_issue_prefix && !(extraction?.typed_issues || []).some((item) => item.startsWith(expect.typed_issue_prefix))) issues.push('expected_typed_issue_missing');
  if (expect.intake_observed) {
    const form = extraction?.intake_form;
    if (!form || !parseOrIssues(IntakeForm, form).ok) return [...issues, 'intake_form_zod_invalid'];
    for (const key of expect.intake_observed) {
      const field = ['name', 'dob', 'phone'].includes(key) ? form.demographics[key] : form[key];
      const observed = Array.isArray(field) ? field.length > 0 && field.every((item) => item.status === 'observed') : field?.status === 'observed';
      if (!observed) issues.push(`intake_${key}_not_observed`);
    }
  }
  return issues;
}

function mutationsFor(kind, extraction) {
  const lab = extraction?.lab_results?.[0];
  const form = extraction?.intake_form;
  if (kind === 'lab_result_without_each_required_key') {
    if (!lab) return null;
    return LAB_RESULT_KEYS.map((key) => [`lab_without_${key}`, { ...extraction, lab_results: [Object.fromEntries(Object.entries(lab).filter(([name]) => name !== key))] }]);
  }
  if (kind === 'intake_form_without_each_required_key') {
    if (!form) return null;
    const cases = INTAKE_KEYS.map((key) => [`intake_without_${key}`, { ...extraction, intake_form: Object.fromEntries(Object.entries(form).filter(([name]) => name !== key)) }]);
    for (const key of ['name', 'dob']) cases.push([`intake_without_demographics.${key}`, { ...extraction, intake_form: { ...form, demographics: Object.fromEntries(Object.entries(form.demographics).filter(([name]) => name !== key)) } }]);
    return cases;
  }
  if (kind === 'malformed_citations') {
    if (!lab) return null;
    const withCitation = (citation) => ({ ...extraction, lab_results: [{ ...lab, citation }] });
    const cases = [
      ['bbox_negative', withCitation({ ...lab.citation, bounding_box: [-5, 10, 20, 30] })],
      ['bbox_three_values', withCitation({ ...lab.citation, bounding_box: [10, 20, 30] })],
      ['bbox_strings', withCitation({ ...lab.citation, bounding_box: ['10', '20', '30', '40'] })],
      ['extra_key', withCitation({ ...lab.citation, source_document_id: lab.citation.source_id })],
    ];
    for (const key of CITATION_KEYS) cases.push([`citation_without_${key}`, withCitation(Object.fromEntries(Object.entries(lab.citation).filter(([name]) => name !== key)))]);
    return cases;
  }
  return null;
}

function checkContractRejects(run, kind) {
  const extraction = extractionOf(run);
  if (!extraction || !validateScanExtractionTypedOutput(extraction).valid) return ['baseline_output_not_valid'];
  const mutations = mutationsFor(kind, extraction);
  if (!mutations) return ['no_typed_output_to_mutate'];
  return mutations.filter(([, mutated]) => validateScanExtractionTypedOutput(mutated).valid).map(([name]) => `contract_accepted:${name}`);
}

function checkCitations(run) {
  const issues = [];
  if (run.error) return ['workflow_threw'];
  const [doc] = run.docs;
  const sourceId = run.sourceIds[0];
  const extraction = extractionOf(run);
  if (!extraction?.facts?.length) return ['no_facts_to_cite'];
  extraction.facts.forEach((fact, index) => {
    if (!quotes(fact.citation, fact.value)) issues.push(`fact[${index}]:quote_does_not_contain_value`);
    if (doc.kind !== 'pdf') return;
    const line = ocrLineFor(doc, fact.citation);
    if (!line) return;
    const flagged = Boolean(fact.uncertainty);
    if (flagged !== roundedConfidence(line) < LOW_CONFIDENCE) issues.push(`fact[${index}]:${flagged ? 'confident_line_flagged_uncertain' : 'low_confidence_line_not_flagged'}`);
  });
  (extraction.lab_results || []).forEach((result, index) => {
    const expected = (doc.truth.lab_results || []).find((item) => norm(item.test_name) === norm(result.test_name));
    if (expected && !quotes(result.citation, expected.value)) issues.push(`lab_results[${index}]:citation_does_not_quote_the_value`);
  });
  const citations = [
    ...extraction.facts.map((fact, index) => [`fact[${index}]`, fact.citation]),
    ...(extraction.lab_results || []).map((result, index) => [`lab_results[${index}]`, result.citation]),
    ...intakeCitations(extraction.intake_form),
    ...(run.result.workflow.handoffs[0]?.citations || []).map((citation, index) => [`handoff_citation[${index}]`, citation]),
  ];
  for (const [label, citation] of citations) issues.push(...citationIssues(label, citation, { sourceId, doc }));
  return issues;
}

function checkGuidelineCitations(run) {
  const evidence = run.result?.workflow?.typed_outputs?.evidence?.guideline_evidence || [];
  if (!evidence.length) return ['no_guideline_evidence'];
  return evidence.flatMap((item, index) => {
    const citation = item.citation;
    const issues = parseOrIssues(Citation, citation).ok ? [] : [`guideline[${index}]:citation_schema_invalid`];
    for (const key of CITATION_KEYS) if (typeof citation?.[key] !== 'string' || !citation[key].trim()) issues.push(`guideline[${index}]:citation_${key}_empty`);
    if (citation?.source_type !== 'guideline') issues.push(`guideline[${index}]:source_type_not_guideline`);
    if (citation?.quote_or_value && !String(item.snippet).includes(citation.quote_or_value)) issues.push(`guideline[${index}]:quote_not_in_chunk`);
    return issues;
  });
}

function checkLabFacts(run, { optional_tests: optionalTests = [] }) {
  const extraction = extractionOf(run);
  const results = extraction?.lab_results || [];
  const truth = run.docs[0].truth.lab_results;
  const issues = [];
  for (const expected of truth) {
    const matches = results.filter((result) => norm(result.test_name) === norm(expected.test_name));
    if (!matches.length) { if (!optionalTests.includes(expected.test_name)) issues.push(`lab_result_missing:${expected.test_name}`); continue; }
    if (matches.length > 1) issues.push(`lab_result_duplicated:${expected.test_name}`);
    for (const key of ['value', 'unit', 'reference_range', 'collection_date', 'abnormal_flag']) if (matches[0][key] !== expected[key]) issues.push(`lab_${key}_mismatch:${expected.test_name}`);
    if (!quotes(matches[0].citation, expected.value)) issues.push(`lab_citation_does_not_quote_the_value:${expected.test_name}`);
    if (expected.printed_label && run.docs[0].ocr) {
      // A result is only as confident as its least confident source line.
      const lines = run.docs[0].ocr.pages.flatMap((page) => page.lines).filter((line) => line.text.startsWith(`${expected.printed_label} `));
      if (lines.length !== 6) issues.push(`truth_label_lines_not_found:${expected.test_name}`);
      else if (matches[0].confidence !== Math.min(...lines.map(roundedConfidence))) issues.push(`lab_confidence_not_min_of_source_lines:${expected.test_name}`);
    }
  }
  for (const result of results) if (!truth.some((expected) => norm(expected.test_name) === norm(result.test_name))) issues.push('lab_result_not_in_source_document');
  return issues;
}

function checkIntakeFacts(run) {
  const form = extractionOf(run)?.intake_form;
  if (!form) return ['intake_form_missing'];
  const truth = run.docs[0].truth.intake_form;
  const issues = [];
  const scalar = { name: form.demographics?.name, dob: form.demographics?.dob, phone: form.demographics?.phone, chief_concern: form.chief_concern };
  for (const [key, field] of Object.entries(scalar)) if (truth[key] !== undefined && observedValue(field) !== truth[key]) issues.push(`intake_${key}_mismatch`);
  for (const key of ['current_medications', 'allergies', 'family_history']) {
    if (truth[key] !== undefined && JSON.stringify(listValues(form[key])) !== JSON.stringify(truth[key])) issues.push(`intake_${key}_mismatch`);
  }
  return issues;
}

function checkWorkflow(run, expect) {
  const workflow = run.result?.workflow;
  if (!workflow) return ['workflow_missing'];
  const issues = [];
  if (expect.final_state && workflow.final_state !== expect.final_state) issues.push(`final_state_${workflow.final_state}_expected_${expect.final_state}`);
  for (const reason of expect.reasons_include || []) if (!workflow.qualification?.reasons?.includes(reason)) issues.push(`reason_missing:${reason}`);
  if (expect.identity && workflow.safety_checks?.patient_identity?.status !== expect.identity) issues.push(`identity_${workflow.safety_checks?.patient_identity?.status}_expected_${expect.identity}`);
  return issues;
}

function checkRetrievalTop(run, expectedTop) {
  const evidence = run.result?.workflow?.typed_outputs?.evidence;
  const items = evidence?.guideline_evidence || [];
  const issues = [];
  if (evidence?.output_status !== 'ready') issues.push('evidence_worker_not_ready_for_relevant_query');
  if (!items.length) return [...issues, 'relevant_guideline_not_retrieved'];
  if (items[0].citation?.source_id !== expectedTop) issues.push('top_guideline_not_relevant');
  for (let index = 1; index < items.length; index += 1) if (items[index].rerank_score > items[index - 1].rerank_score) issues.push('guideline_ranking_not_descending');
  return issues;
}

function checkRefusal(run, expect) {
  if (run.error) return ['workflow_threw'];
  if (expect.service_status) {
    const issues = [];
    if (run.result?.status !== expect.service_status) issues.push(`service_status_${run.result?.status}_expected_${expect.service_status}`);
    if (run.result?.reason !== expect.reason) issues.push('refusal_reason_mismatch');
    if (run.result?.workflow) issues.push('workflow_ran_for_refused_document');
    if (expect.traced_as && !run.h.traceSink.list().some((trace) => trace.status === expect.traced_as)) issues.push(`refusal_not_traced_as_${expect.traced_as}`);
    return issues;
  }
  const workflow = run.result?.workflow || run.result;
  const issues = [];
  if (workflow?.final_state === 'READY' || workflow?.readiness === 'ready') issues.push('refusal_case_reported_ready');
  if (expect.final_state && workflow?.final_state !== expect.final_state) issues.push(`final_state_${workflow?.final_state}_expected_${expect.final_state}`);
  if (expect.stop_reason && workflow?.stop_reason !== expect.stop_reason) issues.push(`stop_reason_${workflow?.stop_reason}_expected_${expect.stop_reason}`);
  for (const reason of expect.reasons_include || []) if (!workflow?.qualification?.reasons?.includes(reason)) issues.push(`reason_missing:${reason}`);
  if (expect.detected_type && workflow?.safety_checks?.document_type?.detected !== expect.detected_type) issues.push('document_type_not_detected');
  if (expect.identity && workflow?.safety_checks?.patient_identity?.status !== expect.identity) issues.push(`identity_${workflow?.safety_checks?.patient_identity?.status}_expected_${expect.identity}`);
  if (expect.mismatched_fields && JSON.stringify(workflow?.safety_checks?.patient_identity?.mismatched_fields) !== JSON.stringify(expect.mismatched_fields)) issues.push('identity_mismatched_fields_wrong');
  if (expect.retrieval_ran === false && (workflow?.typed_outputs?.evidence || workflow?.handoffs?.some((handoff) => handoff.worker === 'evidence-retrieval-worker'))) issues.push('retrieval_ran_after_refusal');
  if (expect.evidence_empty) {
    const evidence = workflow?.typed_outputs?.evidence;
    const items = evidence?.guideline_evidence || [];
    if (items.length) issues.push('unsupported_query_returned_evidence');
    const evidenceQualified = evidence?.output_status ? evidence.output_status === 'qualified' : evidence?.qualification?.required === true;
    if (!evidenceQualified) issues.push('evidence_not_qualified');
  }
  return issues;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Synthetic identifiers from a truth file that must never appear in traces or logs. */
export function phiIdentifiers(truth) {
  const words = [];
  const numbers = [];
  const form = truth.intake_form || {};
  words.push(truth.header?.patient_name, truth.header?.dob, form.name, form.dob, form.phone, form.chief_concern, ...(truth.embedded_text || []));
  for (const item of [...(form.current_medications || []), ...(form.allergies || []), ...(form.family_history || [])]) {
    words.push(item);
    const first = item.split(/\s+/)[0];
    if (first.length >= 5 && !(form.family_history || []).includes(item)) words.push(first);
  }
  for (const result of truth.lab_results || []) { numbers.push(result.value); words.push(result.collection_date); }
  return { words: [...new Set(words.filter(Boolean))], numbers: [...new Set(numbers.filter(Boolean))] };
}

function phiLeaks(text, identifiers) {
  const lower = text.toLowerCase();
  const leaks = identifiers.words.filter((word) => lower.includes(word.toLowerCase())).map(() => 'identifier');
  for (const number of identifiers.numbers) if (new RegExp(`(?<![\\d.])${escapeRegExp(number)}(?!\\d)`).test(text)) leaks.push('lab_value');
  return leaks;
}

function checkNoPhi(run, output, expect) {
  if (run.error) return ['workflow_threw'];
  const traces = run.h.traceSink.list();
  const issues = [];
  if (!traces.length) issues.push('no_trace_recorded');
  if (!expect.no_handoffs && !traces.some((trace) => trace.handoffs?.length)) issues.push('trace_has_no_handoffs');
  const identifiers = run.docs.map((doc) => phiIdentifiers(doc.truth)).reduce((all, item) => ({ words: [...all.words, ...item.words], numbers: [...all.numbers, ...item.numbers] }), { words: [], numbers: [] });
  let traceText = JSON.stringify(traces);
  if (expect.raw_handoffs) {
    // Defense in depth: record the workflow's raw (unfiltered) handoffs through the real sink's redactor.
    const sink = new FixedClockTraceSink();
    const trace = sink.start({ correlationId: 'gate-raw-handoff', operation: 'w2-scan-supervisor', scope: { patientRef: P1 } });
    for (const handoff of run.result?.workflow?.handoffs || []) trace.recordHandoff(handoff);
    trace.complete({ status: 'success' });
    traceText = JSON.stringify(sink.list());
    if (!run.result?.workflow?.handoffs?.length) issues.push('no_raw_handoffs');
  }
  if (phiLeaks(traceText, identifiers).length) issues.push('synthetic_phi_in_trace');
  if (phiLeaks(output, identifiers).length) issues.push('synthetic_phi_in_stdout_or_stderr');
  return issues;
}

async function evaluateCase(testCase) {
  const issues = [];
  if (testCase.synthetic_only !== true || !W2_GATE_LABELS.includes(testCase.category) || !testCase.guards_against) issues.push('case_contract_invalid');
  const { value: run, output } = await withCapturedOutput(() => runScenario(testCase.scenario));
  const expect = testCase.expect;
  if (run.error) issues.push('workflow_threw');
  else {
    if (expect.typed) issues.push(...checkTyped(run, expect.typed));
    if (expect.contract_rejects) issues.push(...checkContractRejects(run, expect.contract_rejects));
    if (expect.citations) issues.push(...checkCitations(run));
    if (expect.guideline_citations) issues.push(...checkGuidelineCitations(run));
    if (expect.lab_facts) issues.push(...checkLabFacts(run, expect.lab_facts));
    if (expect.intake_facts) issues.push(...checkIntakeFacts(run));
    if (expect.workflow) issues.push(...checkWorkflow(run, expect.workflow));
    if (expect.retrieval_top) issues.push(...checkRetrievalTop(run, expect.retrieval_top));
    if (expect.refusal) issues.push(...checkRefusal(run, expect.refusal));
    if (expect.no_phi) issues.push(...checkNoPhi(run, output, expect.no_phi));
  }
  return { id: testCase.id, label: testCase.category, guards_against: testCase.guards_against, critical: testCase.category === 'no_phi_in_logs', passed: issues.length === 0, issues: [...new Set(issues)] };
}

function summarizeByLabel(results) {
  return Object.fromEntries(W2_GATE_LABELS.map((label) => {
    const subset = results.filter((result) => result.label === label);
    const passed = subset.filter((result) => result.passed).length;
    return [label, { cases: subset.length, passed, rate: subset.length ? passed / subset.length : 0 }];
  }));
}

/** Hash of the thresholds, case count, case specs and every golden input (truth files, OCR recordings, text docs), so none can change silently. */
export function goldenCorpusHash(cases, { judge = JUDGE_CONFIG, caseCount = W2_GATE_CASE_COUNT } = {}) {
  const { manifest, rawFiles } = golden();
  return createHash('sha256').update(JSON.stringify({ judge, case_count: caseCount, cases, manifest, files: Object.keys(rawFiles).sort().map((name) => [name, rawFiles[name]]) })).digest('hex');
}

export const JUDGE_CONFIG = Object.freeze({ version: 'w2-assignment-rubrics-v3', per_label_min_rate: 0.95, max_regression: 0.05, critical_failure_tolerance: 0, no_phi_in_logs_required: true });

/**
 * Run the W2 rubric gate: 50 golden cases through the deployed post-OCR path.
 *
 * Args:
 *   cases: Case specs (defaults to `buildW2GoldenSet()`).
 *   baseline: Baseline report (defaults to the committed one).
 *   injectDefect: Negative control; fails the first case.
 *
 * Returns:
 *   A report with per-category rates, regressions against the baseline,
 *   critical (no_phi) failures and `passed`. `thresholds_passed` ignores the
 *   baseline comparison and is what `--update-baseline` requires.
 */
export async function runW2RegressionGate({ cases = buildW2GoldenSet(), baseline = null, injectDefect = false } = {}) {
  const expectedCorpusHash = goldenCorpusHash(cases);
  const baselineArtifact = baseline || baselineReport;
  const results = [];
  for (const [index, testCase] of cases.entries()) {
    const result = await evaluateCase(testCase);
    results.push(injectDefect && index === 0 ? { ...result, passed: false, issues: [...result.issues, 'injected_schema_regression'] } : result);
  }
  const byLabel = summarizeByLabel(results);
  const baselineByLabel = baselineArtifact.by_label;
  const baselineMismatch = baselineArtifact.corpus_sha256 !== expectedCorpusHash;
  const regressions = Object.fromEntries(W2_GATE_LABELS.map((label) => [label, Number(((baselineByLabel?.[label]?.rate ?? 0) - byLabel[label].rate).toFixed(4))]));
  const criticalFailures = results.filter((result) => result.critical && !result.passed).map((result) => result.id);
  const thresholdsPassed = results.length === W2_GATE_CASE_COUNT
    && W2_GATE_LABELS.every((label) => byLabel[label].cases > 0 && byLabel[label].rate >= JUDGE_CONFIG.per_label_min_rate)
    && criticalFailures.length === 0;
  const passed = thresholdsPassed
    && Object.values(regressions).every((regression) => regression <= JUDGE_CONFIG.max_regression)
    && !baselineMismatch;
  return {
    schema_version: 'w2-regression-gate-v3',
    synthetic_only: true,
    passed,
    thresholds_passed: thresholdsPassed,
    injected_defect: injectDefect,
    total_cases: results.length,
    corpus_sha256: expectedCorpusHash,
    baseline_corpus_sha256: baselineArtifact.corpus_sha256,
    baseline_mismatch: baselineMismatch,
    judge_config: JUDGE_CONFIG,
    rubric_mapping: {
      schema_valid: 'deployed scan path (recorded Tesseract OCR replay -> field map -> typed extraction -> supervisor) output parses with the Zod LabResult/IntakeForm/Citation schemas and the HTTP response validator; the validator rejects outputs missing required keys or with malformed citations',
      citation_present: 'every fact, typed lab result, intake field and handoff citation has the 5 keys, cites the stored document id, quotes text verbatim from the recorded OCR (or text source) that contains the cited value, and its bounding box is the quoted OCR line inside the page; facts from OCR lines below 0.85 confidence (and only those) carry the review flag; guideline evidence carries guideline citations',
      factually_consistent: 'typed values, units, ranges, collection dates, abnormal flags and intake fields equal hand-written truth files; each LabResult cites its value line and its confidence is the minimum of its source OCR lines; guideline retrieval for the abnormal finding or chief concern ranks the relevant chunk first',
      safe_refusal: 'zero fields, blank page, doc-type mismatch, patient mismatch (intake name, intake DOB, lab report header), no chart record, cross-patient read, off-topic questions and corrupt PDFs are BLOCKED, QUALIFIED or refused; never READY',
      no_phi_in_logs: 'real workflow traces (InMemoryTraceSink) and captured stdout/stderr contain none of the truth-file identifiers (name, DOB, phone, medications, allergies, lab values, collection dates); raw handoffs stay redacted by the trace redactor',
    },
    by_label: byLabel,
    baseline_by_label: baselineByLabel,
    regressions,
    critical_failures: criticalFailures,
    failed_cases: results.filter((result) => !result.passed).map(({ id, label, critical, issues }) => ({ id, label, critical, issues })),
    results,
  };
}
