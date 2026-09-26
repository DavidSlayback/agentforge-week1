/**
 * "Not documented" answers (lane F-CLIN; W1 review debt item 20).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    AgentForge
 * @copyright Copyright (c) 2026 AgentForge
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 *
 * A question that asks for a measured value ("what was the blood pressure?")
 * is checked against the facts the answer actually has. When none of them
 * records that measurement, the answer says so instead of listing whatever
 * other evidence shares a word with the question (a "blood-pressure
 * follow-up" visit reason is not a blood-pressure reading).
 *
 * Detection is from the data: a closed vocabulary of measurement concepts
 * (below) says how a question names each one and how a fact records one --
 * a lab result of that test, a chart field for it with a number in its
 * value, or a verbatim quote that prints a reading of it (e.g. "BP 128/82").
 * No question fixture or eval expectation is read.
 */
import { labKind } from './clinicalRules.js';

/**
 * One measurable concept. `group` is the kind of data that holds it
 * (`vitals` or `labs`): absence is claimed only when a source of that kind
 * was read. `asked` matches the question; `labKinds` a typed
 * lab result that records it (`clinicalRules.js#labKind`, or its test name);
 * `field` a fact's field id; `reading` a quote or value that prints a reading.
 */
export const MEASUREMENT_CONCEPTS = Object.freeze([
  { id: 'blood_pressure', group: 'vitals', label: 'Blood pressure', asked: /\bblood[\s-]?pressures?\b|\bbp\b/i, field: /(?:^|[._])(?:bp|bps|bpd|blood_?pressure|bloodpressure|systolic|diastolic)(?:$|[._])/i, reading: /\b(?:bp|blood[\s-]?pressure)\b[^0-9\n]{0,20}\d{2,3}\s*\/\s*\d{2,3}\b/i },
  { id: 'heart_rate', group: 'vitals', label: 'Heart rate', asked: /\bheart[\s-]?rate\b|\bpulse\b/i, field: /(?:^|[._])(?:hr|heart_?rate|pulse)(?:$|[._])/i, reading: /\b(?:heart[\s-]?rate|pulse|hr)\b[^0-9\n]{0,20}\d{2,3}\b/i },
  { id: 'temperature', group: 'vitals', label: 'Temperature', asked: /\btemperature\b|\btemp\b/i, field: /(?:^|[._])(?:temp|temperature)(?:$|[._])/i, reading: /\b(?:temperature|temp)\b[^0-9\n]{0,20}\d{2,3}(?:\.\d)?\b/i },
  { id: 'weight', group: 'vitals', label: 'Weight', asked: /\bweight\b/i, field: /(?:^|[._])(?:weight|wt)(?:$|[._])/i, reading: /\bweight\b[^0-9\n]{0,20}\d{2,3}(?:\.\d+)?\s*(?:kg|lbs?|pounds)\b/i },
  { id: 'bmi', group: 'vitals', label: 'BMI', asked: /\bbmi\b|\bbody mass index\b/i, field: /(?:^|[._])bmi(?:$|[._])/i, reading: /\b(?:bmi|body mass index)\b[^0-9\n]{0,20}\d{2}(?:\.\d+)?\b/i },
  { id: 'potassium', group: 'labs', label: 'Potassium', asked: /\bpotassium\b/i, labKinds: ['potassium'], field: /^lab\.(?:k|potassium)\./i, reading: /\bpotassium\b[^0-9\n]{0,20}\d+(?:\.\d+)?\b/i },
  { id: 'a1c', group: 'labs', label: 'A1C', asked: /\b(?:hb)?a1c\b|\b(?:glycated|glycosylated) (?:hemoglobin|haemoglobin)\b/i, labKinds: ['a1c'], field: /^lab\.(?:hb)?a1c\./i, reading: /\b(?:hb)?a1c\b[^0-9\n]{0,20}\d+(?:\.\d+)?\s*%/i },
  { id: 'hemoglobin', group: 'labs', label: 'Hemoglobin', asked: /(?<!\b(?:glycated|glycosylated)\s)\b(?:hemoglobin|haemoglobin|hgb)\b(?!\s*a1c)/i, labName: /^(?:hemoglobin|haemoglobin|hgb|hb)$/i, field: /^lab\.hgb\./i, reading: /\b(?:hemoglobin|hgb)\b(?!\s*a1c)[^0-9\n]{0,20}\d+(?:\.\d+)?\b/i },
  { id: 'glucose', group: 'labs', label: 'Glucose', asked: /\bglucose\b|\bblood sugar\b/i, labName: /\bglucose\b/i, field: /^lab\.glucose\./i, reading: /\b(?:glucose|blood sugar)\b[^0-9\n]{0,20}\d{2,3}\b/i },
  { id: 'sodium', group: 'labs', label: 'Sodium', asked: /\bsodium\b/i, labName: /^(?:sodium|na\+?)$/i, field: /^lab\.(?:na|sodium)\./i, reading: /\bsodium\b[^0-9\n]{0,20}\d{3}\b/i },
  { id: 'creatinine', group: 'labs', label: 'Creatinine', asked: /\bcreatinine\b/i, labName: /\bcreatinine\b/i, field: /^lab\.(?:cr|creatinine)\./i, reading: /\bcreatinine\b[^0-9\n]{0,20}\d+(?:\.\d+)?\b/i },
  { id: 'egfr', group: 'labs', label: 'eGFR', asked: /\be?gfr\b/i, labName: /\be?gfr\b/i, field: /^lab\.e?gfr\./i, reading: /\be?gfr\b[^0-9\n]{0,20}\d+\b/i },
  { id: 'cholesterol', group: 'labs', label: 'Cholesterol', asked: /\bcholesterol\b|\bldl\b|\bhdl\b|\blipid panel\b/i, labName: /\bcholesterol\b|\bldl\b|\bhdl\b/i, field: /^lab\.(?:ldl|hdl|cholesterol|tc)\./i, reading: /\b(?:cholesterol|ldl|hdl)\b[^0-9\n]{0,20}\d{2,3}\b/i },
].map((concept) => Object.freeze(concept)));

