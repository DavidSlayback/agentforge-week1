# W3 remediation record

What was fixed after the W3 red-team platform (`agentforge-redteam`,
`docs/findings/`) found seven issues in `/agentforge-w2`, and how. This is a
record, not a plan: the plan is `PLAN.md` ("W3 red-team fixes"). Synthetic data
only. Owner constraints held throughout: no `AGENTFORGE_DEMO_ACCESS=key` gate or
any other key or password friction on the mints, minimal security-focused
changes, no change to W2 grading behavior.

Baseline build under test: `da7451d1` (`/health` before this work). Code commit:
`8ef9761e`. Deploy status: see "Deploy and live check" at the end (deployed
from an unmerged branch as `926805ce`; not on `main`).

| Finding | Severity | Disposition | Commit |
|---|---|---|---|
| F-6ee92046fb missing mint rate limit | medium | fixed earlier (`40cfbdff`, MR !127); present and deployed, verified, kept | `40cfbdff` (earlier), unchanged here |
| F-990345a00f off-condition guideline evidence | high | fixed | `8ef9761e` |
| F-ca9486ff1b internal metadata disclosure | medium | fixed for `/v1/follow-up-evidence`; partly fixed for `/v1/scan-supervisor` (see below) | `8ef9761e` |
| F-30da6790d1 patient enumeration via the mint | medium | fixed (provisioned-only issuance, one uniform 400); residual noted | `8ef9761e` |
| F-e5d47ab7ea contradictory chart values | medium | fixed | `8ef9761e` |
| F-831d4df407 anonymous read mint | critical | risk-accepted (owner), compensating controls verified | none (no change) |
| F-24b44c5180 anonymous write mint | critical | risk-accepted (owner), compensating controls verified | none (no change) |

## F-6ee92046fb: rate limit on the mints (kept)

- **Root cause (original):** `/v1/demo-context` and its siblings answered every
  request from every client.
- **Control (already shipped, unchanged here):** `mintGuard.js#createMintRateLimiter`,
  applied by `server.js#mintRefused` to all three mints before any other check.
  Default 15 per 60 s per client; over the limit returns `429` with `Retry-After`.
  Client is the rightmost `X-Forwarded-For` entry (Caddy writes it), enabled by
  `AGENTFORGE_TRUST_PROXY=true`.
- **Verified present:** in the source on the deployed `da7451d1` and on this
  branch; in `deploy/vultr/docker-compose.yml` (`AGENTFORGE_MINT_RATE_LIMIT`,
  `..._WINDOW_SECONDS`, `AGENTFORGE_TRUST_PROXY`); in the running `agentforge-w2`
  container's environment (15 / 60 / true); tests `mint-guard.test.js`.
- **Live re-check:** listed in "Deploy and live check"; not yet recorded for the deployed `926805ce`.

## F-990345a00f: guideline evidence presented as applicable (LLM09)

- **Root cause:** `service.js#retrieveFollowUpEvidence` set `qualification.required`
  only from retrieval sufficiency (failed chart groups, withheld fields, guideline
  status). Nothing compared the question or the evidence with the patient's
  conditions, so a question about diabetes on a hypertension-only chart returned
  A1C guidance with `required: false`.
- **Change:** new `src/evidenceApplicability.js#conditionsNotInChart`. It reads
  only the question and the returned chart facts. If the question names a
  condition from a fixed list (diabetes, atrial fibrillation, cancer, asthma,
  heart failure, kidney disease, lipid disorder, hypertension, anemia) and no chart
  fact documents it, `retrieveFollowUpEvidence` sets `qualification.required: true`
  with `condition_not_in_chart:<condition>`. The question side names the condition
  itself (so "what does an A1C measure" or "blood pressure" is not flagged). The
  evidence is still returned, now qualified, not withheld.
- **Tests:** `test/w3-remediation.test.js` (four off-condition questions over HTTP
  on the real server, an on-condition control, unit cases). Sabotage check: with the
  call removed the HTTP test fails.
- **Not done (deferred):** guideline-internal population limits, such as the
  statin recommendation for adults 76 and older, are not modeled. Applicability
  is by named condition only. A question that names no condition from the list is
  unchanged.

## F-e5d47ab7ea: two active values for one field (LLM09)

- **Root cause:** `patient_facts` returned every historical record. A field
  recorded twice (`medication.lisinopril.dose`: 5 mg on 2026-08-13, 10 mg on
  2026-09-10) appeared with no marker for the current one.
