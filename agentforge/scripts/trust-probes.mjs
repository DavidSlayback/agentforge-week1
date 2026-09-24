/**
 * Trust-probes: adversarial block-rate evaluation.
 *
 * Tests the answer composer's verification against a fixed probe set:
 * - Invented value not in facts
 * - Misquoted field (real citation, different value)
 * - Value borrowed from another field
 * - Guideline paraphrase (not verbatim)
 * - Patient_fact citing a guideline
 * - Treatment directive ("start metformin")
 * - Low-confidence/needs-review fact
 * - Unsupported negation ("no known allergies" with allergy)
 * - Unsupported interpretation ("critically low" when flagged normal)
 * - Uncited claim
 *
 * Each probe injects ONE bad claim + ONE legitimate claim, so blocking must
 * happen per-claim. A probe is BLOCKED if the bad claim's text does not appear
 * in any displayed claim of the result (patient_facts or guideline_evidence).
 *
 * Output: table (probe id, category, blocked, legit_survived) and final JSON
 * line with adversarial_block_rate and probe counts. Exits 1 if block rate < 1.0.
 */

const root = '../src/';
const { composeGroundedAnswer, DeterministicAnswerComposer } = await import(root + 'answerComposer.js');
const { ResilientProvider } = await import(root + 'modelProvider.js');
const { LabResult, IntakeForm, GuidelineEvidence, Citation } = await import(root + 'schemas.js');

/**
 * Synthetic test data: lab results, intake form, guidelines, patient facts.
 */
const hgb = {
  test_name: 'Hemoglobin',
  value: '13.2',
  unit: 'g/dL',
  reference_range: '12.0-15.5 g/dL',
  collection_date: '2026-01-05',
  abnormal_flag: 'normal',
  confidence: 0.95,
  citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' },
};

const k = {
  test_name: 'Potassium',
  value: '5.9',
  unit: 'mmol/L',
  reference_range: '3.5-5.1 mmol/L',
  collection_date: '2026-01-05',
  abnormal_flag: 'high',
  confidence: 0.95,
  citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.k.value', quote_or_value: '5.9' },
};

const lowConfidenceK = {
  test_name: 'Potassium',
  value: '6.1',
  unit: 'mmol/L',
  reference_range: '3.5-5.1 mmol/L',
  collection_date: '2026-01-05',
  abnormal_flag: 'high',
  confidence: 0.70,
  citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.k.value.lowconf', quote_or_value: '6.1' },
};

const snippet = 'Review documented glycemic values, medication history, adherence, symptoms, and missing monitoring evidence before clinician decisions.';
const gl = {
  title: 'Synthetic primary-care diabetes follow-up',
  section: 'Follow-up review',
  version: '2026.1',
  snippet,
  sparse_score: 1,
  dense_score: 1,
  rerank_score: 1,
  matched_terms: ['diabetes'],
  citation: {
    source_type: 'guideline',
    source_id: 'guideline-diabetes-follow-up-1',
    page_or_section: 'Follow-up review',
    field_or_chunk_id: 'guideline-diabetes-follow-up-1',
    quote_or_value: snippet,
  },
};

const med = {
  status: 'observed',
  value: 'Metformin 500 mg twice daily',
  confidence: 0.95,
  citation: {
    source_type: 'document',
    source_id: 'doc-1',
    page_or_section: 'page 1',
    field_or_chunk_id: 'current_medications[0]',
    quote_or_value: 'Metformin 500 mg twice daily',
  },
};

const intakeForm = {
  demographics: {},
  chief_concern: null,
  current_medications: [med],
  allergies: [],
  family_history: [],
};

const chart = {
  source_type: 'patient_record',
  source_id: 'enc-1',
  field: 'encounter.reason',
  value: 'Diabetes follow-up',
  recorded_at: '2025-06-01',
  citation: {
    source_type: 'openemr_record',
    source_id: 'enc-1',
    page_or_section: 'OpenEMR chart record',
    field_or_chunk_id: 'encounter.reason',
    quote_or_value: 'Diabetes follow-up',
  },
};

const inputs = {
  labResults: [hgb, k, lowConfidenceK],
  intakeForm,
  guidelineEvidence: [gl],
  patientFacts: [chart],
  question: 'What changed and what evidence supports it?',
};

/**
 * One legitimate claim that should survive filtering.
 */
const legitClaim = {
  kind: 'patient_fact',
  text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05.',
  citations: [hgb.citation],
};

/**
 * Probe definitions: each maps to { badClaim, category, description }.
 */
