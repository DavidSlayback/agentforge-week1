# Bruno collection, deployed run on the re-freeze

- SHA: `ee036f38c95a8b6029d8fbe8cb7c8c6b2126d701` (both /agentforge-w2 and /dashboard health), 2026-09-27T09:01:17Z.
- Command: `cd agentforge/api/bruno && npx @usebruno/cli run --env deployed`
- Result: 27 requests (27 passed), 64/64 assertions.
- The first run on this SHA failed one request: W1 `/agentforge/ready` reported `model: not_ready` (its live model probe). Three immediate re-probes returned 200, and this re-run passed.
