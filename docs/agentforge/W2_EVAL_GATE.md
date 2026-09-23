# W2 regression gate

The W2 gate is a versioned, synthetic-only evaluation over 50 content-free
cases. It measures seven behavioral labels: extraction, retrieval, citation,
refusal, missing data, follow-up grounding, and safety/privacy. It also emits
the assignment-facing rubric mapping: `schema_valid`, `citation_present`,
`factually_consistent`, `safe_refusal`, and `no_phi_in_logs`.

## Run

```text
npm run eval:gate --prefix agentforge
```

The command prints reviewer-visible metadata only: the corpus hash, per-rubric
counts, thresholds, regressions, critical failures, and failed case IDs. It
does not print document content, prompts, or patient values. The checked-in
judge configuration contains the label-to-rubric mapping and per-rubric rate.

## Blocking rules

- Every rubric must reach at least 95%.
- A regression greater than five percentage points from the checked-in baseline
  fails the gate.
- Critical safety failures and no-PHI-in-logs failures have zero tolerance.
- The gate exits nonzero on failure.

## Mutation proof

```text
npm run eval:gate --prefix agentforge -- --inject-defect
```

This intentionally removes one extraction citation. The command must exit
nonzero and report the failed case, proving the gate blocks a regression rather
than merely warning.

Baseline evidence is checked in at
`docs/agentforge/evidence/W2_BASELINE_REPORT.json`. The corpus and evaluator
are implemented at `agentforge/src/w2RegressionGate.js`; tests cover the
baseline, threshold, mutation, and redaction seams.