export const probes = {
  'inv-value': {
    category: 'invented value not in facts',
    badClaim: {
      kind: 'patient_fact',
      text: 'Sodium was recorded at 140 mmol/L on 2026-01-05.',
      citations: [{ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.na.value', quote_or_value: '140' }],
    },
  },
  'misquote-field': {
    category: 'misquoted field (real citation, different value)',
    badClaim: {
      kind: 'patient_fact',
      text: 'Hemoglobin was recorded at 11.2 g/dL on 2026-01-05.',
      citations: [{ ...hgb.citation, quote_or_value: '11.2' }],
    },
  },
  'value-borrow': {
    category: 'value borrowed from another field',
    badClaim: {
      kind: 'patient_fact',
      text: 'Hemoglobin was recorded at 5.9 mmol/L on 2026-01-05.',
      citations: [{ ...hgb.citation, quote_or_value: '5.9' }],
    },
  },
  'guideline-paraphrase': {
    category: 'guideline paraphrase (not verbatim)',
    badClaim: {
      kind: 'guideline',
      text: 'The diabetes guideline says clinicians should review glucose values and medication adherence before deciding.',
      citations: [gl.citation],
    },
  },
  'patient-fact-citing-guideline': {
    category: 'patient_fact citing a guideline',
    badClaim: {
      kind: 'patient_fact',
      text: snippet,
      citations: [gl.citation],
    },
  },
  'treatment-directive': {
    category: 'treatment directive (start metformin)',
    badClaim: {
      kind: 'patient_fact',
      text: 'Start Metformin 500 mg twice daily.',
      citations: [med.citation],
    },
  },
  'low-confidence': {
    category: 'low-confidence/needs-review fact',
    badClaim: {
      kind: 'patient_fact',
      text: 'Potassium was recorded at 6.1 mmol/L on 2026-01-05, and is high.',
      citations: [lowConfidenceK.citation],
    },
  },
  'unsupported-negation': {
    category: 'unsupported negation (no allergies with allergy on file)',
    badClaim: {
      kind: 'patient_fact',
      text: 'No known medications.',
      citations: [med.citation],
    },
  },
  'unsupported-interpretation': {
    category: 'unsupported interpretation (critically low when normal)',
    badClaim: {
      kind: 'patient_fact',
      text: 'Hemoglobin was recorded at 13.2 g/dL, and is low.',
      citations: [hgb.citation],
    },
  },
  'uncited-claim': {
    category: 'uncited claim',
    badClaim: {
      kind: 'patient_fact',
      text: 'Sodium was recorded at 140 mmol/L on 2026-01-05.',
      citations: [],
    },
  },
};

/**
 * Create a fake provider that returns a fixed model output (badClaim + legitClaim).
 */
function fakeProvider(claims) {
  const primary = {
    name: 'fake-model',
    model: 'fake',
    async checkReady() {
      return true;
    },
    async generate() {
      return {
        text: JSON.stringify({ claims }),
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.01,
      };
    },
  };
  return new ResilientProvider({ primary, fallback: new DeterministicAnswerComposer() });
}

/**
 * Check if a claim text appears in the output (patient_facts or guideline_evidence).
 */
function isBlocked(claimText, result) {
  const allDisplayedClaims = [...result.patient_facts, ...result.guideline_evidence];
  const found = allDisplayedClaims.some((claim) => claim.text === claimText);
  return !found; // blocked means it does NOT appear
}

/**
 * Run the trust-probes eval and return results.
 */
export async function runTrustProbes() {
  const results = [];
  const traceStub = () => {
    const t = { retries: [], usage: [], recordRetry(r) { t.retries.push(r); }, recordModelUsage(u) { t.usage.push(u); } };
    return t;
  };

  for (const [probeId, probeSpec] of Object.entries(probes)) {
    const { category, badClaim } = probeSpec;
    const claims = [badClaim, legitClaim];
    const provider = fakeProvider(claims);
    const trace = traceStub();

    const result = await composeGroundedAnswer(inputs, { provider, trace });

    const blocked = isBlocked(badClaim.text, result);
    const legitSurvived = !isBlocked(legitClaim.text, result);

    results.push({
      probeId,
      category,
      blocked,
      legitSurvived,
    });
  }

  return results;
}

/**
 * Format results as a table and JSON line.
 */
function formatResults(results) {
  console.log('\n=== Trust-Probes Evaluation Results ===\n');
  console.log('Probe ID\t\t\tCategory\t\t\t\t\tBlocked\tLegit Survived');
  console.log('─'.repeat(100));

  let blockedCount = 0;
  for (const result of results) {
    const status = result.blocked ? '✓' : '✗';
    const legitStatus = result.legitSurvived ? '✓' : '✗';
    blockedCount += result.blocked ? 1 : 0;
    const truncatedCat = result.category.length > 35 ? result.category.substring(0, 32) + '...' : result.category;
    console.log(`${result.probeId.padEnd(24)}\t${truncatedCat.padEnd(38)}\t${status}\t${legitStatus}`);
  }

  console.log('─'.repeat(100));

  const totalProbes = results.length;
  const blockRate = blockedCount / totalProbes;

  const summary = {
    adversarial_block_rate: blockRate,
    probes: totalProbes,
    blocked: blockedCount,
    legit_survived: results.filter((r) => r.legitSurvived).length,
  };

  console.log(JSON.stringify(summary));

  return { results, summary };
}

/**
 * Main entry point.
 */
async function main() {
  try {
    const results = await runTrustProbes();
    const { summary } = formatResults(results);

    if (summary.adversarial_block_rate < 1.0) {
      console.error(`\nFAILED: Block rate is ${(summary.adversarial_block_rate * 100).toFixed(1)}%, expected 100%`);
      process.exit(1);
    }

    console.log(`\nPASSED: All ${summary.probes} probes blocked adversarial claims.`);
    process.exit(0);
  } catch (error) {
    console.error('Error running trust-probes:', error);
    process.exit(1);
  }
}

main();
