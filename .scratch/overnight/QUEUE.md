# AgentForge AFK queue — approved, local-only execution

**Planning state:** `READY` for approved AFK tickets only. Local edits/commits are allowed; pushes, PRs, and merges are forbidden for this run.

Parent: GitLab #1. Child issues are published and linked below.

| ID | GitLab | Type | Status | Blocked by | Wave | Critical path | Verifier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AF-01 | [#2](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/2) | HITL | VERIFIED | None | 0 | Yes | Requirements/evidence reviewer |
| AF-02 | [#3](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/3) | HITL | blocked | AF-01 | 1 | Yes | External route/TLS verifier |
| AF-03 | [#4](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/4) | AFK | VERIFIED | AF-01 | 1 | Yes | Node service/UI-flow tests |
| AF-04 | [#5](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/5) | AFK | blocked | AF-03 | 2 | Yes | Safety-state test matrix |
| AF-05 | [#6](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/6) | AFK | VERIFIED | AF-01 | 1 | Yes | Contract/eval test runner |
| AF-06 | [#7](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/7) | AFK | blocked | AF-02, AF-05 | 2 | Yes | Fresh-profile route/link walk |
| AF-07 | [#8](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/8) | HITL | blocked | AF-02, AF-03, AF-04, AF-05, AF-06 | 3 | Yes | External release verifier |
| AF-08 | [#9](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/9) | HITL | blocked | AF-01, AF-07 | 4 | Yes | Privacy/security reviewer |
| AF-09 | [#10](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/10) | HITL | blocked | AF-08, AF-07 | 5 | Yes | Auth/parity integration verifier |
| AF-10 | [#11](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/11) | HITL | blocked | AF-08, AF-09 | 6 | Yes | Provider failure/eval verifier |
| AF-11 | [#12](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/12) | HITL | blocked | AF-08, AF-09, AF-10 | 7 | Yes | Operations/alert/recovery verifier |
| AF-12 | [#13](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/13) | HITL | blocked | AF-09, AF-10, AF-11 | 8 | Yes | Independent load/cost reviewer |
| AF-13 | [#14](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/14) | HITL | blocked | AF-09, AF-10, AF-11, AF-12 | 9 | Yes | Clean-profile release verifier |
| AF-14 | [#15](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/15) | HITL | blocked | AF-13 | 10 | Yes | Interview rehearsal reviewer |
| AF-15 | [#16](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/16) | HITL | blocked | AF-13, AF-14 | 11 | Yes* | External-communication reviewer |

## First frontier

- AF-03 and AF-05 are READY after AF-01 was approved for this local run.
- AF-02 remains HITL and blocks AF-06/AF-07, but does not block AF-03 or AF-05.

`*` AF-15 is on the complete-brief critical path but is not a prerequisite for implementation or technical release; publication remains optional and explicitly authorized.

Current stop: AF-02 is the next HITL deployment gate; AF-04 is also blocked until the UI safety-state verifier boundary is approved. No further AFK ticket is eligible under this run's budget.

## Harness rule

Do not dispatch AFK work past a HITL blocker. After each local ticket, refresh this queue and its evidence; do not advance into AF-02 or later HITL work without the required human/external boundary.