- **Change:** `evidenceApplicability.js#markCurrentFacts`, used only by
  `/v1/follow-up-evidence`. Each fact gets `current: true|false`: the latest
  `recorded_at` per field is current, earlier values are history. If the latest
  value cannot be identified (same timestamp, different values, as in
  `fixture-patient-002`'s two metformin doses; or a missing timestamp), no fact of
  that field is marked and the response is qualified with
  `field_history_unresolved:<field>`. It never guesses.
- **Tests:** `w3-remediation.test.js` (HTTP on patient 001 and 002, units for tie
  and undated). Sabotage check: with the marking removed both fail.

## F-ca9486ff1b: internal metadata in responses (API3 / LLM02)

- **Root cause:** the service result carries internal telemetry for traces
  (`retrieval.guideline_provider`, `retrieval.guideline_usage` with provider,
  model, token and cost, `workflow_version`, `ocr_mode`, OpenEMR `document_uuid`),
  and `server.js` sent the whole object to the client.
- **Change:** new `src/clientResponse.js`, applied at the HTTP boundary only (the
  service result and traces are unchanged). `/v1/follow-up-evidence` loses
  `retrieval.guideline_provider` and `retrieval.guideline_usage`.
  `/v1/scan-supervisor` loses `workflow.workflow_version`, `workflow.ocr_mode`,
  `document_uuid` and `derived_document_uuid` at any depth. `test/live-chart-http.test.js`
  used the provider name as a proxy for "no model call"; it now asserts the name is
  absent (the model request count, which was the real proof, is unchanged).
- **Tests:** `w3-remediation.test.js` scans the whole response body for the
  oracle's signature strings (`guideline_provider`, `guideline_usage`,
  `gemini-embedding`, `persistence_boundary`, `document_uuid`, `source_system`,
  `workflow_version`, `ocr_mode`) on follow-up-evidence, and for the removed
  scan-supervisor fields on scan-supervisor. Sabotage check: with the strip removed
  both fail.
- **Deferred on purpose (scan-supervisor), with reasons:**
  - `openemr.document_id`, `derived_document_id`, `procedure_order_id`,
    `observation_ids`: the W2 OpenEMR round-trip proof requires them
    (`w2-openemr-smoke.mjs`, `w2-live-acceptance.mjs`, `openemr-module-roundtrip.test.js`).
    Removing them would change W2 grading evidence.
  - `workflow.handoffs` and `extraction.provider`: the page's worker trail reads
    them (`ui.js`), and the W2 extension gate asserts them.
  - `persistence_boundary` and `source_system`: `AGENTS.md` requires a simulation
    to be named as one in API output (`in-memory-synthetic`).
  - Guideline `sparse_score`, `dense_score`, `rerank_score`, `degraded`: retrieval
    scores that name no provider or model; the page shows them.
  If the owner wants those gone too, it is a W2 product decision, not a security
  patch; report as needs-decision.

## F-30da6790d1: patient enumeration through the mint (API1 / API3)

- **Root cause:** the three mints accepted any `fixture-patient-NNN` (regex only),
  so a token could be minted for an id with no chart. The data route then answered
  200 for real patients and 404 for others, which maps the namespace.
- **Change:** `server.js#provisionedSyntheticPatient`. A mint issues a token only
  for a patient the synthetic chart provisions (`fixture-patient-001` to `-008`
  and `-dup`, read from the fixture adapter). Every other id, well-formed or not,
  gets the same `400 invalid_synthetic_patient`. The rate limit is still counted
  first. No key, no prompt, no change for a physician using a demo patient.
- **Tests:** `w3-remediation.test.js` (all three mints; unknown, malformed and empty
  ids give identical status and body; provisioned ids still 200). Sabotage check: with
  the check loosened the test fails.
- **Residual (honest):** the roster of provisioned demo patients is public by design
  (the page lists them), so "which of the 8 demo ids exist" is still observable. What
  is closed is minting for, and probing, ids outside the roster. The harness check
  for this finding passes on a `400`.

## F-831d4df407 and F-24b44c5180: anonymous read and write mints (critical)

**Disposition: risk-accepted, owner decision (2026-09-29). No code change.** The
only known complete fix is the evaluator key gate, which the owner rejected
permanently as bad physician experience. It is not reintroduced. Compensating
controls, each checked on the code and the running deployment:

