# AgentForge: Clinical Co-Pilot for OpenEMR

**AgentForge** is an embedded document-analysis and retrieval layer for OpenEMR. Week 1 deployed a read-only chart-preparation briefing; Week 2 adds synthetic document analysis with hybrid retrieval and grounded answers.

## Key Resources

- **Plan and progress:** [`docs/agentforge/PLAN.md`](docs/agentforge/PLAN.md)
- **W2 architecture:** [`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md)
- **Key metrics:** [`KEY_METRICS.md`](KEY_METRICS.md) · **Cost and latency:** [`W2_COST_LATENCY.md`](W2_COST_LATENCY.md)
- **Patient dashboard port:** [`PATIENT_DASHBOARD_MIGRATION.md`](PATIENT_DASHBOARD_MIGRATION.md)
- **Week 1 documents:** [`AUDIT.md`](AUDIT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`USERS.md`](USERS.md)
- **Evaluation gate:** [`EVAL_GATE.md`](EVAL_GATE.md)
- **W1 is frozen:** the submitted code is tag `week1-final` (`e4c0721`), and the `/agentforge` route runs the pinned image `agentforge-w1:84f232b`. Neither is updated.

**Original OpenEMR:** https://github.com/Gauntlet-HQ/openemr-base-clean
