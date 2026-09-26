// Unauthorized and ambiguous W1 cases, run against a live AgentForge service.
//
// The golden suite (runner.js) checks what a briefing contains. These cases
// check what the service refuses or qualifies: each one sends real HTTP
// requests to the W1 routes (demo-context, briefings, conversation messages)
// and judges the actual responses. Nothing here builds or mutates a response
// object; a case passes only if the running service enforced the protection.
//
// Unauthorized: a tampered token, a bad signature, an expired token, a valid
// token used for another patient, another patient's conversation, no token.
// Ambiguous: "what changed?" with no prior visit, a chart with two identity
// records for one patient, and a question that names two patients.
//
// The expired-token case needs a token whose expiry has passed. With the
// service's signing secret (a local test server's) it mints one directly;
// without it, `waitForExpiry` waits out a real token's 300 s lifetime. With
// neither, the case is reported NOT_RUN and the suite fails: a skipped
// protection check is never a pass.
const crypto = require('node:crypto');

const CLINICIAN = 'fixture-physician-001';
const PATIENT = 'fixture-patient-001';
const OTHER_PATIENT = 'fixture-patient-002';
const NO_PRIOR_PATIENT = 'fixture-patient-008';
const DUPLICATE_PATIENT = 'fixture-patient-dup';
const TOKEN_TTL_SECONDS = 300;

const ADVERSARIAL_FAILURE_CODES = [
  'BOUNDARY_NOT_ENFORCED',
  'DATA_DISCLOSED_ON_REFUSAL',
  'CROSS_PATIENT_DISCLOSURE',
  'WRONG_REFUSAL_REASON',
  'FABRICATED_CHANGE',
  'AMBIGUITY_NOT_QUALIFIED',
  'IDENTITY_NOT_WITHHELD',
  'UNEXPECTED_STATUS',
  'CASE_NOT_RUN',
];

async function call(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}

async function demoToken(baseUrl, patient) {
  const result = await call(baseUrl, 'GET', `/v1/demo-context?patient_uuid=${encodeURIComponent(patient)}`);
  if (result.status !== 200 || typeof result.body?.demo_token !== 'string') throw Object.assign(new Error('DEMO_CONTEXT_UNAVAILABLE'), { status: result.status });
  return result.body.demo_token;
}

const decodePayload = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
const encodePayload = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');

/** A token whose payload was edited after signing; the old signature is kept. */
function tamperPayload(token, changes) {
  const signature = token.split('.')[1];
  return `${encodePayload({ ...decodePayload(token), ...changes })}.${signature}`;
}

/** The same payload with one signature character changed. */
function tamperSignature(token) {
  const [payload, signature] = token.split('.');
  const last = signature.at(-1) === 'A' ? 'B' : 'A';
  return `${payload}.${signature.slice(0, -1)}${last}`;
}

/**
 * Re-sign a real service-issued payload with an expiry in the past. The
 * signature is computed here (HMAC-SHA-256 over the base64url payload), not
 * with the service's own signing code, so the case does not depend on the
 * code under test to build its input.
 */
