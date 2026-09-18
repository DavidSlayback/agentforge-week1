# AgentForge AFK queue — approved execution

**Planning state:** `HITL_REVIEW` at AF-16/AF-17 with AF-18 billing readback next. AF-08 owner sign-off is recorded in GitLab #9; no PR or merge was opened. GitLab remains the issue/source-of-record.

Parent: GitLab #1. Child issues are published and linked below.

| ID | GitLab | Type | Status | Blocked by | Wave | Critical path | Verifier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AF-01 | [#2](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/2) | HITL | VERIFIED | None | 0 | Yes | Requirements/evidence reviewer |
| AF-02 | [#3](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/3) | HITL | VERIFIED | AF-01 | 1 | Yes | External route/TLS verifier |
| AF-03 | [#4](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/4) | AFK | VERIFIED | AF-01 | 1 | Yes | Node service/UI-flow tests |
| AF-04 | [#5](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/5) | AFK | VERIFIED | AF-03 | 2 | Yes | Safety-state test matrix |
| AF-05 | [#6](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/6) | AFK | VERIFIED | AF-01 | 1 | Yes | Contract/eval test runner |
| AF-06 | [#7](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/7) | AFK | VERIFIED | AF-02, AF-05 | 2 | Yes | Fresh-profile route/link walk |
| AF-07 | [#8](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/8) | HITL | VERIFIED | AF-02, AF-03, AF-04, AF-05, AF-06 | 3 | Yes | External release verifier |
| AF-08 | [#9](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/9) | HITL | VERIFIED | AF-01, AF-07 | 4 | Yes | Owner sign-off/evidence verifier |
| AF-09 | [#10](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/10) | HITL | IMPLEMENTED-SYNTHETIC | AF-08, AF-07 | 5 | Yes | Owner auth/parity verifier |
| AF-10 | [#11](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/11) | HITL | IMPLEMENTED-READY | AF-08, AF-09 | 6 | Yes | Owner provider/failure verifier |
| AF-11 | [#12](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/12) | HITL | IMPLEMENTED-SYNTHETIC | AF-08, AF-09, AF-10 | 7 | Yes | Owner operations verifier |
| AF-12 | [#13](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/13) | HITL | MEASURED-LOCAL | AF-09, AF-10, AF-11 | 8 | Yes | Owner load/cost verifier |
| AF-13 | [#14](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/14) | HITL | READY-PENDING-EXTERNAL | AF-09, AF-10, AF-11, AF-12 | 9 | Yes | Owner clean-profile release verifier |
| AF-14 | [#15](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/15) | HITL | DRAFT-READY | AF-19 | 10 | Yes | Owner interview rehearsal |
| AF-15 | [#16](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/16) | HITL | LOCAL-DRAFT-NO-PUBLISH | AF-19, AF-14 | 11 | Yes* | Owner communication decision |
| AF-16 | local follow-on | HITL | READY-DOC-CLOSURE | AF-13 | 12 | Yes | Owner contract/claims verifier |
| AF-17 | local follow-on | HITL | READY-DEPLOYED-OWNER-REVIEW | AF-12, AF-13, AF-16 | 13 | Yes | Deployed scale verifier |
| AF-18 | local follow-on | HITL | READY-COST-OWNER-REVIEW | AF-17 | 14 | Yes | Owner cost/architecture verifier |
| AF-19 | local follow-on | HITL | READY-FOR-OWNER-REVIEW | AF-16, AF-17, AF-18 | 15 | Yes | Owner clean-profile release verifier |

## Current frontier

- AF-02, AF-03, AF-04, AF-05, AF-06, and AF-07 are VERIFIED.
- AF-08 is verified. AF-09 through AF-12 have local synthetic implementation/evidence; AF-16 is ready for owner review and AF-17 has current deployed scale evidence ready for owner review.

`*` AF-15 is on the complete-brief critical path but is not a prerequisite for implementation or technical release; publication remains optional and explicitly authorized.

Current frontier: owner review of AF-16/AF-17/AF-18/AF-19, then final submission and publish/no-publish closure. The current candidate is deployed at Vultr at `https://dtstest.64.177.10.182.nip.io/agentforge/`; trusted HTTPS and HTTP redirect are read back.

## Harness rule

Do not auto-publish or infer external verification from local tests. After each ticket, refresh this queue and its evidence; AF-17 and AF-19 remain HITL because deployed scale and clean-browser proof must match the local candidate.