| Control | Where | Verified |
|---|---|---|
| Per-client mint rate limit, 15 / 60 s, shared by all three mints, `429` + `Retry-After` | `mintGuard.js`, `server.js#mintRefused`, compose | source, compose, running container env, `mint-guard.test.js`; deployed in `926805ce`; live burst re-check not recorded |
| `aud: agentforge-w2` on every minted token; W2 refuses `synthetic-demo` tokens without it (closes the frozen W1 service's anonymous mint) | `server.js` `requestContext`/`verifyContextToken`, `W2_TOKEN_AUDIENCE` | source, `mint-guard.test.js` "W1 bypass"; deployed in `926805ce`; live re-check not recorded |
| Short TTL (300 s) and token-to-patient binding | `accessContext.js` | source, `access-context.test.js` |
| Write tokens only reach allowlisted demo patients: the OpenEMR module accepts only `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS`, whatever the token says, and every call is HMAC-signed | `oe-module-agentforge` `AccessPolicy`, compose `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS`, `AGENTFORGE_MODULE_HMAC_SECRET` | compose, VM `.env` has the variables set (values not read) |
| Provisioned-only issuance (new, F-30da6790d1) | `server.js` | tests above |
| Origin binding (new, defense in depth): a present `Origin` outside `AGENTFORGE_DEMO_ALLOWED_ORIGINS` gets `403 mint_origin_not_allowed`; an absent `Origin` is allowed. Compose sets the list to `https://dtstest.64.177.10.182.nip.io` | `mintGuard.js#originRefused`, `server.js#mintRefused`, compose | `w3-remediation.test.js` (allowed, disallowed, absent, unset); deployed in `926805ce` (compose default), live re-check not recorded |

**What origin binding does and does not do.** It stops another website's JavaScript
from using a visitor's browser to mint tokens. It does **not** stop a scripted client:
a non-browser caller omits `Origin` (allowed by design, so the demo UI's same-origin
GET and the red-team harness keep working) or forges it. The mints stay anonymous to
such a client, so this does not change the F-831d4df407 / F-24b44c5180 disposition:
both remain risk-accepted. It applies only to the three anonymous synthetic mints, not
to the OpenEMR launch path, token claims or response bodies. An unset or empty
`AGENTFORGE_DEMO_ALLOWED_ORIGINS` turns the check off (local runs and tests).

**Proposals, not shipped (each needs a decision, none adds physician friction):**

1. **Mint audit log: approved and implemented (detection only).** Each issued
   token logs one JSON line to stdout: `event: mint_issued`, route, scope, patient id,
   client address (the rate-limit client), correlation id, timestamp. The token is
   never logged. Who gets a token and the response bodies are unchanged. Test:
   `w3-remediation.test.js` "mint audit"; removing the log makes it fail.
2. **Write-mint narrowing (not approved, not done).** Issue write tokens only for the patient(s) in
   `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS`'s fixture map (today the three mints share
   one roster). Reduces what a harvested write token can reach to what the module
   already allows. Small change, but it changes which demo patients can be uploaded to
   in the UI, so it is a product decision.
3. **No clean prevention exists without friction.** Same-origin or `Sec-Fetch-Site`
   checks and page-embedded nonces are forgeable by a script, so they would be
   theater against the finding. The real fix is authentication, which is the rejected
   gate (or the OpenEMR launch flow, which already mints per session for real
   clinicians and is not anonymous).

## Verification

- `npm test --prefix agentforge`: 702 pass, 0 fail, 3 skipped (baseline before the
  change: 693 pass; the nine new tests in `w3-remediation.test.js`). The commit ran
  the repo's `.githooks/pre-commit` gates unmodified.
- The red-team harness was not run by this work. The red-team session validates the
  deployed SHA with its own regression harness.

## Docs updated

`agentforge/api/README.md` (response changes), `W2_ARCHITECTURE.md` (applicability,
currency, response trimming), `agentforge/api/bruno/w2/13-follow-up-evidence.bru`
(asserts the two fields are absent), `PLAN.md` (pointer to this record).

## Deploy and live check

**Status (2026-10-01): deployed, not merged.** `/agentforge-w2/health` reports
`926805ce3ce61233f18857d6f71c739177b138e9` (checked 2026-10-01). That is the tip
of branch `agentforge/w3-remediation` (merge request !131, still open), which
carries `8ef9761e` plus two later commits: `d5e79bb3` (an audit-log line for
every synthetic-context mint) and `926805ce` (an `Origin` allowlist on the
anonymous mints). It is not on `staging/main`, so `deploy.sh` needs
`AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1` to ship it, and `AGENTS.md` ("deploy only
from `main`") is not yet met. `/dashboard` still reports `bfbb1eb2` and W1
`/agentforge` reports `84f232b`. The W2 submission (`w2-final` = `bfbb1eb2`) is
unchanged.

No live re-check record for `926805ce` is in this repository. The checks that
would make one are: 20 rapid `GET /v1/demo-context?patient_uuid=fixture-patient-001`
give 429s with `Retry-After` (F-6ee92046fb control); a token minted by the frozen W1
service at `/agentforge/v1/demo-context` is refused by W2 with 403 (`aud` control);
`/v1/demo-context?patient_uuid=fixture-patient-995` gives 400;
a mint request with `Origin: https://evil.example` gives 403 while one with no `Origin` (curl) or with the public origin gives 200;
`POST /v1/follow-up-evidence` on `fixture-patient-001` carries no `guideline_provider`
or `guideline_usage`, has `current` on each fact, and an insulin or diabetes question
returns `qualification.required: true`.

**Next.** The W3 hardening (`PLAN.md`, "W3 hardening") is cut from `926805ce`.
It merges to `main` and is deployed from `main` as one SHA, which these checks
then name. Deploy from a clean checkout of `staging/main`:

```sh
AGENTFORGE_DEPLOY_HOST=<user@host> AGENTFORGE_DEPLOY_KEY=<key path> AGENTFORGE_PUBLIC_URL=https://dtstest.64.177.10.182.nip.io deploy/vultr/deploy.sh   # default service: agentforge-w2; succeeds only when /health reports the new SHA
```

No deploy rebuilds the W1 service or changes `.env`.
