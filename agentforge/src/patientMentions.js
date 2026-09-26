/**
 * Detect a follow-up question that names a patient other than the one the
 * conversation is scoped to (W1-SF4). The briefing must refuse such a
 * question instead of answering it from the current patient's chart.
 *
 * Two sources of identifiers:
 * - identifier shapes the service issues or reads: synthetic patient refs
 *   (`fixture-patient-…`), synthetic chart ids (`fixture-pid-…`), and UUIDs
 *   (OpenEMR patient uuids);
 * - the chart adapter's own patient list (`listPatientIdentifiers()`): each
 *   patient's ref, display name, and chart/MRN ids. An adapter that cannot
 *   list patients (live OpenEMR REST) contributes nothing here, so only the
 *   identifier shapes apply there.
 *
 * Anything that is also an identifier of the current patient is ignored. The
 * function returns a boolean only, so no identifier from the question ever
 * reaches a response, log, or trace.
 */
const IDENTIFIER_SHAPES = Object.freeze([
  /\bfixture-patient-[a-z0-9]+\b/gi,
  /\bfixture-pid-[a-z0-9]+\b/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
]);

const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsPhrase = (text, phrase) => new RegExp(`(?:^|[^a-z0-9-])${escapeRegExp(phrase)}(?:$|[^a-z0-9-])`).test(text);

function identifiersOf(entry) {
  return [entry?.patient_ref, ...(entry?.names || []), ...(entry?.record_ids || [])].map(normalize).filter((value) => value.length >= 3);
}

/**
 * @param {{ message: string, currentPatient: { patient_ref: string, display_name?: string }, knownPatients?: Array<{ patient_ref: string, names?: string[], record_ids?: string[] }> }} input
 * @returns {boolean} true when the message names a different patient.
 */
export function mentionsOtherPatient({ message, currentPatient, knownPatients = [] }) {
  const text = normalize(message);
  if (!text || !currentPatient?.patient_ref) return false;
  const currentRef = normalize(currentPatient.patient_ref);
  const currentName = normalize(currentPatient.display_name);
  const current = new Set([currentRef, currentName, ...knownPatients.filter((entry) => normalize(entry.patient_ref) === currentRef).flatMap(identifiersOf)].filter(Boolean));
  for (const shape of IDENTIFIER_SHAPES) {
    for (const match of text.matchAll(shape)) if (!current.has(normalize(match[0]))) return true;
  }
  const others = knownPatients
    .filter((entry) => normalize(entry.patient_ref) !== currentRef)
    .flatMap(identifiersOf)
    // A phrase that is part of the current patient's own name is not another patient.
    .filter((identifier) => !current.has(identifier) && !(currentName && containsPhrase(currentName, identifier)));
  return others.some((identifier) => containsPhrase(text, identifier));
}
