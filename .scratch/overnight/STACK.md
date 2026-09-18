# AgentForge local AFK stack

**Mode:** local-only; no push, PR, or merge authorized.  
**Base branch:** `davidslayback/agentforge-checkpoint`  
**Base commit:** `1711f73d405fc774d205530923b2c87920a1914a`  
**Budget:** maximum 2 AFK implementation tickets, one active lane, one repair attempt per ticket, targeted tests before repository suites, stop at the next HITL boundary.

| Ticket | Branch | Base | State | Commit | PR/push |
| --- | --- | --- | --- | --- | --- |
| AF-01 | n/a | base | VERIFIED (approval recorded) | n/a | none |
| AF-03 | `afk/AF-03-conversation` | `1711f73d405fc774d205530923b2c87920a1914a` | VERIFIED | `c4c96c2` | local only |
| AF-05 | `afk/AF-05-contracts` | `6dbbac8` | VERIFIED | `8bf030a` | local only |

AF-02 is HITL and blocks AF-06/AF-07 but does not block AF-03 or AF-05. The two AFK tickets share contract/service surfaces enough to use one active implementation lane and serial local integration.
