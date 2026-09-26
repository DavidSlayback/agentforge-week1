/**
 * Detect a question that names a patient other than the one the request is
 * scoped to (W1-SF4). The briefing follow-up, the scan answer, and the
 * follow-up evidence route all refuse such a question instead of answering
 * it from the current patient's chart.
 *
 * What is matched:
 * - Identifier shapes the service issues or reads: synthetic patient refs
 *   (`fixture-patient-003`, `fixture-patient-dup`) and UUIDs (OpenEMR patient
 *   uuids). Separators are normalized, so "fixture patient 003" and
 *   "fixture_patient_003" match too.
 * - The chart adapter's own patient list (`listPatientIdentifiers()`):
 *   - ids (patient ref, chart id / MRN / pubpid), separators normalized. An
 *     all-digit id matches only after an id word ("MRN 1234", "pid: 1234"),
 *     so a dose or a lab value is never read as a chart number;
 *   - names, only as the full name written as a proper noun (each word
 *     capitalized, case-sensitive), in "First Last" or "Last, First" order.
 *     A one-word name is never matched, so ordinary words ("test",
 *     "conflict", "partial") in a clinical question never trigger a refusal.
 *
 * Live OpenEMR: `OpenEMRRestAdapter` has no patient list, so on that adapter
 * only the identifier shapes above are checked. Another patient's name or MRN
 * is NOT detected there.
 *
 * Anything that is also an identifier of the current patient is ignored. The
 * function returns a boolean only, so no identifier from the question ever
 * reaches a response, log, or trace.
 */
const SEPARATORS = /[\s_-]+/g;
const canonicalId = (value) => String(value ?? '').toLowerCase().replace(SEPARATORS, '-').replace(/^-+|-+$/g, '');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bounded = (body, flags) => new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, flags);

const IDENTIFIER_SHAPES = Object.freeze([
  bounded('fixture-patient-(?:\\d+|dup)', 'g'),
  bounded('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g'),
]);
const ID_WORDS = '(?:mrn|pid|pubpid|chart|record|patient|id)(?:-?(?:no|number|#))?';

/** A matcher for one listed id, or null when the id is too weak to match safely. */
function idMatcher(value) {
  const id = canonicalId(value);
  if (!id) return null;
  if (/^\d+$/.test(id)) return id.length >= 3 ? bounded(`${ID_WORDS}[-:#.]*${escapeRegExp(id)}`) : null;
  // A plain word (no digit, no separator) is not an identifier.
  if (!/[\d-]/.test(id) || id.length < 4) return null;
  return bounded(escapeRegExp(id));
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** Case-sensitive full-name matchers ("First Last", "Last, First"); none for a one-word name. */
function nameMatchers(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  const proper = words.map((word) => escapeRegExp(capitalize(word)));
  const edge = (body) => new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u');
  return [edge(proper.join('\\s+')), edge(`${proper.at(-1)}\\s*,\\s*${proper.slice(0, -1).join('\\s+')}`)];
}

const idsOf = (entry) => [entry?.patient_ref, ...(entry?.record_ids || [])];

/**
 * @param {{ message: string, currentPatient: { patient_ref: string, display_name?: string }, knownPatients?: Array<{ patient_ref: string, names?: string[], record_ids?: string[] }> }} input
 * @returns {boolean} true when the message names a different patient.
 */
export function mentionsOtherPatient({ message, currentPatient, knownPatients = [] }) {
  const raw = String(message ?? '');
  if (!raw.trim() || !currentPatient?.patient_ref) return false;
  const text = canonicalId(raw);
  const currentRef = canonicalId(currentPatient.patient_ref);
  const currentEntries = knownPatients.filter((entry) => canonicalId(entry.patient_ref) === currentRef);
  const currentIds = new Set([currentRef, ...currentEntries.flatMap(idsOf).map(canonicalId)]);
  const currentNames = [currentPatient.display_name, ...currentEntries.flatMap((entry) => entry.names || [])].filter(Boolean).map((name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase());
  for (const shape of IDENTIFIER_SHAPES) {
    for (const match of text.matchAll(shape)) if (!currentIds.has(match[0])) return true;
  }
  for (const entry of knownPatients) {
    if (canonicalId(entry.patient_ref) === currentRef) continue;
    for (const id of idsOf(entry)) {
      const matcher = currentIds.has(canonicalId(id)) ? null : idMatcher(id);
      if (matcher?.test(text)) return true;
    }
    for (const name of entry.names || []) {
      const folded = String(name).trim().replace(/\s+/g, ' ').toLowerCase();
      // A name that is (part of) the current patient's own name is not another patient.
      if (currentNames.some((current) => ` ${current} `.includes(` ${folded} `))) continue;
      if (nameMatchers(name).some((matcher) => matcher.test(raw))) return true;
    }
  }
  return false;
}
