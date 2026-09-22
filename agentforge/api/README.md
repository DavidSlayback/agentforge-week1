# AgentForge API collection

Run the collection against a local service or the configured same-origin base path:

```powershell
$env:AGENTFORGE_BASE_URL = 'http://127.0.0.1:8787'
powershell -NoProfile -ExecutionPolicy Bypass -File agentforge/api/collection.ps1
```

The normal run exercises health, ready, complete briefing, partial briefing,
follow-up continuity, denied authorization, cross-patient blocking, malformed
request rejection, metrics, traces, deterministic alerts, and observability. It
prints a compact JSON result and exits non-zero on any unexpected status or
selected response invariant. Full response-shape validation remains owned by
the service contract tests.

To exercise readiness failure, start the service with an unconfigured provider
(`AGENTFORGE_MODEL_ENDPOINT` set but no API key), then run:

```powershell
$env:AGENTFORGE_BASE_URL = 'http://127.0.0.1:8787'
powershell -NoProfile -ExecutionPolicy Bypass -File agentforge/api/collection.ps1 -ExpectNotReady
```

The failure probe expects `/ready` to return 503 with `status: not_ready` and
does not call the agent while the dependency is unavailable.