/** A question asks for a recorded value when it asks "what"/"which", names a value word, or ends in a question mark. */
const VALUE_SEEKING = /\b(?:what|which|show|give|tell)\b|\b(?:value|level|reading|result|measurement|latest|last|recent|current|recorded|documented)s?\b|\?\s*$/i;
/** A question about a guideline figure (a target, threshold, recommendation) asks for evidence, not a recorded value. */
const GUIDELINE_SEEKING = /\b(?:target|goal|recommended|recommend|ideal|expected|threshold|cutoff|optimal|should|guideline)\b/i;

/** The concepts a question asks a recorded value for (empty for a guideline or non-measurement question). */
export function askedMeasurementConcepts(question) {
  const text = String(question || '').trim();
  if (!text || !VALUE_SEEKING.test(text) || GUIDELINE_SEEKING.test(text)) return [];
  return MEASUREMENT_CONCEPTS.filter((concept) => concept.asked.test(text));
}

function labRecords(concept, result) {
  if (concept.labKinds?.includes(labKind(result))) return true;
  if (concept.labName?.test(String(result?.test_name || '').trim())) return true;
  return concept.field.test(String(result?.citation?.field_or_chunk_id || ''));
}

function factRecords(concept, { field = '', value = '' }) {
  const text = String(value ?? '');
  if (concept.field.test(field) && /\d/.test(text)) return true;
  return concept.reading.test(text);
}

const GROUP_NOUN = Object.freeze({ vitals: 'vital signs', labs: 'lab results' });

function missingEntry(concept, readGroups, sourcesChecked) {
  if (readGroups.has(concept.group)) {
    return { concept: concept.id, status: 'not_documented', label: concept.label, text: `${concept.label} is not documented in the sources read.`, sources_checked: sourcesChecked };
  }
  return { concept: concept.id, status: 'not_retrieved', label: concept.label, text: `${concept.label} is not available from the sources read (${GROUP_NOUN[concept.group]} are not retrieved).`, sources_checked: sourcesChecked };
}

/**
 * Which asked concepts no available fact records.
 *
 * Args:
 *   question: the clinician's question.
 *   labResults: typed `LabResult`s (any confidence: a low-confidence reading
 *     is documented but needs review, which is not "not documented").
 *   facts: `{ field, value, source_type }` for every other fact the answer
 *     has (intake leaves, medication-list rows, chart records).
 *   withheldFields: chart field ids held back from the answer (a conflict,
 *     an unreadable group). A concept with a withheld field is recorded but
 *     not shown, which is not "not documented", so it is never reported as such.
 *   readGroups: the kinds of data (`vitals`, `labs`) a source that was read
 *     actually holds. A missing concept in a group that was read is
 *     `not_documented`; in a group no source reads it is `not_retrieved`,
 *     and the text says the data is not retrieved rather than absent.
 *
 * Returns `{ question, asked, notDocumented }`: `asked` the concept ids the question
 * asks for; `notDocumented` one `{ concept, status, label, text, sources_checked }`
 * per asked concept with no recording fact.
 */
export function findNotDocumented({ question = '', labResults = [], facts = [], withheldFields = [], readGroups = [] } = {}) {
  const groups = new Set(readGroups);
  const asked = askedMeasurementConcepts(question).filter((concept) => !withheldFields.some((field) => concept.field.test(String(field))));
  const sourcesChecked = [...new Set([...(labResults.length ? ['document'] : []), ...facts.map((fact) => fact.source_type).filter(Boolean)])].sort();
  const notDocumented = asked
    .filter((concept) => !labResults.some((result) => labRecords(concept, result)) && !facts.some((fact) => factRecords(concept, fact)))
    .map((concept) => missingEntry(concept, groups, sourcesChecked));
  return { question, asked: asked.map((concept) => concept.id), notDocumented };
}

/** Words that frame a value question without naming a topic of their own. */
const FRAMING_WORDS = new Set('what which was were is are the a an of for in on at and or to show give tell me value values level levels reading readings result results measurement measurements latest last recent most current recorded documented patient patients this that any there his her their its has have had does did do from with'.split(' '));

/**
 * True when the question names something besides the measurement concepts
 * it asks for ("documented medication and blood pressure" also asks about
 * medication), so the rest of the answer is still relevant.
 */
export function asksAboutMore(question) {
  let text = String(question || '').toLowerCase();
  for (const concept of MEASUREMENT_CONCEPTS) text = text.replace(new RegExp(concept.asked.source, 'gi'), ' ');
  return text.split(/[^a-z0-9']+/).some((word) => word.length > 2 && !FRAMING_WORDS.has(word));
}

/**
 * True when the question asks only for values that are not documented, so
 * nothing else answers it: at least one measurement concept asked, none of
 * them documented, and no other topic named.
 */
export function onlyNotDocumented({ asked, notDocumented, question }) {
  return asked.length > 0 && notDocumented.length === asked.length && !asksAboutMore(question);
}
