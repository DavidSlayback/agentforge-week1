# Requirements from the supplied brief

Source: Week 1 - AgentForge.pdf, 13 pages, supplied by David on September 16, 2026. References are PDF page numbers. This inventory is not completion evidence.

## Product and prerequisites

| Requirement | Source | Evidence needed |
| --- | --- | --- |
| Clinical Co-Pilot embedded in OpenEMR, grounded in the selected patient's chart | pp. 2, 4, 7 | Live embedded workflow and demo patient data |
| Start from Gauntlet-HQ/openemr-base-clean | p. 4 | Source baseline, provenance, and license |
| Run locally with sample patient data | p. 5 | Reproducible setup and observed working system |
| Publicly reachable deployed app with working agent for early and final | pp. 4-5, 9 | Deployment URL and live demonstration; reachability does not imply anonymous record access |
| Complete audit before building AI layer | pp. 4-6 | AUDIT.md: security, performance, architecture, data quality, compliance; about 500 words of key findings first |
| Narrow user and workflow; justify agent for each use case | p. 6 | USERS.md and capability-to-use-case traceability |
| Integration plan derived from audit and users | pp. 6-7 | ARCHITECTURE.md with about 500 words summarizing architecture and tradeoffs first |
| Defensible product success measures | p. 3 | KEY_METRICS.md with rationale |
| Demo data only | p. 3 | Synthetic/demo fixtures throughout |

## Agent and engineering requirements

| Requirement | Source | Evidence needed |
| --- | --- | --- |
| Multi-turn conversation and tool use justified by use cases | p. 7 | Context-preserving follow-up workflow |
| Verify every response before display | p. 7 | Source attribution, domain constraint enforcement, documented limitations |
| Enforce requester authorization | pp. 2-3, 8 | Allowed/denied access scenarios and multi-user boundaries |
| Predictable failures and partial-data behavior | pp. 3-4, 8 | Tool failure, incomplete data, malformed-output evaluations |
| Evaluations exercise boundaries, invariants, or regression risks | p. 8 | Dataset, pass/fail definitions, results, and failure mode per case |
| Correlation ID across logs, tools, and LLM calls | p. 8 | Reconstructable invocation trace |
| Canonical strict tool input/output contracts | p. 8 | Validated schemas as implementation source of truth |
| Real observability from the start | pp. 7-8 | Step ordering/timing, failures, tokens, cost from actual runs |
| Live dashboard | p. 8 | Requests, errors, p50/p95 latency, tools, retries, verification outcomes; account for queue depth named in heading |
| Runnable API collection | p. 8 | Core workflows executable without reading source |
| Separate /health and /ready | p. 8 | Readiness checks OpenEMR, LLM provider, observability dependencies |
| At least three alerts with response guidance | p. 8 | p95 latency, error rate, tool-failure thresholds and responses |
| Deployed load tests at 10 and 50 concurrent users | p. 9 | p50/p95/p99 latency and error rate at each level |
| Infrastructure baselines | p. 9 | CPU, memory, latency, throughput under load |
| Cost analysis | p. 9 | Actual development spend and projections for 100 / 1K / 10K / 100K users, including architectural changes |

## Submission

- Early: Wednesday 11:59 PM Central; deployed agent, evaluation framework, observability, and 3-5 minute demo (pp. 4, 9). David confirms September 16, 2026.
- Technical interview: Thursday/Friday; defend audit, architecture, verification, evaluations, scaling, and failures (pp. 4, 9-10).
- Final: Sunday noon Central; production-ready agent, demo, social post (pp. 4, 9).
- Repository needs setup guide, architecture overview, and deployment link (p. 9).
- Submission, social posting, interview scheduling, and external messaging are not authorized merely by this brief.

## Ambiguities

1. Page 6 mandates USERS.md; page 9 lists USER.md. Proposed accommodation: canonical USERS.md and a short USER.md pointer.
2. Page 4 requires an AI interview within 24 hours of both submissions; page 9 labels it final-only. Track both until clarified.
3. Engineering requirements are mandatory but not phased by checkpoint. Keep all visible in today's acceptance planning; do not silently defer them.
4. The brief requests a fork; David requires privacy. Preserve the source commit and attribution outside the public fork network. Literal fork-network membership as a grading requirement is unverified.
5. The assumed BAA establishes neither actual contractual coverage nor real-world compliance.
