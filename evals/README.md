# AgentForge golden evaluations

Run `node evals/lib/runner.js` from the repository root for the deterministic
reference suite. With AgentForge running, use
`node evals/lib/runner.js --service http://127.0.0.1:8787` to send every case
through the actual service before applying the same independent oracles. Both
modes exit non-zero for any gate failure. A response JSON file may be passed as
the first argument to evaluate an externally captured implementation output.

The fixture corpus is intentionally small but extensible: add a case with
patient-scoped records, retrieval coverage, expected qualification, and
withheld fields, then add an oracle only when the behavior is safety-critical.
The critical gate currently covers patient mixing, unauthorized briefing,
unsupported claims, discrepancy resolution, unqualified partial results, and
write-capable behavior. Unit tests exercise each critical oracle failure path.
