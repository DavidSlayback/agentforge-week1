# AgentForge local AFK stack

**Mode:** local AFK execution with user-authorized Railway deployment mirror; no PR or merge opened. GitLab remains the issue/source-of-record.
**Base branch:** `davidslayback/agentforge-checkpoint`  
**Base commit:** `1711f73d405fc774d205530923b2c87920a1914a`  
**Budget:** one active lane, one repair attempt, targeted tests before repository suites; stop before final external readback or publication.

| Ticket | Branch | Base | State | Commit | PR/push |
| --- | --- | --- | --- | --- | --- |
| AF-01 | n/a | base | VERIFIED (approval recorded) | n/a | none |
| AF-03 | `afk/AF-03-conversation` | `1711f73d405fc774d205530923b2c87920a1914a` | VERIFIED | `c4c96c2` | local only |
| AF-05 | `afk/AF-05-contracts` | `6dbbac8` | VERIFIED | `8bf030a` | local only |
| AF-04 | `afk/AF-04-safety-ui` | `36d3036` | VERIFIED | `de3430b` | local only |
| AF-02 | Railway deployment | `f180796` | VERIFIED | `agentforge-week1-production.up.railway.app` | external deployment; no PR/merge |
| AF-06 | `afk/AF-06-evaluator-surface` | `f250daa` | VERIFIED | `e80ed6d` | pushed to GitHub mirror for Railway; no PR/merge |
| AF-08 foundation | `afk/AF-08-resilience-foundation` | `297c10a` | LIVE/TESTED — ready for owner sign-off | `9eaa480` plus local evidence updates | local branch only; Railway active deployment `e133a557-9315-4872-af01-5dda1c4e26a6`, attached volume; no PR/merge |
| AF-09–AF-12 continuation | `afk/AF-08-resilience-foundation` | `58520f9` | LOCAL IMPLEMENTED/MEASURED — synthetic only | `6d40adc` plus current local changes | local branch only; no PR/merge |
| AF-13–AF-15 release path | same branch | current local candidate | PACKAGE READY; external readback/rehearsal pending | evidence/docs in progress | local draft; no publication |
| AF-16–AF-17 closure path | same branch | `dcdae5b` / Vultr image `sha256:49f5915f...` | DOC and deployed scale evidence ready for owner review | local tickets/evidence plus current Vultr readback | direct deployment; no push/PR/merge |
| AF-18–AF-19 closure path | same branch | current Vultr candidate | billing, trusted HTTPS, and final owner readback blocked | local only | no publication |

AF-02, AF-06, and AF-07 are externally verified at `https://agentforge-week1-production.up.railway.app`; AF-07 is closed in GitLab #8. AF-08 is signed off in GitLab #9. AF-09 through AF-12 are local synthetic implementation/evidence. AF-16 and AF-17 now have current local/deployed evidence; AF-18–AF-19 remain the billing, trusted-HTTPS, and final current-commit readback gates. No independent reviewer is assumed; owner verification is the applicable gate.
