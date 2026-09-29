# W3 red-team fixes: observed on the public URL

**Deployed W2 SHA:** `40cfbdffcaa77a4ffaf24bcae1ac37c6e402afb1` (MR !127, fix commit `b0a67e70`), deployed 2026-09-29 about 20:32 UTC with `deploy/vultr/deploy.sh` (only `agentforge-w2`). This evidence is valid for that SHA only. Baseline before the fixes: tag `w3-redteam-baseline` = `bfbb1eb2`.

These checks need no access key and print no tokens. Target: `https://dtstest.64.177.10.182.nip.io/agentforge-w2`.

| Finding | Check | Result |
|---|---|---|
| — | `/health` | `{"status":"ok","git_sha":"40cfbdff…"}`, `/ready` 200 |
| F-831d4df407 | `GET /v1/demo-context?patient_uuid=fixture-patient-001`, anonymous and with a wrong key | 401 `demo_access_key_required` (both) |
| F-24b44c5180 | `GET /v1/source-document-context` and `/v1/clinical-action-context`, anonymous and with a wrong key | 401 `demo_access_key_required` (all four) |
| F-6ee92046fb | 20 rapid mints from one client, after the 6 above | 9 × 401, then 11 × 429 with `Retry-After: 60`. The 16th attempt in the window is refused. The limit counts refused-key attempts too. |
| W1 bypass | Mint on frozen W1 `/agentforge/v1/demo-context` (200), then use that token on W2 `/v1/source-documents/…/pages/1.png` | 403 `invalid_demo_context`. On `bfbb1eb2` the same probe got 404 `DOCUMENT_NOT_FOUND`: the token was accepted. |
| UI | Public page HTML | contains the "Evaluator access code" form |

Not observed by the agent on the public URL: the keyed path (a 200 mint with the real key), because the agent does not hold the key. It is covered by `test/mint-guard.test.js` and the local browser check (`PLAN.md`, W3 section).

Deliberate regressions: `W3-redteam-fixes-regression.txt`.

## Open mode for grading: `da7451d1` (deployed 2026-09-29 about 20:52 UTC)

The owner switched the key off ("Switch the code off"): the final W2 submission names no key. MR !129 adds `AGENTFORGE_DEMO_ACCESS=open`, set in W2 compose.

| Check | Result |
|---|---|
| `/health`, `/ready` | `da7451d1…`, 200 |
| Public page | no "Evaluator access code" field |
| Anonymous mints on all three routes | 200 (F-831d4df407 and F-24b44c5180 are accepted risks while open) |
| 20 rapid mints from one client | 12 × 200, then 8 × 429 with `Retry-After: 60` (F-6ee92046fb still fixed; 3 mints were spent just before) |
| W1-minted token on W2 | 403 `invalid_demo_context` (bypass still closed) |
| Deployed Bruno (`--env deployed`) | 28/28 requests, 64/64 assertions, 19/19 tests |
