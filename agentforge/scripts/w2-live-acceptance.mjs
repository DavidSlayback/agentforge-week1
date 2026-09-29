#!/usr/bin/env node
/**
 * S11 scripted proof for the W2 deployment (PLAN "S11 — Freeze, deploy,
 * prove, record" and "Acceptance evidence ledger"). Run by a reviewer AFTER
 * the freeze-SHA deploy, against the public URL:
 *
 *   AGENTFORGE_LIVE_URL=https://dtstest.64.177.10.182.nip.io/agentforge-w2 \
 *   AGENTFORGE_EXPECT_SHA=<freeze sha> \
 *   node agentforge/scripts/w2-live-acceptance.mjs [--ledger docs/agentforge/evidence/LEDGER.md]
 *
 * Never invoked by `npm test` or the eval gate: this script makes real
 * network calls and, for the golden uploads, real writes to the deployed
 * OpenEMR module for the allowlisted synthetic patient `fixture-patient-001`.
 * `fixture-patient-002` is only ever used as an unauthorized cross-patient
 * probe (AGENTS.md: "any change would write to OpenEMR for a non-seeded
 * patient" is a stop condition — this script never writes for patient-002,
 * it only proves a read/scan attempt against it is refused).
 *
 * Optional: AGENTFORGE_DASHBOARD_URL (or --dashboard-url), default
 * `<origin of AGENTFORGE_LIVE_URL>/dashboard`, for the W2-DASHBOARD-SHA row.
 *
 * Upload budget: exactly 7 real uploads, sequential (never parallel), all
 * for fixture-patient-001 --
 *   1. filled-lab-a.pdf as lab_pdf
 *   2. the same bytes re-uploaded (duplicate-detection proof)
 *   3. filled-intake-a.pdf as intake_form
 *   4. filled-intake-a.pdf's bytes mislabeled as lab_pdf (fail-loud probe)
 *   5. filled-medlist-a.pdf as medication_list (X-3)
 *   6. filled-intake-a.pdf's bytes mislabeled as medication_list (X-3-MISLABEL)
 *   7. filled-lab-c.pdf as lab_pdf (X-4, the second trend point)
 * The legacy `LAB|` text-format probe (requirement 7) is rejected by
 * `validateSourceDocumentRequest` before any OpenEMR write is attempted, so
 * it is not counted against the budget.
 *
 * See `docs/agentforge/PLAN.md` "Requirements matrix" (W2-C1, W2-C2, W2-C4,
 * W2-C6, W2-C7, W2-C8, W2-C10, W2-C11, W2-SF1, and the E7 extension items
 * X-1..X-4, E8) for what each check proves. `PLANNED_CHECKS` lists every row
 * id; a planned id with no row at the end of the run is a FAIL.
 *
 * PHI (AGENTS.md): never print a claim's text, a citation's quote/value, or
 * a patient's name/DOB/phone -- only ids, counts, booleans and status codes.
 * The one exception is the demographics-leak check (requirement 4), which
 * reports *which* demographic field leaked (e.g. "dob"), never the value.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchNewTrace } from './measure-live-metrics.mjs';
import { clickToSourceIssues } from '../src/extensionCases/clickToSource.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SAMPLES_DIR = `${REPO_ROOT}docs/agentforge/fixtures/scan-forms/pdf-samples/`;
const TRUTH_DIR = `${REPO_ROOT}agentforge/test/fixtures/golden/truth/`;

export const PATIENT = 'fixture-patient-001';
export const OTHER_PATIENT = 'fixture-patient-002';
export const CLINICIAN = 'fixture-physician-001';
export const SCAN_MESSAGE = 'What changed and what should I pay attention to?';
export const SCAN_SUPERVISOR_OPERATION = 'w2-scan-supervisor';

export const REQUIRED_CITATION_KEYS = ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value'];
export const OPTIONAL_CITATION_KEYS = ['bounding_box', 'coordinate_space'];
export const DEGRADED_RETRIEVAL_LABELS = new Set(['sparse_only', 'stub', 'no_rerank']);
const DEFAULT_DECISION_ORDER = ['EXTRACT', 'RETRIEVE', 'ANSWER'];

// ---------------------------------------------------------------------------
// Pure assertion helpers -- no network, unit-tested against hand-built
// fixtures in test/w2-live-acceptance.test.js. Nothing below this comment
// block, up to `main()`, touches the network.
// ---------------------------------------------------------------------------

/**
 * A citation is valid under the W2 contract (`schemas.js#Citation`) only if
 * it has all 5 required keys (each a non-empty string) and no keys besides
 * the 2 optional bounding-box ones -- an old key name (`source_document_id`,
 * `location`) or a missing required one must fail this, not pass silently.
 */
export function citationHasExactKeys(citation) {
  if (!citation || typeof citation !== 'object' || Array.isArray(citation)) return false;
  const keys = Object.keys(citation);
  const requiredPresentAndNonEmpty = REQUIRED_CITATION_KEYS.every((key) => typeof citation[key] === 'string' && citation[key].length > 0);
  const noUnknownKeys = keys.every((key) => REQUIRED_CITATION_KEYS.includes(key) || OPTIONAL_CITATION_KEYS.includes(key));
  return requiredPresentAndNonEmpty && noUnknownKeys;
}

/**
 * Walk an arbitrary response fragment (an answer, an extraction, a whole
 * workflow) and collect every object that looks like a citation -- anything
 * reachable through a `citation` or `citations` key that itself carries a
 * `source_type`. This is how "every citation in answer and facts" (the S11
 * task wording) is checked without hardcoding every citation-bearing path
 * (`AnswerClaim.citations`, `LabResult.citation`, `IntakeForm` leaf field
 * citations, generic `extraction.facts[].citation`, `GuidelineEvidence.citation`)
 * -- new citation-bearing fields are picked up automatically.
 */
export function collectCitations(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const found = [];
  if (Array.isArray(value)) {
    for (const item of value) found.push(...collectCitations(item, seen));
    return found;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'citation' || key === 'citations') && item) {
      for (const candidate of Array.isArray(item) ? item : [item]) {
        if (candidate && typeof candidate === 'object' && 'source_type' in candidate) found.push(candidate);
      }
    }
    found.push(...collectCitations(item, seen));
  }
  return found;
}

/**
 * W2-C6: "routing decisions inspectable" -- true only when `decisions`
 * (`workflow.decisions[]` / a trace's `decisions[]`, each `{next, reason}`)
 * contains EXTRACT, then RETRIEVE, then ANSWER, in that order (not
 * necessarily adjacent, and not necessarily the only decisions present --
 * e.g. a cached-extraction retry still records an extra EXTRACT first).
 */
export function decisionsIncludeOrder(decisions, order = DEFAULT_DECISION_ORDER) {
  if (!Array.isArray(decisions)) return false;
  let cursor = -1;
  for (const wanted of order) {
    const index = decisions.findIndex((decision, i) => i > cursor && decision?.next === wanted);
    if (index === -1) return false;
    cursor = index;
  }
  return true;
}

