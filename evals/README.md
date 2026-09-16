# AgentForge golden evaluations

Run `node evals/lib/runner.js` from the repository root. The runner loads the
seven synthetic fixtures, evaluates deterministic reference responses, and
exits non-zero for any safety-gate failure. A response JSON file may be passed
as the first argument to evaluate an implementation output.
