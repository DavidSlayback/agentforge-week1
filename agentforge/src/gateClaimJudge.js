/**
 * Independent claim judge for the W2 gate (H5, 2026-10-01).
 *
 * The gate used to re-check answer claims only with the production
 * `verifyClaims`, so a defect in `claimBinding.js` hid from the gate too (a
 * mutation that marked uncited claims `anchored` passed both gates). This
 * module re-derives a smaller rule set on its own and must stay independent of
 * the production answer path: it imports nothing, and
 * `test/gate-claim-judge.test.js` fails if it ever imports `claimBinding.js`,
 * `groundingText.js`, `answerComposer.js` or `clinicalVocabulary.js`.
 *
 * Rules, per shipped claim:
 * - it has at least one citation (`uncited`);
 * - every citation names a source this run actually produced, matched on
 *   `source_type`, `source_id` and `field_or_chunk_id` (`cites_source_not_in_run`),
 *   with the same `quote_or_value` (`quote_differs_from_run_citation`);
 * - a `patient_fact` claim cites patient sources and a `guideline` claim cites
 *   guideline sources (`kind_<claim>_cites_<source>_source`);
 * - every number in the claim text appears in what it cites: the quote, or a
 *   typed field of the cited item, such as a lab result's range and collection
 *   date or a guideline chunk's version date (`number_not_in_cited_source`).
 *
 * It is cruder than `verifyClaims` (no vocabulary, no directive check). It
 * exists so the gate catches binding defects that the production verifier
 * itself would miss. Issue codes carry claim indexes only, never claim text.
 */

const NUMBER = /\d+(?:\.\d+)?/g;
const canonicalNumber = (token) => String(Number(token));

/** Numbers in `text`, canonicalized so `12.0` and `12` compare equal. */
export function numbersIn(text) {
  return (String(text ?? '').match(NUMBER) || []).map(canonicalNumber);
}

const sourceKey = (citation) => (citation ? `${citation.source_type}|${citation.source_id}|${citation.field_or_chunk_id}` : null);

/**
 * Judge shipped answer claims against the sources the run produced.
 *
 * Args:
 *   claims: `[{ kind, text, citations }]`, the claims the answer ships.
 *   sources: `[{ citation, kind: 'patient_fact' | 'guideline', texts }]`, every
 *     item the answer may cite, with the strings whose numbers a claim citing
 *     it may state.
 *
 * Returns:
 *   A list of issue codes; empty when every claim passes.
 */
export function judgeAnswerClaims(claims, sources) {
  const byKey = new Map();
  for (const source of sources) {
    const key = sourceKey(source.citation);
    if (key) byKey.set(key, [...(byKey.get(key) || []), source]);
  }
  const issues = [];
  (claims || []).forEach((claim, index) => {
    const tag = `answer_claim[${index}]`;
    const citations = Array.isArray(claim?.citations) ? claim.citations : [];
    if (!citations.length) {
      issues.push(`${tag}:uncited`);
      return;
    }
    const cited = [];
    for (const citation of citations) {
      const matches = byKey.get(sourceKey(citation)) || [];
      if (!matches.length) {
        issues.push(`${tag}:cites_source_not_in_run`);
        continue;
      }
      const match = matches.find((source) => source.citation.quote_or_value === citation.quote_or_value);
      if (!match) {
        issues.push(`${tag}:quote_differs_from_run_citation`);
        continue;
      }
      if (match.kind !== claim.kind) issues.push(`${tag}:kind_${claim.kind}_cites_${match.kind}_source`);
      cited.push(match);
    }
    const allowed = new Set(cited.flatMap((source) => source.texts.flatMap(numbersIn)));
    if (numbersIn(claim.text).some((number) => !allowed.has(number))) issues.push(`${tag}:number_not_in_cited_source`);
  });
  return issues;
}
