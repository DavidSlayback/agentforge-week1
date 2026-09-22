# 08: Clinician-confirmed action lane

**Type:** AFK

**What to build:** A narrow synthetic action path that turns an explicit
clinician instruction into one reviewable diagnosis draft and one reviewable
order draft, then writes only the confirmed action to OpenEMR with authorship
and provenance.

**Blocked by:** 09: Fifty-case regression gate

**Status:** accepted-with-residual

- [x] The physician can provide an explicit diagnosis instruction and see a structured draft before writeback.
- [x] The physician can provide an explicit order instruction and see a structured draft before writeback.
- [x] No diagnosis or order is committed without an explicit confirmation event.
- [x] Confirmed actions read back from synthetic OpenEMR with clinician authorship, source instruction, timestamp, and provenance.
- [x] Retries are idempotent and unconfirmed or agent-originated actions are not written.
- [x] Tests cover draft, confirmation, cancellation, duplicate confirmation, wrong-patient, and writeback-failure paths.

**Evidence:** `agentforge/src/clinicalActions.js`, the `write-clinical-action` signed context, the simulated adapter/service/API routes, and `agentforge/test/clinical-actions.test.js`. Full AgentForge suite passes 99/99; the W2 gate passes 50/50.

**Residual:** This proves only the synthetic OpenEMR seam. The live OpenEMR adapter remains GET-only, so real diagnosis/order persistence and external clinician-session readback remain `INCONCLUSIVE` and are not claimed here.
