# AgentForge dependency DAG

`A -> B` means B cannot start until A is verified.

```text
AF-01
├──> AF-02 ───────────────┐
├──> AF-03 ──> AF-04 ─────┤
└──> AF-05 ──> AF-06 ─────┤
                           v
                         AF-07
                           v
                         AF-08
                           v
                         AF-09
                           v
                         AF-10
                           v
                         AF-11
                           v
                         AF-12
                           v
                         AF-13 ──> AF-16 ──> AF-17 ──> AF-18 ──> AF-19 ──> AF-14 ──> AF-15
```

## Edge reasons

- AF-01 -> AF-02: the public URL and deployment contract must match the agreed requirements/evidence boundary.
- AF-01 -> AF-03: the interaction must stay within the approved workflow and use-case contract.
- AF-01 -> AF-05: the complete brief defines the release-critical schemas and runnable probes.
- AF-03 -> AF-04: safety states must attach to the real transcript/follow-up behavior.
- AF-02 -> AF-06: evaluator links must target the canonical deployed origin.
- AF-05 -> AF-06: evaluator probes must use the canonical routes and schemas.
- AF-02/03/04/05/06 -> AF-07: the external checkpoint gate needs all visible and probeable surfaces together.
- AF-01/07 -> AF-08: widening the trust boundary requires the checkpoint baseline and full-brief decisions.
- AF-08/07 -> AF-09: OpenEMR integration requires approved data/identity/rollback controls and the synthetic contract as parity baseline.
- AF-08/09 -> AF-10: the model lane must be approved for the governed retrieval and data boundary.
- AF-08/09/10 -> AF-11: durable operational signals must represent the final trust and provider paths.
- AF-09/10/11 -> AF-12: load/cost measurements depend on the actual governed dependencies and telemetry.
- AF-09/10/11/12 -> AF-13: final claims require complete production-path and evidence coverage.
- AF-13 -> AF-16: final package language is the input to contract/source closure.
- AF-12/13/16 -> AF-17: deployed scale evidence requires the stable harness and reconciled claims.
- AF-17 -> AF-18: cost projections must use the measured deployment shape and resource assumptions.
- AF-16/17/18 -> AF-19: final readback cannot freeze claims before contract, deployed, and cost evidence are complete.
- AF-19 -> AF-14: interview answers must match the final current-commit artifact.
- AF-19/14 -> AF-15: external communication must use the final approved evidence and narrative.

## Critical path

AF-01 -> AF-03 -> AF-04 -> AF-07 -> AF-08 -> AF-09 -> AF-10 -> AF-11 -> AF-12 -> AF-13 -> AF-16 -> AF-17 -> AF-18 -> AF-19 -> AF-14 -> AF-15.

The deployment and contract lanes can run in parallel with the conversation lane after AF-01, but the early gate waits for all of them. AF-02 -> AF-06 -> AF-07 and AF-05 -> AF-06 are the parallel checkpoint branches; AF-04 and AF-06 may be developed separately but require serial UI integration because they touch the same evaluator shell.

## Verification dependency

Every edge also carries an evidence handoff: the downstream owner verifier must inspect the predecessor's recorded evidence, not only its issue state. A passing local test cannot satisfy AF-02, AF-07, AF-08, AF-11, AF-12, AF-13, AF-14, AF-15, AF-17, or AF-19 without the listed external/runtime/human evidence.
