# AgentForge execution waves — migrated

| Wave | Lane(s) | Tickets | Parallelism / conflict note |
| --- | --- | --- | --- |
| 0 | release-planning | AF-01 | Serial HITL; establishes the requirements/evidence contract. |
| 1 | deployment; product-ui; contracts | AF-02; AF-03; AF-05 | Parallel after AF-01 in separate branches. AF-02 is external deployment; AF-03 owns conversation UI/service; AF-05 owns contracts. Integrate contracts before consumers and keep deployment serial. |
| 2 | safety-ui; evaluator | AF-04; AF-06 | Separate work is possible, but both touch the evaluator shell; use isolated seams and serial integration AF-04 before AF-06. |
| 3 | release-validation | AF-07 | Serial HITL external-browser gate. |
| 4 | governance | AF-08 | Serial HITL; privacy/provider/provenance boundary. |
| 5 | data-integration | AF-09 | Serial HITL; OpenEMR environment and identity review. |
| 6 | model-lane | AF-10 | Serial HITL; provider and failure-policy review. |
| 7 | operations | AF-11 | Serial HITL; telemetry/dashboard/alert/recovery ownership. |
| 8 | performance-cost | AF-12 | Serial HITL; deployed load and budget evidence. |
| 9 | release | AF-13 | Serial HITL final evidence and sign-off. |
| 10 | interview | AF-14 | Serial HITL rehearsal. |
| 11 | external | AF-15 | Serial HITL; draft may be prepared, publication remains separately authorized. |

## Recommended integration order

AF-01, then AF-02 + AF-03 + AF-05, then AF-04 + AF-06, AF-07, and the governed production chain AF-08 through AF-15.

## Conflict risks

- AF-02/03/04/06 all touch the browser surface; merge in that order or use separate seams and integrate serially.
- AF-05 owns schemas and API examples; other tickets must consume rather than fork contracts.
- AF-08 through AF-12 change environment/configuration and evidence formats; keep each as a separate reviewed gate.
- AF-13 owns final documentation consistency; do not update submission claims from parallel work without re-reading the evidence matrix.

## Migration verifier rule

Each lane must leave the independent-verifier evidence named in its ticket. If a proposed AFK implementation cannot provide its deterministic test path, it returns to planning and is downgraded to HITL; the loop must not infer completion from the implementer's own report.