/**
 * Requirement 4: an intake document's grounded answer must never surface raw
 * demographics (name/DOB/phone) as a `patient_fact` claim's text. Returns the
 * list of demographic field NAMES that leaked (e.g. `['dob']`) -- never the
 * values themselves, so a caller can log/report this without ever printing
 * PHI (AGENTS.md). A demographic value shorter than 3 characters is skipped
 * (too likely to false-positive on ordinary prose).
 */
export function findDemographicsLeak(claims, demographics) {
  const patientFactText = (claims || [])
    .filter((claim) => claim?.kind === 'patient_fact')
    .map((claim) => String(claim.text || '').toLowerCase())
    .join('\n');
  const leaked = [];
  for (const [field, rawValue] of Object.entries(demographics || {})) {
    if (rawValue === null || rawValue === undefined) continue;
    const needle = String(rawValue).toLowerCase().trim();
    if (needle.length >= 3 && patientFactText.includes(needle)) leaked.push(field);
  }
  return leaked;
}

/** Every stage in a trace's `stages[]` must carry a numeric `durationMs` (W2-C10). */
export function everyStageHasDuration(stages) {
  return Array.isArray(stages) && stages.length > 0 && stages.every((stage) => typeof stage?.durationMs === 'number');
}

/**
 * W2-C10: the trace has at least one guideline-retrieval attempt
 * (`tool: 'evidence-retriever'`, supervisor.js) and every one of them carries
 * a numeric `hit_count`. Chart-read attempts (service.js, keyed by `adapter`
 * and `group`) have no hit count and are not retrieval-tool attempts.
 */
export function retrievalHasHitCount(retrieval) {
  const attempts = Array.isArray(retrieval?.attempts) ? retrieval.attempts.filter((attempt) => attempt?.tool === 'evidence-retriever') : [];
  return attempts.length > 0 && attempts.every((attempt) => typeof attempt.hit_count === 'number');
}

// ---------------------------------------------------------------------------
// E7 extension-item evaluators (X-1..X-4, E8, alerts, dashboard SHA). Each
// takes the already-fetched response(s) and returns `{ pass, evidence }`,
// where `evidence` holds ids, counts, booleans and status codes only (no
// claim text, no quoted or extracted values, no tokens). Every one checks
// every item (`every`), and an empty set never passes.
// ---------------------------------------------------------------------------

export const CRITIC_WORKER = 'critic-worker';
export const CHART_FACT_SOURCE_TYPES = Object.freeze({ fixture: 'synthetic_chart_fixture', openemr: 'openemr_record' });
export const LAB_TREND_CODES = Object.freeze({ A1C: '4548-4', Hemoglobin: '718-7' });
export const OPENEMR_LAB_BOUNDARY = 'openemr-module';
export const OPENEMR_LAB_READ_PATH = 'openemr-fhir-service-in-process';
export const EXPECTED_P95_THRESHOLD_MS = 30000;
const MEDICATION_ROW_CITATION = /^medication\.\d+\.name$/;
const FIXTURE_PATIENT_REF = /fixture[-_ ]patient[-_ ]\d{3}/i;
const decodeHtmlAttribute = (value) => String(value).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');

/**
 * X-1 click-to-source on the served `/source-preview` HTML. Reuses the E0
 * gate's pure check (`clickToSourceIssues`): every "View source region" link
 * targets an existing `source-box` id and every box links back to a row.
 * Adds: at least one link, one box and one page `<img>`. `imageSrcs` (which
 * carry the demo token) are returned for the caller to fetch and are never
 * put in `evidence`.
 */
