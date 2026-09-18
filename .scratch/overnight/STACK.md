# AgentForge local AFK stack

**Mode:** local AFK execution with user-authorized Railway deployment mirror; no PR or merge opened. GitLab remains the issue/source-of-record.
**Base branch:** `davidslayback/agentforge-checkpoint`  
**Base commit:** `1711f73d405fc774d205530923b2c87920a1914a`  
**Budget:** resumed phase: one AFK implementation ticket (AF-06), one active lane, one repair attempt, targeted tests before repository suites, stop at the next HITL boundary.

| Ticket | Branch | Base | State | Commit | PR/push |
| --- | --- | --- | --- | --- | --- |
| AF-01 | n/a | base | VERIFIED (approval recorded) | n/a | none |
| AF-03 | `afk/AF-03-conversation` | `1711f73d405fc774d205530923b2c87920a1914a` | VERIFIED | `c4c96c2` | local only |
| AF-05 | `afk/AF-05-contracts` | `6dbbac8` | VERIFIED | `8bf030a` | local only |
| AF-04 | `afk/AF-04-safety-ui` | `36d3036` | VERIFIED | `de3430b` | local only |
| AF-02 | Railway deployment | `f180796` | VERIFIED | `agentforge-week1-production.up.railway.app` | external deployment; no PR/merge |
| AF-06 | `afk/AF-06-evaluator-surface` | `f250daa` | VERIFIED | `e80ed6d` | pushed to GitHub mirror for Railway; no PR/merge |

AF-02, AF-06, and AF-07 are externally verified at `https://agentforge-week1-production.up.railway.app`; AF-07 is closed in GitLab #8. AF-08 is the current HITL privacy/security gate. Do not start later tickets.
