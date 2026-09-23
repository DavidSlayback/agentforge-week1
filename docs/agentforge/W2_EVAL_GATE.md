# W2 regression gate

The local gate executes 50 generated synthetic text-fixture cases against the
current extraction validators, lexical retrieval path, and redacted trace sink.
It reports the five assignment rubric categories: `schema_valid`,
`citation_present`, `factually_consistent`, `safe_refusal`, and
`no_phi_in_logs`.

This is implementation-level evidence, not a labeled dataset of scanned forms.
Cases do not demonstrate binary PDF parsing, OCR/VLM extraction, live Cohere
retrieval, browser behavior, OpenEMR persistence, or deployment. `safe_refusal`
checks that malformed fixtures and unsupported queries are qualified or
withheld. The gate defaults to the local lexical fallback and does not contact
Cohere.

## Run

```text
npm run eval:gate --prefix agentforge
```

The command prints the corpus hash, per-rubric counts, thresholds, regressions,
critical failures, and failed case IDs; it does not print fixture content.
Every category must meet 95%, regression from baseline must not exceed five
percentage points, and `no_phi_in_logs` has zero tolerance.

## Mutation proof

```text
npm run eval:gate --prefix agentforge -- --inject-defect
```

This injects one schema failure and must exit nonzero. The checked-in baseline is
[`evidence/W2_BASELINE_REPORT.json`](evidence/W2_BASELINE_REPORT.json). The
generator/evaluator lives in `agentforge/src/w2RegressionGate.js`.