export function evaluateSourcePreview({ status, html }) {
  const text = typeof html === 'string' ? html : '';
  const links = [...text.matchAll(/class="citation-source-link" href="#([^"]+)"/g)].map((match) => match[1]);
  const boxIds = new Set([...text.matchAll(/class="source-box [^"]*" id="([^"]+)"/g)].map((match) => match[1]));
  const imageSrcs = [...text.matchAll(/<div class="pdf-page"[^>]*><img src="([^"]+)"/g)].map((match) => decodeHtmlAttribute(match[1]));
  const issues = text ? clickToSourceIssues(text, null, { minLinks: 1 }) : ['no_html'];
  const linksWithoutBox = links.filter((target) => !boxIds.has(target)).length;
  const pass = status === 200 && issues.length === 0 && links.length > 0 && boxIds.size > 0 && imageSrcs.length > 0 && linksWithoutBox === 0;
  return { pass, imageSrcs, evidence: { status, source_links: links.length, source_boxes: boxIds.size, links_without_box: linksWithoutBox, page_images: imageSrcs.length, issue_codes: issues.map((issue) => issue.split(':')[0]) } };
}

/**
 * X-2 critic on the lab-a scan-supervisor response and its trace: the answer
 * is `critic_status: 'reviewed'` (anything else -- `disabled`, `failed`,
 * `skipped_*` -- fails), the workflow and the trace both carry a CRITIQUE
 * decision and a critic-worker handoff, the trace's critic step says
 * `reviewed`, and a numeric critic duration is recorded.
 */
export function evaluateCritic({ scanStatus, workflow, trace }) {
  const answerStatus = workflow?.answer?.critic_status ?? null;
  const hasCritique = (decisions) => Array.isArray(decisions) && decisions.some((decision) => decision?.next === 'CRITIQUE');
  const hasCriticHandoff = (handoffs) => Array.isArray(handoffs) && handoffs.some((handoff) => handoff?.worker === CRITIC_WORKER);
  const stageDuration = (trace?.stages || []).find((stage) => stage?.name === 'critic')?.durationMs;
  const durationMs = typeof trace?.critic?.duration_ms === 'number' ? trace.critic.duration_ms : typeof stageDuration === 'number' ? stageDuration : null;
  const checks = {
    answer_reviewed: answerStatus === 'reviewed',
    workflow_critique_decision: hasCritique(workflow?.decisions),
    workflow_critic_handoff: hasCriticHandoff(workflow?.handoffs),
    trace_found: Boolean(trace),
    trace_critic_reviewed: trace?.critic?.status === 'reviewed',
    trace_critique_decision: hasCritique(trace?.decisions),
    trace_critic_handoff: hasCriticHandoff(trace?.handoffs),
    critic_duration_recorded: typeof durationMs === 'number',
  };
  const pass = scanStatus === 200 && Object.values(checks).every(Boolean);
  return { pass, evidence: { status: scanStatus, critic_status: answerStatus, trace_critic_status: trace?.critic?.status ?? null, critic_duration_ms: durationMs, failed_checks: Object.keys(checks).filter((key) => !checks[key]) } };
}

/**
 * X-3 `medication_list`: the upload returns an OpenEMR document id and reads
 * back byte-identical; the scan is READY or QUALIFIED with a typed
 * medication list, at least one answer claim cites a medication row of this
 * document (`medication.<n>.name`), and every citation in the answer and the
 * extraction has exactly the 5 keys.
 */
export function evaluateMedicationList({ upload, readbackSha256Matches, scan }) {
  const sourceId = upload?.data?.source_document?.id || null;
  const documentId = upload?.data?.openemr?.document_id ?? null;
  const workflow = scan?.data?.workflow || {};
  const answer = workflow.answer || null;
  const extraction = workflow.typed_outputs?.extraction || null;
  const citations = [...collectCitations(answer), ...collectCitations(extraction)];
  const invalidCitations = citations.filter((citation) => !citationHasExactKeys(citation)).length;
  const medicationClaims = (answer?.patient_facts || []).filter((claim) => (claim?.citations || []).some((citation) => citation?.source_type === 'document' && citation.source_id === sourceId && MEDICATION_ROW_CITATION.test(citation.field_or_chunk_id || '')));
  const medicationRows = extraction?.medication_list?.medications?.length ?? 0;
  const pass = upload?.status === 200 && Number.isInteger(documentId) && Boolean(sourceId) && readbackSha256Matches === true
    && scan?.status === 200 && ['READY', 'QUALIFIED'].includes(workflow.final_state)
    && medicationRows > 0 && medicationClaims.length > 0 && citations.length > 0 && invalidCitations === 0;
  return { pass, evidence: { upload_status: upload?.status ?? null, document_id: documentId, readback_sha256_matches: readbackSha256Matches === true, scan_status: scan?.status ?? null, final_state: workflow.final_state ?? null, medication_rows: medicationRows, cited_medication_claims: medicationClaims.length, citations_checked: citations.length, invalid_citations: invalidCitations } };
}

/**
 * X-3 fail-loud: the intake bytes declared as `medication_list` are never
 * READY. Passes when the upload itself is refused as a type mismatch, the
 * scan is BLOCKED, or the scan is qualified with `doc_type_mismatch`.
 */
export function evaluateMislabeledMedicationList({ upload, scan }) {
  const uploadRefused = upload?.status === 400 && upload?.data?.error === 'SOURCE_DOCUMENT_TYPE_MISMATCH';
  const finalState = scan?.data?.final_state || scan?.data?.workflow?.final_state || null;
  const reasons = scan?.data?.workflow?.qualification?.reasons || [];
  const scanRefused = finalState === 'BLOCKED' || (finalState !== null && finalState !== 'READY' && reasons.includes('doc_type_mismatch'));
  return { pass: uploadRefused || (Boolean(scan) && scanRefused), evidence: { upload_status: upload?.status ?? null, upload_error: upload?.data?.error ?? null, stored_document_type: upload?.data?.source_document?.document_type ?? null, scan_status: scan?.status ?? null, final_state: finalState, reasons_include_doc_type_mismatch: reasons.includes('doc_type_mismatch') } };
}

/**
 * X-4 lab trend from `GET /v1/patients/:patient/lab-trends` (labTrend.js):
 * read back through the OpenEMR module's FHIR Observation read path; for A1C
 * and Hemoglobin, a series with >= 2 points; in every series of those tests,
 * points in date order, each with a 5-key document citation to its own
 * OpenEMR source document; and every uploaded lab document (lab-a, lab-c)
 * appears among each test's points.
 */
export function evaluateLabTrends({ status, trends, uploadedSourceIds = [] }) {
  const tests = Array.isArray(trends?.tests) ? trends.tests : [];
  const perTest = {};
  const failures = [];
  for (const [label, code] of Object.entries(LAB_TREND_CODES)) {
    const series = tests.filter((test) => test?.loinc_code === code);
    const points = series.flatMap((test) => test.points || []);
    const ordered = series.every((test) => (test.points || []).every((point, index, all) => index === 0 || String(all[index - 1].collection_date) <= String(point.collection_date)));
    const cited = points.every((point) => citationHasExactKeys(point?.citation) && point.citation.source_type === 'document' && point.citation.source_id === point.source_document_id && /^openemr-doc-\d+$/.test(point.source_document_id || ''));
    const sources = new Set(points.map((point) => point?.source_document_id));
    const uploadsPresent = uploadedSourceIds.length > 0 && uploadedSourceIds.every((id) => sources.has(id));
    const maxPoints = Math.max(0, ...series.map((test) => (test.points || []).length));
    perTest[label] = { series: series.length, max_points: maxPoints, total_points: points.length, date_ordered: ordered, citations_valid: cited, uploads_present: uploadsPresent };
    if (!series.length) failures.push(`${label}:no_series`);
    if (maxPoints < 2) failures.push(`${label}:fewer_than_2_points`);
    if (!ordered) failures.push(`${label}:not_date_ordered`);
    if (!cited) failures.push(`${label}:invalid_point_citation`);
    if (!uploadsPresent) failures.push(`${label}:uploaded_document_missing`);
  }
  const boundaryOk = trends?.persistence_boundary === OPENEMR_LAB_BOUNDARY;
  const readPathOk = trends?.read_path === OPENEMR_LAB_READ_PATH;
  if (!boundaryOk) failures.push('not_openemr_module_boundary');
  if (!readPathOk) failures.push('not_openemr_fhir_read_path');
  const pass = status === 200 && trends?.status === 'read' && failures.length === 0;
  return { pass, evidence: { status, trend_status: trends?.status ?? null, persistence_boundary: trends?.persistence_boundary ?? null, read_path: trends?.read_path ?? null, missing_observation_count: trends?.missing_observation_count ?? null, tests: perTest, failures } };
}

/**
 * E8 chart-fact label: on the public demo (synthetic-demo tokens, the
 * FixtureAdapter), every chart-fact citation in the answer is
 * `synthetic_chart_fixture` -- never `openemr_record` -- there is at least
 * one, and the response's `chart_source` says `synthetic_fixture`.
 */
export function evaluateChartFactLabels({ scanStatus, scanData }) {
  const answer = scanData?.workflow?.answer || null;
  const chartCitations = collectCitations(answer).filter((citation) => Object.values(CHART_FACT_SOURCE_TYPES).includes(citation.source_type));
  const openemrLabeled = chartCitations.filter((citation) => citation.source_type === CHART_FACT_SOURCE_TYPES.openemr).length;
  const chartSource = scanData?.chart_source?.chart_source ?? null;
  const pass = scanStatus === 200 && chartCitations.length > 0 && chartCitations.every((citation) => citation.source_type === CHART_FACT_SOURCE_TYPES.fixture) && chartSource === 'synthetic_fixture';
  return { pass, evidence: { status: scanStatus, chart_fact_citations: chartCitations.length, openemr_record_labeled: openemrLabeled, chart_source: chartSource } };
}

/**
 * E8 scope: a follow-up-evidence question naming another fixture patient is
 * refused as `out_of_scope_patient` (server.js answers a blocked follow-up
 * with 403 `{error}`; a 200 `disposition: 'blocked'` body is also accepted)
 * and discloses nothing: no claims, facts or evidence, and no patient ref.
 */
export function evaluateOutOfScopeRefusal({ status, data }) {
  const body = data && typeof data === 'object' ? data : {};
  const refused = (status === 403 && body.error === 'out_of_scope_patient') || (status === 200 && body.disposition === 'blocked' && (body.reason === 'out_of_scope_patient' || body.error === 'out_of_scope_patient'));
  const disclosingKeys = ['claims', 'patient_facts', 'evidence', 'patient', 'text', 'answer'].filter((key) => key in body && !(Array.isArray(body[key]) && body[key].length === 0));
  const namesPatient = FIXTURE_PATIENT_REF.test(JSON.stringify(body));
  return { pass: refused && disclosingKeys.length === 0 && !namesPatient, evidence: { status, error: body.error ?? null, disposition: body.disposition ?? null, disclosing_keys: disclosingKeys, names_a_patient_ref: namesPatient } };
}

/** E8 badge: every `#chart-source` badge on the public page is the synthetic fixture (value and visible text), and there is one. */
export function evaluateChartSourceBadge({ status, html }) {
  const badges = [...String(html || '').matchAll(/<span class="badge" id="chart-source" data-chart-source="([^"]*)">([^<]*)<\/span>/g)].map((match) => ({ value: match[1], text: match[2].trim() }));
  const pass = status === 200 && badges.length === 1 && badges.every((badge) => badge.value === 'synthetic_fixture' && badge.text === 'Chart source: synthetic fixture');
  return { pass, evidence: { status, badges: badges.length, chart_source_values: badges.map((badge) => badge.value) } };
}

/** `/v1/alerts`: exactly one `p95_latency` rule and its threshold is 30000 ms. */
export function evaluateP95Alert({ status, data }) {
  const rules = (data?.rules || []).filter((rule) => rule?.id === 'p95_latency');
  const pass = status === 200 && rules.length === 1 && rules.every((rule) => rule.threshold === EXPECTED_P95_THRESHOLD_MS);
  return { pass, evidence: { status, p95_rules: rules.length, threshold_ms: rules[0]?.threshold ?? null, observed_ms: rules[0]?.observed ?? null, triggered: rules[0]?.triggered ?? null } };
}

/** `/dashboard/health`: the dashboard reports the same freeze SHA as W2. */
export function evaluateDashboardSha({ status, data, expectedSha }) {
  const observed = data?.git_sha ?? null;
  return { pass: status === 200 && Boolean(expectedSha) && observed === expectedSha, evidence: { status, observed_sha: observed, expected_sha: expectedSha } };
}

/** Planned requirement ids with no ledger row: each becomes a FAIL row, so a check that never ran can never pass by omission. */
export function missingPlannedRows(results, plannedIds) {
  const recorded = new Set(results.map((result) => result.id));
  return plannedIds.filter((id) => !recorded.has(id));
}

const escapeCell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Render the acceptance-run results as the markdown ledger table PLAN.md's
 * "Acceptance evidence ledger" section describes, suitable for pasting (or
 * writing via `--ledger`) into `docs/agentforge/evidence/LEDGER.md`. */
export function buildLedgerMarkdown(results, { sha, timestamp }) {
  const header = '| requirement id | check | PASS/FAIL | evidence | SHA | timestamp |\n|---|---|---|---|---|---|';
  const rows = results.map((result) => `| ${escapeCell(result.id)} | ${escapeCell(result.check)} | ${result.pass ? 'PASS' : 'FAIL'} | ${escapeCell(JSON.stringify(result.evidence))} | ${sha} | ${timestamp} |`);
  return [header, ...rows].join('\n') + '\n';
}

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

// ---------------------------------------------------------------------------
// Network-touching run. Nothing above this line is ever exercised by a test
// with a live URL; nothing below this line is ever called by a test.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--sha' || argv[i] === '--expect-sha') args.sha = argv[++i];
    else if (argv[i] === '--ledger') args.ledger = argv[++i];
    else if (argv[i] === '--dashboard-url') args.dashboardUrl = argv[++i];
  }
  return args;
}

