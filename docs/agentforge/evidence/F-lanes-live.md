# F lanes (D14): observed on the public URL

**Deployed W2 SHA:** `99eaf8f88f9d591d3046eb7783a7b2c492720cbc`, 2026-09-26, about 22:40–23:10 UTC. It is valid for that SHA only; the freeze repeats the checks on the freeze SHA.

- **F-OBS, readiness.** `/agentforge-w2/ready` returned 200 with the dependencies `configuration`, `retrieval`, `openemrLiveReadsConfiguration`, `model`, `traceStore`, `openemrModule` and `guidelineCorpus` all `ready`, and `failing: []`.
- **F-OBS, traces persist.** `/v1/traces` returned 2 traces before a `docker restart vultr-agentforge-w2-1` and 2 after it. The traces live on the volume `vultr_w2tracevolume`. `/v1/metrics` reports `traceLimit` 500.
- **F-CLIN, safety flag.** The public "Lab result · Layout B → Run this sample" answer showed "Safety flags (1) · warning · diabetes range: A1C 7.2 % on 2026-09-21 is in the CDC diabetes range (6.5% or above)". It cited `[page 1]` and `[A1C Ranges]`, and the critic had reviewed it (`critic: reviewed`, final state READY, 12 cited fields).
- **F-LIVE.** Deployed but not observed in a session. The single-use launch cookie and the dose wording appear only in an OpenEMR-launched `grader` session. The OAuth re-authorization was attempted: the client's grant types were changed with owner approval and the helper was started, but it was abandoned because it needs a clinician at the consent screen. W2 was stopped for that attempt and brought back up afterwards (`/health` `99eaf8f8`, `/ready` 200). The token cache was not modified.
- **F-API.** Local Bruno run 27/27 on `4c630f5b`. The deployed Bruno run and the load test are part of the freeze record.
