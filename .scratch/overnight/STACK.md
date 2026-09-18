# AgentForge local AFK stack

**Mode:** local AFK execution with user-authorized Railway deployment mirror; no PR or merge opened. GitLab remains the issue/source-of-record.
**Base branch:** `davidslayback/agentforge-checkpoint`  
**Base commit:** `1711f73d405fc774d205530923b2c87920a1914a`  
**Budget:** one active resilience lane, one repair attempt, targeted tests before repository suites; stop before claiming AF-08 owner sign-off.

| Ticket | Branch | Base | State | Commit | PR/push |
| --- | --- | --- | --- | --- | --- |
| AF-01 | n/a | base | VERIFIED (approval recorded) | n/a | none |
| AF-03 | `afk/AF-03-conversation` | `1711f73d405fc774d205530923b2c87920a1914a` | VERIFIED | `c4c96c2` | local only |
| AF-05 | `afk/AF-05-contracts` | `6dbbac8` | VERIFIED | `8bf030a` | local only |
| AF-04 | `afk/AF-04-safety-ui` | `36d3036` | VERIFIED | `de3430b` | local only |
| AF-02 | Railway deployment | `f180796` | VERIFIED | `agentforge-week1-production.up.railway.app` | external deployment; no PR/merge |
| AF-06 | `afk/AF-06-evaluator-surface` | `f250daa` | VERIFIED | `e80ed6d` | pushed to GitHub mirror for Railway; no PR/merge |
| AF-08 foundation | `afk/AF-08-resilience-foundation` | `297c10a` | LIVE/TESTED — ready for owner sign-off | `9eaa480` plus local evidence updates | local branch only; Railway active deployment `e133a557-9315-4872-af01-5dda1c4e26a6`, attached volume; no PR/merge |

AF-02, AF-06, and AF-07 are externally verified at `https://agentforge-week1-production.up.railway.app`; AF-07 is closed in GitLab #8. The AF-08 deterministic alert route, rollback/redeploy evidence, alert-trigger readback, and attached-volume persistence are live. AF-08 is ready for owner sign-off; no independent reviewer is assumed for this synthetic checkpoint. Do not start AF-09 until sign-off.
