// W3 remediation (F-990345a00f, F-e5d47ab7ea): two deterministic checks on the
// chart facts and guideline evidence that `/v1/follow-up-evidence` returns.
//
//   conditionsNotInChart: a question that names a clinical condition the chart
//     does not document must not return guideline evidence as if it applied.
//     The caller marks the response `qualification.required` instead.
//   markCurrentFacts: a field recorded with different values over time says
//     which value is current (the latest `recorded_at`), so a reader never sees
//     two active values for one field with no cue which one to trust.
//
// Both read only the question and the chart facts. They never read eval
// expectations (AGENTS.md). Pattern lists are fixed data in this file.

// Each entry: the condition a question may name, and the words that show the
// chart documents it (problem, medication, lab or code). The question side is
// deliberately narrow: it names the condition itself, so a plain question about
// a lab test or about blood pressure does not trigger it.
const CONDITIONS = Object.freeze([
  { id: 'diabetes', question: /\b(?:diabet\w*|insulin|metformin|t2dm|dm2)\b/i, chart: /diabet|insulin|metformin|glargine|glipizide|hba1c|a1c|t2dm|dm2|glucose|\be1[01]\b/i },
  { id: 'atrial_fibrillation', question: /\b(?:atrial fibrillation|a-?fib|anticoag\w*|warfarin|apixaban|rivaroxaban|eliquis|xarelto)\b/i, chart: /fibrillation|a-?fib|anticoag|warfarin|apixaban|rivaroxaban|eliquis|xarelto|\bi48\b/i },
  { id: 'cancer', question: /\b(?:cancer|carcinoma|malignan\w*|chemotherap\w*|oncolog\w*|tumou?r)\b/i, chart: /cancer|carcinoma|malignan|chemo|oncolog|tumou?r|neoplasm|\bc\d\d\b/i },
  { id: 'asthma', question: /\b(?:asthma|inhaler|albuterol|bronchodilator|inhaled corticosteroid)\b/i, chart: /asthma|inhaler|albuterol|corticosteroid|bronchodilator|\bj45\b|copd/i },
  { id: 'heart_failure', question: /\b(?:heart failure|chf)\b/i, chart: /heart.?failure|\bchf\b|cardiomyopathy|\bi50\b/i },
  { id: 'kidney_disease', question: /\b(?:ckd|chronic kidney|dialysis)\b/i, chart: /\bckd\b|kidney|renal|dialysis|creatinine|\bgfr\b|egfr|\bn18\b/i },
  { id: 'lipid_disorder', question: /\b(?:statins?|cholesterol|hyperlipid\w*|dyslipid\w*|ldl)\b/i, chart: /statin|lipid|cholesterol|\bldl\b|\bhdl\b|triglycerid|\be78\b/i },
  { id: 'hypertension', question: /\b(?:hypertensi\w*|htn)\b/i, chart: /hypertens|\bhtn\b|blood.?pressure|lisinopril|losartan|amlodipine|hydrochlorothiazide|metoprolol/i },
  { id: 'anemia', question: /\banemi\w*\b/i, chart: /anemi|hemoglobin|\bhgb\b|\biron\b|ferrous/i },
]);

const factText = (facts) => facts.map((fact) => `${fact.field ?? ''} ${typeof fact.value === 'object' ? JSON.stringify(fact.value) : fact.value ?? ''}`).join('\n');

/**
 * Condition ids the question names that no chart fact documents. Empty when
 * the question names no condition from the list above.
 */
export function conditionsNotInChart(message, patientFacts) {
  const question = String(message ?? '');
  const chart = factText(Array.isArray(patientFacts) ? patientFacts : []);
  return CONDITIONS.filter((condition) => condition.question.test(question) && !condition.chart.test(chart)).map((condition) => condition.id);
}

const timestamp = (fact) => {
  const parsed = Date.parse(fact.recorded_at);
  return Number.isFinite(parsed) ? parsed : null;
};
const sameValue = (left, right) => JSON.stringify(left.value) === JSON.stringify(right.value);

/**
 * Copy `patientFacts` with `current: true|false` on every fact. Per field, the
 * fact(s) with the latest `recorded_at` are current and earlier ones are
 * superseded history. A field is `unresolved` (and none of its facts get a
 * marker) when its values differ and the latest cannot be told apart: equal
 * latest timestamps with different values, or a missing/invalid timestamp.
 * Callers qualify the answer for those fields (a missing verdict is not a pass).
 */
export function markCurrentFacts(patientFacts) {
  const facts = Array.isArray(patientFacts) ? patientFacts : [];
  const byField = new Map();
  for (const fact of facts) {
    if (!byField.has(fact.field)) byField.set(fact.field, []);
    byField.get(fact.field).push(fact);
  }
  const currentFacts = new Set();
  const unresolved = [];
  for (const [field, group] of byField) {
    if (group.every((fact) => sameValue(fact, group[0])) && group.some((fact) => timestamp(fact) === null)) {
      // One value throughout: nothing conflicts, every record states it.
      for (const fact of group) currentFacts.add(fact);
      continue;
    }
    const stamps = group.map(timestamp);
    if (stamps.some((stamp) => stamp === null)) { unresolved.push(field); continue; }
    const latest = Math.max(...stamps);
    const latestFacts = group.filter((fact, index) => stamps[index] === latest);
    if (!latestFacts.every((fact) => sameValue(fact, latestFacts[0]))) { unresolved.push(field); continue; }
    for (const fact of latestFacts) currentFacts.add(fact);
  }
  const marked = facts.map((fact) => (unresolved.includes(fact.field) ? { ...fact } : { ...fact, current: currentFacts.has(fact) }));
  return { facts: marked, unresolved };
}
