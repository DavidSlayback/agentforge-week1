/**
 * Presentation-only helpers for the visit workspace (ui.js). Each function
 * turns fields the API already returned into a readable line; none of them
 * changes a claim, a citation or a status. The main page serializes these
 * functions into its client script (`fn.toString()`), so each one must be
 * self-contained: no imports and no module-level references other than the
 * other helpers in this file, which the page serializes alongside.
 */

/**
 * One readable clinical line for a patient-fact claim, built from its first
 * citation's field id and recorded value, e.g. `problem.hypertension.status`
 * + `active` -> "Hypertension — active". A document citation (lab, intake,
 * medication list) already carries a readable claim sentence, so it keeps the
 * claim text. Anything without a recognizable field id falls back to the
 * claim text unchanged.
 */
export function factLine(claim) {
  const fallback = String(claim?.text ?? '').trim();
  const citation = (Array.isArray(claim?.citations) ? claim.citations : [])[0] || {};
  const id = String(citation.field_or_chunk_id || '');
  const value = String(citation.quote_or_value ?? '').trim();
  if (!id || !value || citation.source_type === 'document' || citation.source_type === 'guideline') return fallback;
  const parts = id.split('.');
  const words = (text) => String(text).replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const name = capital(words(parts.length > 2 ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ')));
  const attribute = parts.length > 2 ? parts.at(-1) : '';
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(claim?.recorded_at || '')) ? ` (${String(claim.recorded_at).slice(0, 10)})` : '';
  let line = '';
  if (parts[0] === 'encounter') line = attribute && attribute !== 'reason' ? `Encounter ${words(attribute)}: ${value}` : `Encounter: ${value}`;
  else if (parts[0] === 'note') line = id === 'note.plan_follow_through' ? `Plan follow-through: ${value}` : `Note (${words(parts.slice(1).join(' '))}): ${value}`;
  else if (!name) return fallback;
  else if (parts[0] === 'problem') line = !attribute || attribute === 'status' ? `${name} — ${value}` : `${name} — ${words(attribute)}: ${value}`;
  else if (parts[0] === 'medication') {
    if (attribute === 'dose' && !/not available/i.test(value)) line = `${name} ${value}`;
    else if (attribute === 'comment') line = `${name} — instructions: ${value}`;
    else line = attribute && attribute !== 'dose' ? `${name} — ${words(attribute)}: ${value}` : `${name} — ${value}`;
  } else if (parts[0] === 'allergy') line = `Allergy: ${name}${attribute ? ` — ${value}` : ''}`;
  else return fallback;
  return line + date;
}

/**
 * Patient-fact claims as display rows: one row per distinct readable line
 * (exact duplicates collapse with a count, keeping every distinct document
 * citation and each chart-citation label once).
 */
export function factRows(claims) {
  const rows = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    const text = factLine(claim);
    const key = text.toLowerCase();
    if (!rows.has(key)) rows.set(key, { text, citations: [], count: 0 });
    const row = rows.get(key);
    row.count += 1;
    for (const citation of Array.isArray(claim?.citations) ? claim.citations : []) {
      // A document citation is a distinct link per source region; a chart
      // citation renders as its label only, so one label is shown once.
      const keyOf = (item) => (item.source_type === 'document' ? [item.source_type, item.source_id, item.field_or_chunk_id, item.page_or_section] : [item.source_type, item.page_or_section]).join('|');
      if (!row.citations.some((seen) => keyOf(seen) === keyOf(citation))) row.citations.push(citation);
    }
  }
  return [...rows.values()];
}

/**
 * A readable needs-review line, e.g. `{ field: 'lab.hgb.value', reason:
 * 'low_confidence' }` -> "Hemoglobin value: low OCR confidence, check the
 * source". Unknown ids and reasons are shown with underscores as spaces,
 * never dropped.
 */