// The full plan of requirement ids + human descriptions. Every id must end
// the run with a ledger row: when the SHA gate fails every remaining check is
// failed loudly ("evidence is only valid for the SHA it names", AGENTS.md),
// and `finish()` fails any planned id that never recorded a row.
export const PLANNED_CHECKS = [
  ['W2-SHA', '/health git_sha matches AGENTFORGE_EXPECT_SHA'],
  ['W2-DASHBOARD-SHA', '/dashboard/health git_sha matches AGENTFORGE_EXPECT_SHA (both services deployed from one SHA)'],
  ['W2-C1', 'upload filled-lab-a.pdf, receive an OpenEMR document_id'],
  ['W2-C1-READBACK', 'GET the stored lab document; sha256 matches the local file'],
  ['W2-C2', 'duplicate lab-a re-upload returns the same document_id'],
  ['W2-C11', 'scan-supervisor on the lab document reaches READY with a non-empty grounded answer'],
  ['W2-C6', 'decisions include EXTRACT -> RETRIEVE -> ANSWER in order'],
  ['W2-C4', 'retrieval provider is a real hybrid pipeline, not degraded'],
  ['W2-C7', 'every citation in the answer and typed facts has exactly the 5 required keys'],
  ['W2-C8', 'GET the page PNG for the lab document returns image/png'],
  ['W2-C10', 'the matched w2-scan-supervisor trace carries handoffs/decisions/stage durations/model totals/retrieval hit_count/extraction confidence'],
  ['W2-INTAKE-C1', 'upload filled-intake-a.pdf, receive an OpenEMR document_id; sha256 readback matches'],
  ['W2-INTAKE-NO-PHI', 'no raw demographic value from the truth fixture appears in a patient_fact claim'],
  ['W2-SF-WRONGTYPE', 'the intake bytes mislabeled as lab_pdf are refused, never READY'],
  ['W2-SF-CROSSPATIENT', "a cross-patient scan of patient-001's document under patient-002's context is refused (403)"],
  ['W2-SF-LEGACYTEXT', 'a legacy LAB| text upload is rejected (400, unsupported_upload_format)'],
  ['W2-SF-LEGACYSUPERVISOR', 'the retired POST /v1/supervisor route returns 404'],
  ['X-1', 'lab-a /source-preview: every "View source region" link targets an existing source-box, page image present and served as image/png'],
  ['X-2', "lab-a scan answer critic_status reviewed; CRITIQUE decision and critic-worker handoff in the workflow and the trace; critic duration recorded"],
  ['X-3', 'upload filled-medlist-a.pdf as medication_list: OpenEMR document_id, sha256 readback, READY/QUALIFIED with >= 1 cited medication, 5-key citations'],
  ['X-3-MISLABEL', 'the intake bytes declared as medication_list are never READY'],
  ['X-4', 'after lab-a and lab-c, lab-trends read back from OpenEMR: >= 2 points for A1C and Hemoglobin, date order, each point cites its own source document'],
  ['E8-CHART-LABEL', 'every chart-fact citation in the lab-a answer is synthetic_chart_fixture, never openemr_record'],
  ['E8-SCOPE', 'a follow-up-evidence question naming another fixture patient is refused (out_of_scope_patient) with no disclosure'],
  ['E8-BADGE', 'the public page chart-source badge says "synthetic fixture"'],
  ['W2-ALERT-P95', '/v1/alerts p95_latency threshold is 30000 ms'],
];
export const PLANNED_IDS = PLANNED_CHECKS.map(([id]) => id);
const checkName = (id) => PLANNED_CHECKS.find(([planned]) => planned === id)?.[1] || id;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.base || process.env.AGENTFORGE_LIVE_URL || '').replace(/\/$/, '');
  const expectedSha = args.sha || process.env.AGENTFORGE_EXPECT_SHA || '';
  const ledgerPath = args.ledger || null;
  const dashboardUrlInput = args.dashboardUrl || process.env.AGENTFORGE_DASHBOARD_URL || '';

  if (!base) { console.error('AGENTFORGE_LIVE_URL (or --base) is required, e.g. https://dtstest.64.177.10.182.nip.io/agentforge-w2'); process.exitCode = 2; return; }
  if (!expectedSha) { console.error('AGENTFORGE_EXPECT_SHA (or --sha) is required -- evidence is only valid for the SHA it names.'); process.exitCode = 2; return; }

  const results = [];
  const timestamp = new Date().toISOString();
  const record = (id, check, pass, evidence = {}) => {
    results.push({ id, check, pass, evidence });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} — ${check} ${JSON.stringify(evidence)}`);
  };

  // The context mints need the evaluator access key (W3); sent on every GET, ignored elsewhere.
  const mintHeaders = process.env.AGENTFORGE_DEMO_ACCESS_KEY ? { 'x-agentforge-demo-key': process.env.AGENTFORGE_DEMO_ACCESS_KEY } : {};
  const getJson = async (path) => { const response = await fetch(`${base}${path}`, { headers: mintHeaders }); let data = null; try { data = await response.json(); } catch { /* non-JSON or empty */ } return { status: response.status, data }; };
  const postJson = async (path, body) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let data = null; try { data = await response.json(); } catch { /* non-JSON or empty */ } return { status: response.status, data }; };
  const writeContextFor = async (patient) => (await getJson(`/v1/source-document-context?patient_uuid=${encodeURIComponent(patient)}`)).data?.demo_token;
  // The read-scoped token the public UI keeps as `state.demoToken` (ui.js) for the source preview and lab trends.
  const readContextFor = async (patient) => (await getJson(`/v1/demo-context?patient_uuid=${encodeURIComponent(patient)}`)).data?.demo_token;
  const getText = async (url) => { const response = await fetch(url); return { status: response.status, contentType: response.headers.get('content-type'), text: await response.text() }; };
  const errorEvidence = (error) => ({ error: error?.code || error?.message || 'unknown_error' });
  // Run one block of checks; if it throws, every id in `ids` it did not record fails with the error code.
  const guarded = async (ids, block) => {
    try { await block(); } catch (error) {
      for (const id of ids) if (!results.some((result) => result.id === id)) record(id, checkName(id), false, errorEvidence(error));
    }
  };
  const readbackMatches = async (sourceId, expectedSha256) => {
    const token = await writeContextFor(PATIENT);
    const stored = await getJson(`/v1/source-documents/${encodeURIComponent(sourceId)}?patient_uuid=${PATIENT}&demo_token=${encodeURIComponent(token)}`);
    return stored.status === 200 && Boolean(stored.data?.content_base64) && sha256Hex(Buffer.from(stored.data.content_base64, 'base64')) === expectedSha256;
  };
  const uploadPdf = async (filename, documentType) => {
    const token = await writeContextFor(PATIENT);
    const bytes = readFileSync(`${SAMPLES_DIR}${filename}`);
    const upload = await postJson('/v1/source-documents', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: token, document_type: documentType, filename, content_base64: bytes.toString('base64') });
    return { upload, sha256: sha256Hex(bytes), sourceId: upload.data?.source_document?.id || null };
  };
  const scanDocument = async (sourceId) => postJson('/v1/scan-supervisor', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: await writeContextFor(PATIENT), source_document_id: sourceId, message: SCAN_MESSAGE });

  function finish() {
    for (const id of missingPlannedRows(results, PLANNED_IDS)) record(id, checkName(id), false, { missing_row: 'check_never_recorded' });
    const failed = results.filter((result) => !result.pass).length;
    const output = { schema_version: 'agentforge-w2-live-acceptance-v1', synthetic_only: true, base_url: base, expected_sha: expectedSha, timestamp, checks: results, summary: { total: results.length, passed: results.length - failed, failed } };
    console.log(JSON.stringify(output, null, 2));
    if (ledgerPath) {
      mkdirSync(dirname(ledgerPath), { recursive: true });
      writeFileSync(ledgerPath, buildLedgerMarkdown(results, { sha: expectedSha, timestamp }));
      console.log(`Ledger written to ${ledgerPath}`);
    }
    process.exitCode = failed ? 1 : 0;
  }

  // 1. Health / SHA gate -- fail everything else if this fails.
  let health;
  try { health = await getJson('/health'); } catch (error) { health = { status: 0, data: null, error: String(error?.message || error) }; }
  const observedSha = health.data?.git_sha || null;
  const shaOk = health.status === 200 && Boolean(observedSha) && observedSha === expectedSha;
  record('W2-SHA', '/health git_sha matches AGENTFORGE_EXPECT_SHA', shaOk, { status: health.status, observed_sha: observedSha, expected_sha: expectedSha });

  // E7: the dashboard is deployed from the same freeze SHA; checked even if
  // the W2 gate fails, so the ledger shows both.
  await guarded(['W2-DASHBOARD-SHA'], async () => {
    const dashboardUrl = (dashboardUrlInput || `${new URL(base).origin}/dashboard`).replace(/\/$/, '');
    const response = await fetch(`${dashboardUrl}/health`);
    let data = null; try { data = await response.json(); } catch { /* non-JSON */ }
    const { pass, evidence } = evaluateDashboardSha({ status: response.status, data, expectedSha });
    record('W2-DASHBOARD-SHA', checkName('W2-DASHBOARD-SHA'), pass, evidence);
  });

  if (!shaOk) {
    for (const [id, check] of PLANNED_CHECKS) if (!results.some((result) => result.id === id)) record(id, check, false, { skipped: 'health_sha_gate_failed' });
    return finish();
  }

  // 2/3. W2-C1/C2: upload the golden lab PDF, read it back, re-upload it.
  let labSourceId = null;
  let labDocumentId = null;
  try {
    const writeToken = await writeContextFor(PATIENT);
    const labBytes = readFileSync(`${SAMPLES_DIR}filled-lab-a.pdf`);
    const labBytesSha256 = sha256Hex(labBytes);
    const uploadOnce = () => postJson('/v1/source-documents', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: writeToken, document_type: 'lab_pdf', filename: 'filled-lab-a.pdf', content_base64: labBytes.toString('base64') });

    const firstUpload = await uploadOnce();
    labSourceId = firstUpload.data?.source_document?.id || null;
    labDocumentId = firstUpload.data?.openemr?.document_id ?? null;
    record('W2-C1', 'upload filled-lab-a.pdf, receive an OpenEMR document_id', firstUpload.status === 200 && Number.isInteger(labDocumentId) && Boolean(labSourceId), { status: firstUpload.status, document_id: labDocumentId, error: firstUpload.data?.error });

    if (labSourceId) {
      const readToken = await writeContextFor(PATIENT);
      const stored = await getJson(`/v1/source-documents/${encodeURIComponent(labSourceId)}?patient_uuid=${PATIENT}&demo_token=${encodeURIComponent(readToken)}`);
      const storedSha256 = stored.data?.content_base64 ? sha256Hex(Buffer.from(stored.data.content_base64, 'base64')) : null;
      record('W2-C1-READBACK', 'GET the stored lab document; sha256 matches the local file', stored.status === 200 && storedSha256 === labBytesSha256, { status: stored.status, sha256_matches: storedSha256 === labBytesSha256 });

      const secondUpload = await uploadOnce();
      const secondDocumentId = secondUpload.data?.openemr?.document_id ?? null;
      record('W2-C2', 'duplicate lab-a re-upload returns the same document_id', secondUpload.status === 200 && secondUpload.data?.duplicate === true && secondDocumentId === labDocumentId, { status: secondUpload.status, duplicate: secondUpload.data?.duplicate, document_id: secondDocumentId, matches_first_upload: secondDocumentId === labDocumentId });
    } else {
      record('W2-C1-READBACK', 'GET the stored lab document; sha256 matches the local file', false, { skipped: 'no_source_document_id' });
      record('W2-C2', 'duplicate lab-a re-upload returns the same document_id', false, { skipped: 'no_source_document_id' });
    }
  } catch (error) {
    record('W2-C1', 'upload filled-lab-a.pdf, receive an OpenEMR document_id', false, { error: error?.code || error?.message || 'unknown_error' });
    record('W2-C1-READBACK', 'GET the stored lab document; sha256 matches the local file', false, { skipped: 'upload_failed' });
    record('W2-C2', 'duplicate lab-a re-upload returns the same document_id', false, { skipped: 'upload_failed' });
  }

  // 4-8. W2-C4/C6/C7/C8/C10/C11: scan-supervisor on the lab document.
  let labScanTrace = null;
  let labScan = null;
  if (labSourceId) {
    try {
      const scanToken = await writeContextFor(PATIENT);
      const before = await getJson('/v1/traces');
      const beforeCorrelationIds = new Set((before.data || []).filter((trace) => trace.operation === SCAN_SUPERVISOR_OPERATION).map((trace) => trace.correlationId));

      const scan = await postJson('/v1/scan-supervisor', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: scanToken, source_document_id: labSourceId, message: SCAN_MESSAGE });
      labScan = scan;
      const workflow = scan.data?.workflow || {};
      const answer = workflow.answer || null;
      const evidence = workflow.typed_outputs?.evidence || {};

      const ready = scan.status === 200 && workflow.final_state === 'READY' && Boolean(answer) && (answer.patient_facts?.length || 0) > 0 && (answer.guideline_evidence?.length || 0) > 0 && scan.data?.openemr?.read_back?.verified === true;
      record('W2-C11', 'scan-supervisor on the lab document reaches READY with a non-empty grounded answer', ready, { status: scan.status, final_state: workflow.final_state, patient_facts_count: answer?.patient_facts?.length ?? 0, guideline_evidence_count: answer?.guideline_evidence?.length ?? 0, openemr_read_back_verified: scan.data?.openemr?.read_back?.verified ?? null });

      record('W2-C6', 'decisions include EXTRACT -> RETRIEVE -> ANSWER in order', decisionsIncludeOrder(workflow.decisions), { decision_sequence: (workflow.decisions || []).map((decision) => decision?.next) });

      const providerIsHybrid = typeof evidence.provider === 'string' && evidence.provider.startsWith('hybrid:') && !DEGRADED_RETRIEVAL_LABELS.has(evidence.degraded);
      record('W2-C4', 'retrieval provider is a real hybrid pipeline, not degraded', providerIsHybrid, { provider: evidence.provider ?? null, degraded: evidence.degraded ?? null });

      const citations = [...collectCitations(answer), ...collectCitations(workflow.typed_outputs?.extraction)];
      const badCitations = citations.filter((citation) => !citationHasExactKeys(citation));
      record('W2-C7', 'every citation in the answer and typed facts has exactly the 5 required keys', citations.length > 0 && badCitations.length === 0, { citations_checked: citations.length, invalid_citations: badCitations.length });

      let pngOk = false;
      let pngStatus = null;
      let pngContentType = null;
      try {
        const pageToken = await writeContextFor(PATIENT);
        const pageResponse = await fetch(`${base}/v1/source-documents/${encodeURIComponent(labSourceId)}/pages/1.png?patient_uuid=${PATIENT}&demo_token=${encodeURIComponent(pageToken)}`);
        pngStatus = pageResponse.status;
        pngContentType = pageResponse.headers.get('content-type');
        await pageResponse.arrayBuffer();
        pngOk = pngStatus === 200 && Boolean(pngContentType) && pngContentType.startsWith('image/png');
      } catch (error) { pngStatus = pngStatus ?? 0; }
      record('W2-C8', 'GET the page PNG for the lab document returns image/png', pngOk, { status: pngStatus, content_type: pngContentType });

      try {
        const after = await getJson('/v1/traces');
        labScanTrace = matchNewTrace(after.data, beforeCorrelationIds, { operation: SCAN_SUPERVISOR_OPERATION });
      } catch { /* handled by the null-trace branch below */ }

      const traceOk = Boolean(labScanTrace)
        && Array.isArray(labScanTrace.handoffs) && labScanTrace.handoffs.length > 0
        && Array.isArray(labScanTrace.decisions) && labScanTrace.decisions.length > 0
        && everyStageHasDuration(labScanTrace.stages)
        && typeof labScanTrace.modelTotals?.input_tokens === 'number'
        && typeof labScanTrace.modelTotals?.output_tokens === 'number'
        && labScanTrace.modelTotals?.cost_usd !== null && labScanTrace.modelTotals?.cost_usd !== undefined
        && retrievalHasHitCount(labScanTrace.retrieval)
        && typeof labScanTrace.extraction?.confidence?.mean === 'number';
      record('W2-C10', 'the matched w2-scan-supervisor trace carries handoffs/decisions/stage durations/model totals/retrieval hit_count/extraction confidence', traceOk, {
        trace_found: Boolean(labScanTrace),
        correlation_id: labScanTrace?.correlationId ?? null,
        handoffs_count: labScanTrace?.handoffs?.length ?? 0,
        decisions_count: labScanTrace?.decisions?.length ?? 0,
        stages_have_duration: everyStageHasDuration(labScanTrace?.stages),
        model_totals_tokens_present: typeof labScanTrace?.modelTotals?.input_tokens === 'number' && typeof labScanTrace?.modelTotals?.output_tokens === 'number',
        model_totals_cost_usd: labScanTrace?.modelTotals?.cost_usd ?? null,
        retrieval_hit_count_present: retrievalHasHitCount(labScanTrace?.retrieval),
        extraction_confidence_present: typeof labScanTrace?.extraction?.confidence?.mean === 'number',
        // Reported as-is, per the task: another change may make this real
        // (`not_run` today -- the golden-set gate evaluates separately from
        // any individual document workflow, service.js#runActiveSupervisorForDocument);
        // this script never fails on its status.
        evaluation_status: labScanTrace?.evaluation?.status ?? null,
      });
    } catch (error) {
      for (const [id, check] of [['W2-C11', 'scan-supervisor on the lab document reaches READY with a non-empty grounded answer'], ['W2-C6', 'decisions include EXTRACT -> RETRIEVE -> ANSWER in order'], ['W2-C4', 'retrieval provider is a real hybrid pipeline, not degraded'], ['W2-C7', 'every citation in the answer and typed facts has exactly the 5 required keys'], ['W2-C8', 'GET the page PNG for the lab document returns image/png'], ['W2-C10', 'the matched w2-scan-supervisor trace carries handoffs/decisions/stage durations/model totals/retrieval hit_count/extraction confidence']]) {
        record(id, check, false, { error: error?.code || error?.message || 'unknown_error' });
      }
    }
  } else {
    for (const [id, check] of [['W2-C11', 'scan-supervisor on the lab document reaches READY with a non-empty grounded answer'], ['W2-C6', 'decisions include EXTRACT -> RETRIEVE -> ANSWER in order'], ['W2-C4', 'retrieval provider is a real hybrid pipeline, not degraded'], ['W2-C7', 'every citation in the answer and typed facts has exactly the 5 required keys'], ['W2-C8', 'GET the page PNG for the lab document returns image/png'], ['W2-C10', 'the matched w2-scan-supervisor trace carries handoffs/decisions/stage durations/model totals/retrieval hit_count/extraction confidence']]) {
      record(id, check, false, { skipped: 'no_lab_source_document_id' });
    }
  }

  // E7 X-2 critic and E8 chart-fact label, on the same lab-a scan and trace.
  if (labScan) {
    const critic = evaluateCritic({ scanStatus: labScan.status, workflow: labScan.data?.workflow, trace: labScanTrace });
    record('X-2', checkName('X-2'), critic.pass, critic.evidence);
    const labels = evaluateChartFactLabels({ scanStatus: labScan.status, scanData: labScan.data });
    record('E8-CHART-LABEL', checkName('E8-CHART-LABEL'), labels.pass, labels.evidence);
  } else {
    for (const id of ['X-2', 'E8-CHART-LABEL']) record(id, checkName(id), false, { skipped: labSourceId ? 'lab_scan_failed' : 'no_lab_source_document_id' });
  }

  // E7 X-1 click-to-source: the lab-a source preview, fetched with the read
  // token exactly as the UI builds the "Open source preview" link; then every
  // page image it embeds must be served as image/png.
  if (labSourceId) {
    await guarded(['X-1'], async () => {
      const readToken = await readContextFor(PATIENT);
      const preview = await getText(`${base}/v1/source-documents/${encodeURIComponent(labSourceId)}/source-preview?patient_uuid=${encodeURIComponent(PATIENT)}&demo_token=${encodeURIComponent(readToken)}`);
      const result = evaluateSourcePreview({ status: preview.status, html: preview.text });
      let imagesPng = 0;
      for (const src of result.imageSrcs) {
        const image = await fetch(new URL(src, `${base}/`));
        await image.arrayBuffer();
        if (image.status === 200 && String(image.headers.get('content-type') || '').startsWith('image/png')) imagesPng += 1;
      }
      const pass = result.pass && imagesPng === result.imageSrcs.length;
      record('X-1', checkName('X-1'), pass, { ...result.evidence, page_images_png: imagesPng });
    });
  } else {
    record('X-1', checkName('X-1'), false, { skipped: 'no_lab_source_document_id' });
  }

  // 9. Intake: upload, read back, and check for a demographics leak against
  // the golden truth fixture (never printing the truth values themselves).
  let intakeSourceId = null;
  try {
    const writeToken = await writeContextFor(PATIENT);
    const intakeBytes = readFileSync(`${SAMPLES_DIR}filled-intake-a.pdf`);
    const intakeBytesSha256 = sha256Hex(intakeBytes);
    const upload = await postJson('/v1/source-documents', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: writeToken, document_type: 'intake_form', filename: 'filled-intake-a.pdf', content_base64: intakeBytes.toString('base64') });
    intakeSourceId = upload.data?.source_document?.id || null;
    const intakeDocumentId = upload.data?.openemr?.document_id ?? null;

    let readbackOk = false;
    if (intakeSourceId) {
      const readToken = await writeContextFor(PATIENT);
      const stored = await getJson(`/v1/source-documents/${encodeURIComponent(intakeSourceId)}?patient_uuid=${PATIENT}&demo_token=${encodeURIComponent(readToken)}`);
      const storedSha256 = stored.data?.content_base64 ? sha256Hex(Buffer.from(stored.data.content_base64, 'base64')) : null;
      readbackOk = stored.status === 200 && storedSha256 === intakeBytesSha256;
    }
    record('W2-INTAKE-C1', 'upload filled-intake-a.pdf, receive an OpenEMR document_id; sha256 readback matches', upload.status === 200 && Number.isInteger(intakeDocumentId) && Boolean(intakeSourceId) && readbackOk, { status: upload.status, document_id: intakeDocumentId, readback_sha256_matches: readbackOk, error: upload.data?.error });

    if (intakeSourceId) {
      const scanToken = await writeContextFor(PATIENT);
      const scan = await postJson('/v1/scan-supervisor', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: scanToken, source_document_id: intakeSourceId, message: SCAN_MESSAGE });
      const answer = scan.data?.workflow?.answer || null;
      const truth = JSON.parse(readFileSync(`${TRUTH_DIR}intake-a.json`, 'utf8'));
      const demographics = { name: truth.intake_form?.name, dob: truth.intake_form?.dob, phone: truth.intake_form?.phone };
      const leaked = findDemographicsLeak(answer?.patient_facts, demographics);
      record('W2-INTAKE-NO-PHI', 'no raw demographic value from the truth fixture appears in a patient_fact claim', scan.status === 200 && leaked.length === 0, { status: scan.status, leaked_fields: leaked, patient_fact_claims_checked: (answer?.patient_facts || []).length });
    } else {
      record('W2-INTAKE-NO-PHI', 'no raw demographic value from the truth fixture appears in a patient_fact claim', false, { skipped: 'no_intake_source_document_id' });
    }
  } catch (error) {
    record('W2-INTAKE-C1', 'upload filled-intake-a.pdf, receive an OpenEMR document_id; sha256 readback matches', false, { error: error?.code || error?.message || 'unknown_error' });
    record('W2-INTAKE-NO-PHI', 'no raw demographic value from the truth fixture appears in a patient_fact claim', false, { skipped: 'upload_failed' });
  }

  // 10. Fail-loud: a wrong-type document must never reach READY.
  try {
    const writeToken = await writeContextFor(PATIENT);
    const intakeBytes = readFileSync(`${SAMPLES_DIR}filled-intake-a.pdf`);
    const upload = await postJson('/v1/source-documents', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: writeToken, document_type: 'lab_pdf', filename: 'filled-intake-a.pdf', content_base64: intakeBytes.toString('base64') });
    const wrongTypeSourceId = upload.data?.source_document?.id || null;
    if (wrongTypeSourceId) {
      const scanToken = await writeContextFor(PATIENT);
      const scan = await postJson('/v1/scan-supervisor', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: scanToken, source_document_id: wrongTypeSourceId, message: SCAN_MESSAGE });
      const finalState = scan.data?.final_state || scan.data?.workflow?.final_state || null;
      const reasons = scan.data?.workflow?.qualification?.reasons || [];
      record('W2-SF-WRONGTYPE', 'the intake bytes mislabeled as lab_pdf are refused, never READY', finalState !== null && finalState !== 'READY', { upload_status: upload.status, scan_status: scan.status, final_state: finalState, reasons_include_doc_type_mismatch: reasons.includes('doc_type_mismatch') });
    } else {
      record('W2-SF-WRONGTYPE', 'the intake bytes mislabeled as lab_pdf are refused, never READY', false, { upload_status: upload.status, error: upload.data?.error });
    }
  } catch (error) {
    record('W2-SF-WRONGTYPE', 'the intake bytes mislabeled as lab_pdf are refused, never READY', false, { error: error?.code || error?.message || 'unknown_error' });
  }

  // 11. Fail-loud: a cross-patient read/scan must be refused. Reuses the
  // approach `w2RegressionGate.js#sr-06-cross-patient-read` and
  // `test/fail-loud.test.js` verify: a token correctly scoped to
  // OTHER_PATIENT, used against a document that belongs to PATIENT, must hit
  // `document_scope_mismatch` (403) -- never a write, since OTHER_PATIENT
  // never uploads anything.
  try {
    if (labSourceId) {
      const otherToken = await writeContextFor(OTHER_PATIENT);
      const crossPatient = await postJson('/v1/scan-supervisor', { patient_uuid: OTHER_PATIENT, clinician_uuid: CLINICIAN, demo_token: otherToken, source_document_id: labSourceId, message: SCAN_MESSAGE });
      record('W2-SF-CROSSPATIENT', "a cross-patient scan of patient-001's document under patient-002's context is refused (403)", crossPatient.status === 403 && CROSS_PATIENT_REFUSALS.has(crossPatient.data?.error), { status: crossPatient.status, error: crossPatient.data?.error, refused_by: crossPatient.data?.error === 'document_scope_mismatch' ? 'document_scope_check' : 'patient_allowlist' });
    } else {
      record('W2-SF-CROSSPATIENT', "a cross-patient scan of patient-001's document under patient-002's context is refused (403)", false, { skipped: 'no_lab_source_document_id' });
    }
  } catch (error) {
    record('W2-SF-CROSSPATIENT', "a cross-patient scan of patient-001's document under patient-002's context is refused (403)", false, { error: error?.code || error?.message || 'unknown_error' });
  }

  // E7 X-3 medication_list (E4): a real upload for the seeded patient, read
  // back, scanned; then the intake bytes declared as medication_list.
  await guarded(['X-3'], async () => {
    const { upload, sha256, sourceId } = await uploadPdf('filled-medlist-a.pdf', 'medication_list');
    const readback = sourceId ? await readbackMatches(sourceId, sha256) : false;
    const scan = sourceId ? await scanDocument(sourceId) : null;
    const result = evaluateMedicationList({ upload, readbackSha256Matches: readback, scan });
    record('X-3', checkName('X-3'), result.pass, result.evidence);
  });
  await guarded(['X-3-MISLABEL'], async () => {
    const { upload, sourceId } = await uploadPdf('filled-intake-a.pdf', 'medication_list');
    const scan = sourceId ? await scanDocument(sourceId) : null;
    const result = evaluateMislabeledMedicationList({ upload, scan });
    record('X-3-MISLABEL', checkName('X-3-MISLABEL'), result.pass, result.evidence);
  });

  // E7 X-4 lab trend (E5): lab-c (an earlier collection) is uploaded and
  // scanned after lab-a; the scan writes its lab rows through the module.
  // Then the trend route is read back with the read token, as the UI does.
  await guarded(['X-4'], async () => {
    const { upload, sourceId: labCSourceId } = await uploadPdf('filled-lab-c.pdf', 'lab_pdf');
    const scan = labCSourceId ? await scanDocument(labCSourceId) : null;
    const readToken = await readContextFor(PATIENT);
    const trends = await getJson(`/v1/patients/${encodeURIComponent(PATIENT)}/lab-trends?demo_token=${encodeURIComponent(readToken)}`);
    const uploadedSourceIds = [labSourceId, labCSourceId].filter(Boolean);
    const result = evaluateLabTrends({ status: trends.status, trends: trends.data, uploadedSourceIds });
    const labCWritten = scan?.status === 200 && scan.data?.openemr?.read_back?.verified === true;
    record('X-4', checkName('X-4'), result.pass && uploadedSourceIds.length === 2 && labCWritten, { ...result.evidence, lab_c_upload_status: upload.status, lab_c_scan_status: scan?.status ?? null, lab_c_final_state: scan?.data?.workflow?.final_state ?? null, lab_c_openemr_read_back_verified: scan?.data?.openemr?.read_back?.verified ?? null, uploaded_documents: uploadedSourceIds.length });
  });

  // E7 E8: another patient named in a follow-up question is refused; the
  // public page's chart-source badge; the p95 alert threshold.
  await guarded(['E8-SCOPE'], async () => {
    const readToken = await readContextFor(PATIENT);
    const followUp = await postJson('/v1/follow-up-evidence', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: readToken, message: `What medications is ${OTHER_PATIENT} on?` });
    const result = evaluateOutOfScopeRefusal(followUp);
    record('E8-SCOPE', checkName('E8-SCOPE'), result.pass, result.evidence);
  });
  await guarded(['E8-BADGE'], async () => {
    const page = await getText(`${base}/`);
    const result = evaluateChartSourceBadge({ status: page.status, html: page.text });
    record('E8-BADGE', checkName('E8-BADGE'), result.pass, result.evidence);
  });
  await guarded(['W2-ALERT-P95'], async () => {
    const result = evaluateP95Alert(await getJson('/v1/alerts'));
    record('W2-ALERT-P95', checkName('W2-ALERT-P95'), result.pass, result.evidence);
  });

  // 12. Legacy path: the retired plain-text LAB| format and the retired
  // /v1/supervisor route must both stay dead on the deployed service
  // (R2, GitLab issue #4 -- see `contracts.test.js` for the same assertion
  // against `validateSourceDocumentRequest` directly).
  try {
    const writeToken = await writeContextFor(PATIENT);
    const legacyBody = Buffer.from('LAB|test=Hemoglobin|value=13.2');
    const legacy = await postJson('/v1/source-documents', { patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: writeToken, document_type: 'lab_pdf', filename: 'legacy-lab.pdf', content_base64: legacyBody.toString('base64') });
    record('W2-SF-LEGACYTEXT', 'a legacy LAB| text upload is rejected (400, unsupported_upload_format)', legacy.status === 400 && (legacy.data?.issues || []).includes('unsupported_upload_format'), { status: legacy.status, issues: legacy.data?.issues || [] });
  } catch (error) {
    record('W2-SF-LEGACYTEXT', 'a legacy LAB| text upload is rejected (400, unsupported_upload_format)', false, { error: error?.code || error?.message || 'unknown_error' });
  }
  try {
    const legacySupervisor = await postJson('/v1/supervisor', {});
    record('W2-SF-LEGACYSUPERVISOR', 'the retired POST /v1/supervisor route returns 404', legacySupervisor.status === 404, { status: legacySupervisor.status });
  } catch (error) {
    record('W2-SF-LEGACYSUPERVISOR', 'the retired POST /v1/supervisor route returns 404', false, { error: error?.code || error?.message || 'unknown_error' });
  }

  return finish();
}

const CROSS_PATIENT_REFUSALS = new Set(['document_scope_mismatch', 'openemr_demo_patient_not_allowed']);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await main();
