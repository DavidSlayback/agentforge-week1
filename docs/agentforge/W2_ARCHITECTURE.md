# AgentForge Week 2 architecture

Moved. The canonical Week 2 architecture document — ingestion flow, worker
graph, RAG design, verification and grounded answer, eval gate, tradeoffs,
risks, and links — is now at the repository root:
[`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md).

This file used to hold the checkpoint notes that document now supersedes.
Nothing unique here was left behind: the supervisor decision table and the
answer-composer contract detail this file previously carried both live in
the root document's "Worker graph" and "Verification and the grounded
answer" sections, with one correction — the root document notes that
`answerComposer.js`'s prompt still asks the model for full citation objects,
not the short fact-reference (`F1`/`G1`) contract `docs/agentforge/PLAN.md`
(D9) describes as a fix; that change is not implemented at this commit.