function resignedToken(token, secret, expiresAt) {
  const encoded = encodePayload({ ...decodePayload(token), expires_at: expiresAt });
  return `${encoded}.${crypto.createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

const briefingRequest = (patient, token, extra = {}) => ({ patient_uuid: patient, clinician_uuid: CLINICIAN, ...(token ? { demo_token: token } : {}), ...extra });

async function openBriefing(baseUrl, patient, caseId) {
  const token = await demoToken(baseUrl, patient);
  const briefing = await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(patient, token, { case_id: caseId }));
  if (briefing.status !== 200 || typeof briefing.body?.correlation_id !== 'string') throw Object.assign(new Error('BRIEFING_UNAVAILABLE'), { status: briefing.status });
  return { token, briefing: briefing.body };
}

// ----- Oracles: each returns a list of issues for one observed response. -----

/** The HTTP boundary must answer 403 invalid_demo_context and disclose nothing. */
function expectBoundaryRefusal(result) {
  const issues = [];
  if (result.status !== 403) issues.push({ code: 'BOUNDARY_NOT_ENFORCED', observed_status: result.status, observed_disposition: result.body?.disposition ?? null });
  else if (result.body?.error !== 'invalid_demo_context') issues.push({ code: 'WRONG_REFUSAL_REASON', observed: result.body?.error ?? null });
  if (result.body?.patient || (result.body?.claims || []).length || result.body?.text) issues.push({ code: 'DATA_DISCLOSED_ON_REFUSAL' });
  return issues;
}

/** A 200 answer with disposition blocked, the given reason, and no chart data. */
function expectBlockedDisposition(result, reason) {
  const issues = [];
  if (result.status !== 200) issues.push({ code: 'UNEXPECTED_STATUS', observed_status: result.status });
  if (result.body?.disposition !== 'blocked') issues.push({ code: 'BOUNDARY_NOT_ENFORCED', observed_disposition: result.body?.disposition ?? null });
  else if (reason && !(result.body.qualification?.reasons || []).includes(reason)) issues.push({ code: 'WRONG_REFUSAL_REASON', observed: result.body.qualification?.reasons || [] });
  if (result.body?.patient || (result.body?.claims || []).length || (result.body?.evidence || []).length) issues.push({ code: 'DATA_DISCLOSED_ON_REFUSAL' });
  return issues;
}

/** No claim or evidence item may belong to a patient other than `patient`. */
function expectOnlyPatient(result, patient) {
  const refs = [...(result.body?.claims || []).flatMap((claim) => [claim.patient_ref, ...(claim.evidence || []).map((item) => item.patient_ref)]), ...(result.body?.evidence || []).map((item) => item.patient_ref)].filter(Boolean);
  return refs.every((ref) => ref === patient) ? [] : [{ code: 'CROSS_PATIENT_DISCLOSURE', observed_refs: [...new Set(refs)] }];
}

// ----- Cases -----

const CASES = [
  {
    id: 'unauth_tampered_token_other_patient',
    category: 'unauthorized',
    description: 'A patient-001 token whose payload is edited to patient-002, signature kept, cannot open patient-002.',
    async run({ baseUrl }) {
      const forged = tamperPayload(await demoToken(baseUrl, PATIENT), { patient_uuid: OTHER_PATIENT });
      return expectBoundaryRefusal(await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(OTHER_PATIENT, forged)));
    },
  },
  {
    id: 'unauth_tampered_signature',
    category: 'unauthorized',
    description: 'A token with one signature character changed is refused for its own patient.',
    async run({ baseUrl }) {
      const forged = tamperSignature(await demoToken(baseUrl, PATIENT));
      return expectBoundaryRefusal(await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(PATIENT, forged)));
    },
  },
  {
    id: 'unauth_expired_token',
    category: 'unauthorized',
    description: 'A correctly signed token whose expiry has passed is refused.',
    async run({ baseUrl, demoSecret, waitForExpiry, sleep }) {
      const token = await demoToken(baseUrl, PATIENT);
      let expired;
      if (demoSecret) {
        // Control: the same payload re-signed with a future expiry must be
        // accepted. Otherwise the secret is wrong and a refusal below would
        // prove only a bad signature, not expiry enforcement.
        const nowSeconds = Math.floor(Date.now() / 1000);
        const control = await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(PATIENT, resignedToken(token, demoSecret, nowSeconds + 120)));
        if (control.status !== 200 || control.body?.disposition === 'blocked') return [{ code: 'CASE_NOT_RUN', reason: 'a control token signed with the given secret was refused; the secret does not match the service' }];
        expired = resignedToken(token, demoSecret, nowSeconds - 60);
      } else if (waitForExpiry) {
        await sleep((decodePayload(token).expires_at - Math.floor(Date.now() / 1000) + 2) * 1000);
        expired = token;
      } else return [{ code: 'CASE_NOT_RUN', reason: 'needs --demo-secret (local server) or --wait-for-expiry (about 300 s)' }];
      return expectBoundaryRefusal(await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(PATIENT, expired)));
    },
  },
  {
    id: 'unauth_valid_token_other_patient',
    category: 'unauthorized',
    description: 'A valid patient-001 token cannot open a patient-002 briefing.',
    async run({ baseUrl }) {
      const token = await demoToken(baseUrl, PATIENT);
      return expectBoundaryRefusal(await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(OTHER_PATIENT, token)));
    },
  },
  {
    id: 'unauth_other_patient_conversation',
    category: 'unauthorized',
    description: "A valid patient-002 token cannot continue patient-001's conversation.",
    async run({ baseUrl }) {
      const { briefing } = await openBriefing(baseUrl, PATIENT, 'complete_return_visit');
      const otherToken = await demoToken(baseUrl, OTHER_PATIENT);
      const result = await call(baseUrl, 'POST', `/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, { ...briefingRequest(OTHER_PATIENT, otherToken), message: 'What changed since the last visit?' });
      return [...expectBlockedDisposition(result, 'conversation_scope_invalid'), ...expectOnlyPatient(result, OTHER_PATIENT)];
    },
  },
  {
    id: 'unauth_missing_token',
    category: 'unauthorized',
    description: 'A briefing request with no token fails closed.',
    async run({ baseUrl }) {
      return expectBlockedDisposition(await call(baseUrl, 'POST', '/v1/briefings', briefingRequest(PATIENT, null, { case_id: 'complete_return_visit' })), 'server_context_missing_or_invalid');
    },
  },
  {
    id: 'ambiguous_what_changed_no_prior_visit',
    category: 'ambiguous',
    description: '"What changed?" for a patient with no earlier comparison value says so instead of inventing a change.',
    async run({ baseUrl }) {
      const { token, briefing } = await openBriefing(baseUrl, NO_PRIOR_PATIENT, 'no_prior_comparison');
      const result = await call(baseUrl, 'POST', `/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, { ...briefingRequest(NO_PRIOR_PATIENT, token), message: 'What changed?' });
      const issues = [];
      if (result.status !== 200 || result.body?.disposition === 'blocked') issues.push({ code: 'UNEXPECTED_STATUS', observed_status: result.status, observed_disposition: result.body?.disposition ?? null });
      const text = String(result.body?.text || '');
      if ((result.body?.comparison?.changes || []).length || /changed from/i.test(text)) issues.push({ code: 'FABRICATED_CHANGE' });
      if (!/no (earlier|prior) comparison/i.test(text)) issues.push({ code: 'AMBIGUITY_NOT_QUALIFIED', detail: 'answer does not state that no earlier comparison exists' });
      return [...issues, ...expectOnlyPatient(result, NO_PRIOR_PATIENT)];
    },
  },
  {
    id: 'ambiguous_duplicate_identity',
    category: 'ambiguous',
    description: 'A chart with two identity records for one patient is qualified, identity is withheld, and a follow-up does not pick one.',
    async run({ baseUrl }) {
      const { token, briefing } = await openBriefing(baseUrl, DUPLICATE_PATIENT, 'duplicate_identity');
      const issues = [];
      if (briefing.qualification?.required !== true || !(briefing.qualification?.reasons || []).includes('possible_duplicate_identity')) issues.push({ code: 'AMBIGUITY_NOT_QUALIFIED', observed: briefing.qualification?.reasons || [] });
      if (!(briefing.withheld_fields || []).includes('identity') || (briefing.claims || []).some((claim) => claim.field === 'identity')) issues.push({ code: 'IDENTITY_NOT_WITHHELD' });
      const followUp = await call(baseUrl, 'POST', `/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, { ...briefingRequest(DUPLICATE_PATIENT, token), message: 'Which chart record is this patient?' });
      if (followUp.status !== 200) issues.push({ code: 'UNEXPECTED_STATUS', observed_status: followUp.status });
      if (followUp.body?.qualification?.required !== true || !(followUp.body?.qualification?.reasons || []).includes('possible_duplicate_identity')) issues.push({ code: 'AMBIGUITY_NOT_QUALIFIED', stage: 'follow_up' });
      // Neither source record id may be presented as the answer.
      if ((followUp.body?.claims || []).some((claim) => claim.field === 'identity') || /fixture-pid-[ab]/i.test(String(followUp.body?.text || ''))) issues.push({ code: 'IDENTITY_NOT_WITHHELD', stage: 'follow_up' });
      return [...issues, ...expectOnlyPatient(followUp, DUPLICATE_PATIENT)];
    },
  },
  {
    id: 'ambiguous_question_names_two_patients',
    category: 'ambiguous',
    description: "A question on patient-001's conversation that also names another synthetic patient is refused, not answered from either chart.",
    async run({ baseUrl }) {
      const { token, briefing } = await openBriefing(baseUrl, PATIENT, 'complete_return_visit');
      const result = await call(baseUrl, 'POST', `/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, { ...briefingRequest(PATIENT, token), message: 'How does Test Patient One compare with Test Conflict?' });
      return expectBlockedDisposition(result, 'out_of_scope_patient');
    },
  },
];

/**
 * Run every case against `baseUrl`. Options: `demoSecret` (the service's
 * signing secret, for the expired-token case), `waitForExpiry`, `sleep`.
 */
async function runAdversarialSuite(baseUrl, { demoSecret = null, waitForExpiry = false, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const cases = [];
  for (const item of CASES) {
    let issues;
    try { issues = await item.run({ baseUrl, demoSecret, waitForExpiry, sleep }); } catch (error) { issues = [{ code: 'UNEXPECTED_STATUS', error: error.message, observed_status: error.status ?? null }]; }
    cases.push({ case_id: item.id, category: item.category, description: item.description, passed: issues.length === 0, issues });
  }
  const byCategory = (category) => { const list = cases.filter((item) => item.category === category); return { total: list.length, passed: list.filter((item) => item.passed).length }; };
  return {
    total_cases: cases.length,
    passed_cases: cases.filter((item) => item.passed).length,
    failed_cases: cases.filter((item) => !item.passed).length,
    not_run_cases: cases.filter((item) => item.issues.some((issue) => issue.code === 'CASE_NOT_RUN')).length,
    unauthorized: byCategory('unauthorized'),
    ambiguous: byCategory('ambiguous'),
    gate_passed: cases.every((item) => item.passed),
    cases,
  };
}

module.exports = { runAdversarialSuite, ADVERSARIAL_CASES: CASES, ADVERSARIAL_FAILURE_CODES, TOKEN_TTL_SECONDS };
