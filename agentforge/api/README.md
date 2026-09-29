# AgentForge API collection (Bruno)

`agentforge/api/bruno/` is a [Bruno](https://www.usebruno.com/) collection for
every public AgentForge endpoint, in two folders:

- `w1/` against `{{w1BaseUrl}}` (`/agentforge`): health, ready, demo context,
  briefing, follow-up in the same conversation, and three fail-closed checks
  (briefing without a token, follow-up for another patient, malformed request).
- `w2/` against `{{w2BaseUrl}}` (`/agentforge-w2`): health, ready, read and
  write demo contexts, the synthetic scan sample, source-document upload,
  scan-supervisor, scan-form evidence, source preview, a synthetic one-page PDF
  upload and its page image, lab trends, follow-up evidence (and its
  other-patient refusal), a cross-patient scan refusal, traces, metrics,
  alerts, the observability page, and the anonymous-mint check (W3).

Requests chain through collection variables: demo token, then upload (the
`/v1/demo-scan-fixture` synthetic lab sample), then scan of that document,
then the evidence, preview and trend reads. Every request asserts its status
and key fields. Synthetic data only.

## Evaluator access key (W3 security fix)

With `AGENTFORGE_DEMO_ACCESS=key` (the code default), the context mints (`/v1/demo-context`,
`/v1/source-document-context`, `/v1/clinical-action-context`) require
`X-AgentForge-Demo-Key: <key>`, where the key is the service's
`AGENTFORGE_DEMO_ACCESS_KEY`. This fixes W3 findings F-831d4df407 and
F-24b44c5180. The mints share a per-client limit of 15 per 60 s
(F-6ee92046fb).

| Mint response | Meaning |
|---|---|
| `200` | Token issued (`expires_in_seconds: 300`, carries `aud: agentforge-w2`) |
| `401 {"error":"demo_access_key_required"}` | Key missing or wrong |
| `429 {"error":"mint_rate_limited","retry_after_seconds":N}` + `Retry-After: N` | Over the limit. Cache tokens for their lifetime |
| `503 {"error":"demo_access_key_not_configured"}` | The server has no key set |
| `400` / `403` / `404` | Unchanged: bad patient id / live mode / synthetic context off |

All other routes are unchanged. W2 refuses tokens that lack
`aud: agentforge-w2`, including tokens minted by the frozen W1 service at
`/agentforge`, whose mints stay anonymous. The collection sends the key from
the secret environment variable `demoAccessKey`. `w2/20` checks the
anonymous mint against `anonymousMintStatus`: 401 locally (`key` mode), 200 on
the deployment, which runs `AGENTFORGE_DEMO_ACCESS=open` during W2 grading.
In `open` mode the rate limit and the `aud` check still apply.

## Run it

Deployed (`https://dtstest.64.177.10.182.nip.io`):

```bash
cd agentforge/api/bruno
npx @usebruno/cli run --env deployed
```

Tested with `@usebruno/cli` 4.2.0 (`npx @usebruno/cli@4.2.0 run --env deployed`
pins it). The run exits non-zero on any failed assertion. Add
`--reporter-json <file>` to keep the per-request report.

Cost: the deployed run makes one `POST /v1/scan-supervisor` call (about
$0.0006 in model calls, W2_COST_LATENCY.md) and one W1 briefing with a
`case_id`, which forces one fresh briefing synthesis. It stores two synthetic
documents for `fixture-patient-001` in OpenEMR; re-runs are deduplicated by
content hash.

Local, against a server started from this checkout (deterministic provider, no
model calls, in-memory synthetic persistence):

```bash
node agentforge/scripts/run-bruno-local.mjs
```

It writes a summary (names, statuses and assertion counts, no bodies or
tokens) to `docs/agentforge/evidence/bruno/<sha>-local.json`. Locally the page
image request accepts `503 ocr_runtime_unavailable` when `pdftoppm` is not
installed (`pageImageExpectation` in `environments/local.bru`); the deployed
environment requires a PNG.

To point the local environment at a server you started yourself:

```bash
cd agentforge/api/bruno
npx @usebruno/cli run --env local --env-var w1BaseUrl=http://127.0.0.1:8787 --env-var w2BaseUrl=http://127.0.0.1:8787
```

The server needs `AGENTFORGE_SYNTHETIC_CONTEXT=true`, an
`AGENTFORGE_DEMO_SECRET` and an `AGENTFORGE_DEMO_ACCESS_KEY`; pass the same key
as `--env-var demoAccessKey=<key>`. `run-bruno-local.mjs` does both.

`agentforge/api/collection.ps1`, the Week 1 PowerShell script, is removed; this
collection supersedes it. Its readiness-failure probe (`-ExpectNotReady`) has
no Bruno equivalent; `/ready` answering 503 is covered by
`agentforge/test/live-chart-http.test.js` and `observability/test/`.
