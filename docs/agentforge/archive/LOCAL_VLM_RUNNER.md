# Local VLM runner contract

Status: deterministic OCR baseline verified; larger local VLM runtime smoke-tested and benchmarked, but not promoted for structured extraction, 2026-09-22.

## Decision

Use the deterministic scan-form adapter as the initial baseline. Add a small,
quantized local VLM only as a second-pass resolver for ambiguous OCR/layout
crops. Hosted document AI and hosted multimodal LLMs remain separate approval
decisions.

The small `SmolVLM-256M-Instruct-GGUF` remains available as a minimal smoke
runtime, but it failed the typed-value crop gate. The larger free candidate
selected for the next experiment is the official
`PaddleOCR-VL-1.6-GGUF`, served locally through the upstream llama.cpp server.
The local package is about 933 MB for the model plus 882 MB for the vision
projector, and it runs CPU-only on this laptop. See the [official model
repository](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF) and
[PaddleOCR-VL documentation](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html).

If that small model misses too many fields, the next local option is
PaddleOCR-VL, whose documented pipeline combines layout analysis with VLM
recognition and supports x64 CPU execution, but it has a materially larger
runtime/model footprint. See the [official PaddleOCR-VL tutorial](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html).

## Adapter boundary

The deterministic baseline owns page/layout discovery and creates a bounded
crop request. The runner passed to `createLocalVlmAdapter` in
`agentforge/src/localVlmAdapter.js` must be local and deterministic enough to
return this redacted candidate shape:

```json
{
  "fields": [
    {
      "field_id": "lab.hgb",
      "label": "Hemoglobin",
      "value": "13.2",
      "page": 1,
      "bounding_box": [10, 20, 100, 40],
      "confidence": 0.94,
      "quote": "Hemoglobin 13.2 g/dL"
    }
  ],
  "missing": [],
  "unreadable": [],
  "conflicts": [],
  "issues": []
}
```

The adapter then enforces `source_class=public_blank`,
`synthetic_only=false`, `processing_mode=local_only`, allowed field IDs,
page/region citations, confidence bounds, missing/unreadable/conflict
qualification, and no raw-document logging. A missing runner is `blocked`, not
synthetic VLM evidence.

For the laptop profile, the VLM should receive one labeled or OCR-ambiguous
crop at a time. It must not receive the whole patient document by default, and
it must not be allowed to invent a page/region citation: the citation box comes
from the deterministic crop request.

## Runtime gate

Do not promote the VLM lane until a pinned runtime has produced a report on the
sourced public blank forms plus synthetic overlays: field accuracy, citation
accuracy, missing-data recall, latency, memory footprint, crop size, and
failure examples. Compare it against the deterministic baseline on the same
cases.
The deterministic baseline must remain runnable and be compared on the same
cases. No PHI, live OpenEMR data, or hosted provider call belongs in this gate.

The laptop has Docker Model Runner enabled with host TCP access, and the
official PaddleOCR-VL GGUF files are stored locally for the experiment. Docker
Model Runner's current GGUF packager crashes on this model's metadata, so the
model is served by the upstream llama.cpp Docker image at
`http://127.0.0.1:8081/v1`; health is 200 and no hosted provider was used.
This proves local image ingress and runtime loading, not production readiness.
The first crop benchmark is now recorded in
`docs/agentforge/evidence/W2_LOCAL_VLM_BENCHMARK.json`: 8/8 requests completed,
0/8 values matched, 8/8 abstained/failed to extract, and CPU latency was
2.41–2.70 seconds per crop. The model is therefore **not promoted** as a field
extractor. It remains available only for future experimentation; the
deterministic baseline remains the active path.

The larger model's raw-text benchmark recovered all 8/8 synthetic values, but
the required structured JSON contract matched 0/8; JSON-constrained mode also
matched 0/8 and recovered 4/8 raw values. Evidence is in
`docs/agentforge/evidence/W2_LOCAL_PADDLEOCR_VL_RAW_BENCHMARK.json` and
`docs/agentforge/evidence/W2_LOCAL_PADDLEOCR_VL_BENCHMARK.json`. It is not
promoted as a field extractor until a deterministic response/parser layer is
designed and re-benchmarked.

The free SmolDocling-256M candidate was also checked. Its official
BF16/Safetensors checkpoint was incompatible with the laptop llama.cpp runner;
a small third-party GGUF conversion produced an unusable response and was
removed. Its redacted load failures are recorded in
`docs/agentforge/evidence/W2_LOCAL_SMOLDOCLING_BENCHMARK.json`.
