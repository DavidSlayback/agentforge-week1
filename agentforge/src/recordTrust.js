import { coverageGroupForField } from './contracts.js';

/**
 * Chart-record trust signals for the pre-visit briefing (W1-SF3).
 *
 * Every signal is read from the retrieved records themselves (field, value,
 * recorded_at, author, source_ref), the same fields a live OpenEMR record
 * carries. Nothing here reads a fixture's eval expectations, case ids, or
 * case names. Each finding becomes a qualification reason; only a duplicate
 * identity is also withheld, because two identity records cannot both be
 * shown as "the patient".
 */

/**
 * Freshness windows, in days, by field type (the field's first segment). A
 * field is stale when its newest record is older than the window at the
 * reference time (the visit date when the chart supplies one, else now).
 *
 * Only allergies are time-windowed: an allergy list is expected to be
 * reconciled at least yearly. Medication, problem, and note values change
 * with each encounter; a superseding or conflicting value for them is caught
 * by the same-date conflict check and the dated comparison instead.
 */
export const FRESHNESS_WINDOWS_DAYS = Object.freeze({ allergy: 365 });
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Text addressed to an automated reader rather than a clinician: a note
 * "to the automation/assistant", or an order to ignore or override
 * instructions, policies, or rules. Ordinary clinical narrative ("told to
 * ignore the rash") does not match, because the object must be an
 * instruction, policy, rule, or prompt.
 */
const NARRATIVE_INSTRUCTION_PATTERNS = Object.freeze([
  /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+)?(?:automation|ai|assistant|model|system|agent|bot|llm)\b/i,
  /\b(?:ignore|disregard|override|bypass|forget)\s+(?:(?:all|any|the|your|these|those|previous|prior|above|earlier|evidence|safety)\s+)*(?:instructions?|polic(?:y|ies)|rules?|guardrails?|prompts?|system\s+prompt)\b/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:an?|the)\s+(?:ai|assistant|language\s+model|model|chatbot)\b/i,
]);

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isIdentityRecord = (record) => coverageGroupForField(record.field) === 'identity';

/** Fields whose newest record is older than the field type's freshness window. */
export function findStaleFields(records, referenceTime) {
  if (!Number.isFinite(referenceTime)) return [];
  const newest = new Map();
  for (const record of records) {
    const windowDays = FRESHNESS_WINDOWS_DAYS[String(record.field).split('.')[0]];
    const recordedAt = Date.parse(record.recorded_at);
    if (!windowDays || !Number.isFinite(recordedAt)) continue;
    if (!newest.has(record.field) || recordedAt > newest.get(record.field).recordedAt) newest.set(record.field, { recordedAt, windowDays });
  }
  return [...newest.entries()].filter(([, entry]) => referenceTime - entry.recordedAt > entry.windowDays * DAY_MS).map(([field]) => field);
}

/**
 * Clinical fields with a record that lacks an author or a recorded date. The
 * identity row is demographic registration data, not an authored clinical
 * assertion, so it is exempt.
 */
export function findMissingProvenance(records) {
  const fields = records.filter((record) => !isIdentityRecord(record) && (!hasText(record.author) || !hasText(record.recorded_at))).map((record) => record.field);
  return [...new Set(fields)];
}

/** Fields whose text value addresses an automated reader with instructions. */
export function findUntrustedNarrative(records) {
  const fields = records.filter((record) => hasText(record.value) && NARRATIVE_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(record.value))).map((record) => record.field);
  return [...new Set(fields)];
}

/** True when the chart returns more than one identity record from distinct sources. */
export function findDuplicateIdentity(records) {
  const sources = new Set(records.filter(isIdentityRecord).map((record) => String(record.source_ref ?? JSON.stringify(record.value))));
  return sources.size > 1;
}

/**
 * Assess the covered, patient-scoped records. Returns qualification reasons
 * and the fields to withhold. `referenceTime` is epoch milliseconds.
 */
export function assessRecordTrust({ records, referenceTime }) {
  const list = Array.isArray(records) ? records : [];
  const reasons = [];
  const withheldFields = [];
  if (findDuplicateIdentity(list)) {
    reasons.push('possible_duplicate_identity');
    withheldFields.push(...new Set(list.filter(isIdentityRecord).map((record) => record.field)));
  }
  reasons.push(...findStaleFields(list, referenceTime).map((field) => `stale:${field}`));
  reasons.push(...findMissingProvenance(list).map((field) => `provenance_missing:${field}`));
  reasons.push(...findUntrustedNarrative(list).map((field) => `untrusted_narrative:${field}`));
  return { reasons, withheldFields };
}