export function reviewItemLabel(item) {
  const field = String(item?.field ?? '');
  const reason = String(item?.reason ?? '');
  const TESTS = { hgb: 'Hemoglobin', a1c: 'A1C', k: 'Potassium', na: 'Sodium', glucose: 'Glucose', ldl: 'LDL cholesterol', hdl: 'HDL cholesterol', tsh: 'TSH', creatinine: 'Creatinine', egfr: 'eGFR', wbc: 'White blood cells', plt: 'Platelets' };
  const PARTS = { value: 'value', unit: 'unit', reference_range: 'reference range', collection_date: 'collection date', abnormal: 'abnormal flag', test_name: 'test name' };
  const REASONS = {
    low_confidence: 'low OCR confidence, check the source',
    low_confidence_requires_human_review: 'low OCR confidence, check the source',
    missing_citation: 'no source citation, so it was not used',
    flag_contradicts_range: 'the printed flag contradicts the reference range, check the source',
    rule_unit_unrecognized: 'unit not recognized, so the safety rule was not applied',
    rule_value_unparseable: 'value could not be read as a number, check the source',
    implausible_value: 'value is outside a plausible range, check the source',
    openemr_unconfirmed_empty: 'could not be confirmed from OpenEMR (an empty list is not a confirmed absence)',
  };
  const words = (text) => String(text).replace(/\[(\d+)\]/g, (_, index) => ` ${Number(index) + 1}`).replaceAll('_', ' ').replaceAll('.', ' ').replace(/\s+/g, ' ').trim();
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const parts = field.split('.');
  let name;
  if (parts[0] === 'lab' && parts[1]) {
    const rest = parts.slice(2).join('.');
    name = (TESTS[parts[1]] || parts[1].toUpperCase()) + (rest ? ` ${PARTS[rest] || words(rest)}` : '');
  } else if (['intake', 'medlist', 'medication_list'].includes(parts[0]) && parts.length > 1) {
    name = capital(words(parts.slice(1).join('.')));
  } else {
    name = capital(words(field)) || 'Unnamed field';
  }
  return `${name}: ${REASONS[reason] || words(reason) || 'needs review'}`;
}

/**
 * The scan result header, from the workflow's own fields: document kind,
 * final state, cited-field count and the critic's status (always stated,
 * never implied reviewed).
 */
export function scanSummary({ documentType, finalState, factCount, criticStatus = null, criticRejected = 0, criticUnreviewed = 0 } = {}) {
  const DOCUMENTS = { lab_pdf: 'Lab report read', intake_form: 'Intake form read', medication_list: 'Medication list read' };
  const STATES = { READY: 'Ready', QUALIFIED: 'Needs review', BLOCKED: 'Blocked' };
  const CRITIC = {
    reviewed: 'answer reviewed by the critic',
    failed: 'critic review failed; answer not reviewed',
    disabled: 'critic off; answer not reviewed',
    skipped_budget: 'critic skipped (budget); answer not reviewed',
    skipped_no_claims: 'no answer claims for the critic to review',
    skipped_identity_only: 'critic skipped (identity-only answer)',
    skipped_not_approved: 'critic skipped (provider not approved); answer not reviewed',
  };
  const count = Number.isFinite(Number(factCount)) ? Number(factCount) : 0;
  let critic = criticStatus ? (CRITIC[criticStatus] || `critic: ${String(criticStatus).replaceAll('_', ' ')}`) : 'no answer composed';
  if (criticRejected) critic += `, ${criticRejected} claim(s) removed`;
  if (criticUnreviewed) critic += `, ${criticUnreviewed} claim(s) not reviewed`;
  return {
    document: DOCUMENTS[documentType] || 'Document read',
    state: STATES[finalState] || String(finalState || 'Unknown'),
    fields: `${count} cited field${count === 1 ? '' : 's'}`,
    critic,
  };
}

/** Worker handoffs as plain step names: Extract → Retrieve guidelines → Critic review. */
export function scanSteps(handoffs) {
  const WORKERS = { 'scan-form-extraction-worker': 'Extract', 'evidence-retrieval-worker': 'Retrieve guidelines', 'critic-worker': 'Critic review' };
  const steps = [];
  for (const handoff of Array.isArray(handoffs) ? handoffs : []) {
    const worker = String(handoff?.worker || '');
    const label = WORKERS[worker] || worker.replace(/-worker$/, '').replaceAll('-', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
    if (label && steps.at(-1) !== label) steps.push(label);
  }
  return steps;
}
