# AgentForge — live demo and voiceover

> **Historical Week 1 script.** This describes a read-only briefing/follow-up
> demo and an older deployment. It does not exercise W2 document workers, the
> W2 gate, or Cohere. Do not use it as the W2 demo script without revising and
> recording against the current candidate.

Target: about 4:45, browser-only video with a conversational TTS track. Synthetic
patient data; live Qwen3.6 Flash synthesis and live Gemini 2.5 Flash-Lite
conversation through OpenRouter. The updated app is local. The public deployment
is candidate 88420c1 and does not yet contain these working-tree changes.

The bracketed lines below are recording actions. Only the quoted paragraphs are
spoken.

## 0:00–0:25 — What this is

[Show the AgentForge patient-selection screen with the complete return-visit fixture selected.]

“AgentForge is a preparation layer for a primary-care return visit. The physician
starts with the patient already open in OpenEMR, and AgentForge gives them a short,
evidence-linked orientation before the visit begins.

The first version is deliberately narrow: read the chart, explain what changed,
and let the physician ask follow-up questions. It does not write back to the chart.”

## 0:25–1:05 — Calendar-triggered preparation and briefing

[Show the prepared state, then open the briefing.]

“Preparation is triggered by the visit calendar, before the clinician opens the
patient. The scheduling seam can call the prewarm API, and once the result is ready,
opening it is immediate. That keeps the slower synthesis step out of the clinician’s
critical path.

For this patient, the visit is a blood-pressure follow-up. The patient has
hypertension and is taking ten milligrams of lisinopril daily. They were previously
on five milligrams. The chart also records that the home blood-pressure log was
reviewed at the return visit.”

## 1:05–1:30 — Source records and provenance

[Expand Source records and pause on the dated medication entries.]

“Every important statement has supporting records behind it. Here we can see the two
medication entries, their dates, the visit note, and the author information.

The comparison tells us what the chart recorded and when. It does not invent a
reason for the change. That separation between evidence and interpretation is one
of the main design choices.”

## 1:30–2:15 — Live conversation

[Ask: “What changed in the medication record?”]

“Now I’ll ask a question about the briefing. This is a live conversation request,
using the prepared patient context and the verified evidence behind it.”

[Wait for the answer. Then ask: “What date was that recorded?”]

“This second question depends on the first answer, so it demonstrates the multi-turn
path rather than two unrelated prompts.

The conversation stays bound to the same patient and clinician. The model handles
the language, but it does not choose a patient, invent a chart query, or bypass the
service’s evidence checks. That gives us flexible conversation at the surface, with
fixed and testable operations underneath.”

## 2:15–2:35 — Partial retrieval

[Select Test Partial and open its prepared briefing.]

“The next fixture shows what happens when the chart is incomplete. Some record groups
succeed, while the encounter and note lookups fail or time out.

AgentForge keeps the available evidence, marks the result as partial, and withholds
anything that depends on the missing groups. A successful empty lookup is also kept
distinct from an upstream failure. Otherwise an outage could look like an empty
chart.”

## 2:35–2:50 — Patient-scope protection

[Run the cross-patient probe.]

“This probe tries to use the conversation with a different patient. It is blocked
before patient content is returned.

Patient scope is enforced by the service boundary, outside the model. Authorization
does not depend on what a language model happens to decide.”

## 2:50–3:15 — Evaluations

[Open the evaluator panel.]

“The evaluator panel covers nine synthetic cases: complete data, stale values,
conflicting values, missing provenance, untrusted notes, partial retrieval,
successful empty results, missing comparison history, and duplicate identity.

The mutation checks inject known defects and verify that the evaluator catches them.
The current local gate is nine of nine cases, with six injected defects detected.
These tests exercise the contracts and safety boundaries of the implementation.”

## 3:15–3:50 — Observability and operations

[Open the observability dashboard.]

“The operational view separates preparation, prepared opens, and follow-ups. It shows
request counts, latency, errors, retries, verification outcomes, provider fallback,
and redacted traces.

Each request keeps a correlation ID across retrieval, synthesis, verification, and
display. The traces contain operational metadata, not raw chart text or patient
identifiers.

There are separate health and readiness checks. Health answers whether the service
is alive. Readiness checks whether its retrieval, model, and trace dependencies are
usable. The dashboard also defines response guidance for high latency, error spikes,
and retrieval failures.”

## 3:50–4:30 — Architecture, scale, and cost

[Open the engineering evidence page and pause on the architecture, load, and cost cards.]

“The architecture keeps the OpenEMR integration behind a read-only adapter. The
adapter has an allowlist of patient-scoped reads, and the verifier is the only path
to a displayed claim.

I chose asynchronous synthesis because the measured preparation path is the slower
operation. In the historical deployed sample, ten concurrent requests completed,
while fifty produced an eight-percent timeout rate near the client deadline. That
result is why preparation runs ahead of the visit; follow-up latency is measured
separately.

The cost page gives planning ranges for one hundred, one thousand, ten thousand,
and one hundred thousand clinicians. It also spells out when the design would need
workers, a queue, a shared cache, database separation, and regional redundancy.”

## 4:30–4:50 — Close

[Return to the briefing or evidence landing page.]

“This demo uses synthetic patients and live Qwen synthesis with Gemini Flash-Lite for
follow-up conversation. The repository includes the audit, user workflow,
architecture, metrics, API collection, evaluations, observability, load evidence,
cost model, and assignment matrix.

The result is a focused clinical workflow with live conversation, visible evidence,
and explicit failure behavior. The remaining production gates are real-data
authorization, provider and retention review, fresh candidate load testing, and
complete provider billing attribution.”

## Recording verification

- Capture only the browser's demo content, without unrelated desktop windows.
- Include the complete return-visit briefing, expanded source records, both live follow-ups, partial retrieval, cross-patient blocking, evaluator panel, observability dashboard, and engineering evidence page.
- Verify the finished file contains video and the TTS audio track.
- Confirm the displayed briefing is plain-language clinical prose and contains no internal schema fields or meta commentary.
- Confirm the complete briefing uses Qwen and both follow-ups use Gemini in their traces; configuration alone does not prove provider use.
- Keep actual provider wait visible. Do not speed up a request and imply that the shortened time is measured latency.
- The evidence page distinguishes historical load, cost assumptions, current local live-provider behavior, and the public deployment.
