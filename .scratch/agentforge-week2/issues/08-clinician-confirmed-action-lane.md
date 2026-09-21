# 08: Clinician-confirmed action lane

**Type:** AFK

**What to build:** A narrow synthetic action path that turns an explicit
clinician instruction into one reviewable diagnosis draft and one reviewable
order draft, then writes only the confirmed action to OpenEMR with authorship
and provenance.

**Blocked by:** 09: Fifty-case regression gate

**Status:** ready-for-agent

- [ ] The physician can provide an explicit diagnosis instruction and see a structured draft before writeback.
- [ ] The physician can provide an explicit order instruction and see a structured draft before writeback.
- [ ] No diagnosis or order is committed without an explicit confirmation event.
- [ ] Confirmed actions read back from synthetic OpenEMR with clinician authorship, source instruction, timestamp, and provenance.
- [ ] Retries are idempotent and unconfirmed or agent-originated actions are not written.
- [ ] Tests cover draft, confirmation, cancellation, duplicate confirmation, wrong-patient, and writeback-failure paths.
