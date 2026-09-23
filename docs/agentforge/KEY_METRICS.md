# AgentForge success metrics

> These definitions were written for the Week 1 checkpoint. They are not W2
> measurements. The current W2 text-fixture gate is implementation evidence;
> W2 extraction accuracy, retrieval relevance/cost, latency, and deployment
> metrics remain unmeasured. Reconcile these definitions with the W2 rubric and
> report actual values before the Sunday final.

These are measurement definitions, not claims about production performance.
Checkpoint measurements use synthetic fixtures and deterministic provider runs.

| Metric | Definition | Checkpoint use | Final target-setting path |
| --- | --- | --- | --- |
| Grounded-claim rate | Displayed claims with patient-matched source evidence / displayed claims | Critical eval oracle | Expand corpus, review false positives, set release threshold |
| Patient-isolation rate | Requests with zero cross-patient claims or context leaks | Critical eval oracle | Add multi-user/session and adversarial cases |
| Qualified-partial correctness | Partial/failed coverage cases that qualify dependent claims and withhold them | Critical eval oracle | Compare against clinician-reviewed expected outcomes |
| Discrepancy correctness | Conflicts withheld unless explicit later resolution is documented | Critical eval oracle | Add temporal and resolution fixtures |
| Verification-before-display rate | Responses displayed only after a passed verification result | Service trace invariant | Alert on any bypass or missing outcome |
| Briefing latency | End-to-end trace duration; report p50/p95/p99 | Dashboard and deployed smoke evidence | Measure at 10 and 50 concurrent users |
| Retrieval reliability | Failed/timeout/unauthorized retrieval groups and retry counts | Trace and metrics dashboard | Set thresholds after load and adapter measurements |
| Clinician utility | Compactness, useful evidence links, and follow-up usefulness | Manual demo review | Structured clinician evaluation before final |

The checkpoint gate prioritizes safety metrics over response fluency. A single
critical failure blocks the evaluation run even when aggregate quality looks
good.
