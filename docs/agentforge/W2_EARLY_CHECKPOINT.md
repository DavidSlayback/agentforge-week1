# W2 early checkpoint package

Status: conditionally ready for local review; deployment and recording remain
owner-gated. This package is synthetic-only and does not authorize PHI, live
clinical records, clinical writeback, public sharing, or submission.

## Local service

From the repository root:

```powershell
$env:PORT='8787'
$env:AGENTFORGE_DEMO_SECRET='synthetic-test-secret'
$env:AGENTFORGE_SYNTHETIC_CONTEXT='true'
$env:AGENTFORGE_PROVIDER_MODE='deterministic'
npm.cmd start --prefix agentforge
```

The service is the Node application at `agentforge/src/server.js`. It uses the
synthetic fixture corpus under `docs/agentforge/fixtures/` and the local
redacted trace sink. The deterministic provider is intentional for a
reproducible local checkpoint.

## Browser runbook

Open `http://127.0.0.1:8787/` in a clean browser.

1. Leave the default synthetic patient selected and choose **Open prepared
   briefing**.
2. Confirm the authorized synthetic context, documented visit orientation,
   source-record disclosure, and no unsupported action recommendation.
3. Choose **Documented changes**, then **Send follow-up**. Confirm the answer
   identifies the dated medication change and remains source-linked.
4. Open **Evaluator notes** and navigate to `/evals`. Confirm the W2 regression
   card reads `50 cases · 50 passed · 0 failed · PASSED`.
5. Open `/observability`. Confirm the page says synthetic data only and shows
   operational metadata without raw chart text, prompts, or responses.

The source-document form exposes both `Lab PDF` and `Intake form`. API and
contract tests verify their synthetic round-trip, deduplication, citations, and
scope boundaries. A browser file-selection/upload interaction has not been
claimed as complete in this local run; it is the smallest remaining browser
proof for the document-upload portion of the checkpoint.

## Evidence surfaces

- [W2 regression gate](W2_EVAL_GATE.md)
- [W2 baseline report](evidence/W2_BASELINE_REPORT.json)
- `/evals/w2-baseline.json` on the running service
- `/evals` reviewer panel
- `/observability` redacted operations dashboard
- [Jev spike](W2_JEV_SPIKE.md)

## Release boundary

The current local candidate is the repository revision that contains the W2
gate and early-package changes. The prior deployment evidence in
`RELEASE_READINESS.md` is tied to older candidates and must not be relabeled as
current. Deployment, public access, demo-video custody, and external submission
require explicit owner confirmation and fresh readback against one candidate.

