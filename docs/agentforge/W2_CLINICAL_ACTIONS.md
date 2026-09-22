# W2 clinician-confirmed action lane

This is a narrow, synthetic-only writeback seam for the optional action lane.
It is not a clinical recommendation engine and it does not authorize live
OpenEMR writes.

## Flow

1. A clinician supplies an explicit diagnosis or order instruction.
2. AgentForge returns a structured, reviewable draft with the original
   instruction and `clinician-authored-unconfirmed` provenance.
3. The clinician emits a confirmation event, or cancels the draft.
4. Only a confirmed event creates a synthetic action record. Confirmation is
   idempotent by draft identity; retries return the same confirmed action.
5. The action can be read back with clinician authorship, source instruction,
   confirmation timestamp, confirmation event ID, and synthetic provenance.

## Safety boundary

The action context is a distinct `write-clinical-action` signed scope. A
read-briefing or source-document context cannot authorize it. Agent-originated
instructions are rejected, wrong-patient reads and confirmations fail closed,
and cancellation does not create an action. The live OpenEMR adapter exposes no
clinical action methods and remains GET-only.

## Verification

`agentforge/test/clinical-actions.test.js` covers diagnosis and order drafts,
confirmation, cancellation, duplicate confirmation, wrong-patient isolation,
agent-originated rejection, writeback failure, live-mode refusal, and synthetic
readback. The full AgentForge suite passes 99/99. This is synthetic seam proof,
not real OpenEMR persistence or clinical safety evidence.
