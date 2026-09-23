"""Run a bounded free local VLM smoke benchmark on sourced blank forms.

The forms are public blank layouts. Values are synthetic overlays drawn onto
rendered pages. The script stores only redacted benchmark metadata, never the
rendered images or raw model responses.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlparse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from form_benchmark_metrics import normalize, score_vlm_response


DEFAULT_MODEL = "huggingface.co/ggml-org/smolvlm-256m-instruct-gguf:Q8_0"
REPO_ROOT = Path(__file__).resolve().parents[2]
CASES = {
    "lab-hawaii-crl-2013": {
        "document_type": "lab_pdf",
        "layout_id": "external-lab-hawaii",
        "fields": {
            "patient.patient_id": "SYN-PAT-001",
            "specimen.specimen_id": "SYN-SPEC-001",
        },
    },
    "lab-maine-arbovirus-2017": {
        "document_type": "lab_pdf",
        "layout_id": "external-lab-maine",
        "fields": {
            "patient.name": "Synthetic Patient",
            "clinical.symptom_onset_date": "2026-09-20",
        },
    },
    "intake-broom-road-adult-v02": {
        "document_type": "intake_form",
        "layout_id": "external-intake-broom-road",
        "fields": {
            "patient.surname": "SYNTHETIC",
            "family_history": "SYNTHETIC TEST DATA",
        },
    },
    "intake-erskine-new-patient": {
        "document_type": "intake_form",
        "layout_id": "external-intake-erskine",
        "fields": {
            "patient.surname": "SYNTHETIC",
            "medications": "SYNTHETIC TEST DATA",
        },
    },
}


def model_response(base_url: str, model: str, image_path: Path, constrain_json: bool) -> tuple[str, float]:
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    prompt = (
        "Read this crop from a public blank clinical form with a synthetic test overlay. "
        "Identify the printed field label and transcribe the adjacent typed value. "
        "Return exactly one JSON object with keys label (string), value (string or null), "
        "confidence (number from 0 to 1), and abstain (boolean), for example "
        '{"label":"Patient ID","value":"SYN-PAT-001","confidence":0.9,"abstain":false}. '
        "If either label or value is unclear, set value to null and abstain to true. Do not guess."
    )
    request_body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
        ]}],
        "temperature": 0,
        "max_tokens": 80,
    }
    if constrain_json:
        request_body["response_format"] = {"type": "json_object"}
    body = json.dumps(request_body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8"))
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    return str(payload["choices"][0]["message"].get("content", "")), elapsed_ms


def render_page(pdftoppm: str, pdf: Path, page: int, output: Path, dpi: int) -> None:
    subprocess.run([
        pdftoppm, "-f", str(page), "-l", str(page), "-r", str(dpi), "-png", "-singlefile", str(pdf), str(output.with_suffix("")),
    ], check=True, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:12434/engines/v1")
    parser.add_argument("--manifest", type=Path, default=REPO_ROOT / "docs/agentforge/fixtures/w2-external-form-manifest.json")
    parser.add_argument("--tesseract-report", type=Path, default=REPO_ROOT / "docs/agentforge/evidence/W2_TESSERACT_BASELINE.json")
    parser.add_argument("--forms-root", type=Path, default=REPO_ROOT / "docs/agentforge")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "docs/agentforge/evidence/W2_LOCAL_VLM_BENCHMARK.json")
    parser.add_argument("--dpi", type=int, default=240)
    parser.add_argument("--constrain-json", action="store_true")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    forms = {form["id"]: form for form in manifest["forms"]}
    tesseract_report = json.loads(args.tesseract_report.read_text(encoding="utf-8"))
    if tesseract_report.get("schema_version") != "w2-tesseract-baseline-v2":
        raise RuntimeError("tesseract_baseline_v2_required")
    tesseract_labels = {}
    for form_result in tesseract_report.get("forms", []):
        for page_result in form_result.get("pages", []):
            for label_result in page_result.get("labels", []):
                tesseract_labels[(form_result["id"], page_result["page"], label_result["field_id"])] = label_result
    endpoint = urlparse(args.base_url)
    if endpoint.scheme not in {"http", "https"} or endpoint.hostname not in {"localhost", "127.0.0.1", "::1"} or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        raise RuntimeError("local_vlm_endpoint_must_be_loopback")
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm_not_found")

    results = []
    with tempfile.TemporaryDirectory(prefix="agentforge-vlm-") as temp_dir:
        temp = Path(temp_dir)
        for form_id, case in CASES.items():
            form = forms[form_id]
            pdf = args.forms_root / form["path"]
            labels = {label["field_id"]: label for label in form["labels"]}
            covered_pages = {labels[field_id]["page"] for field_id in case["fields"]}
            if len(case["fields"]) < 2 or (form["page_count"] > 1 and not set(range(1, form["page_count"] + 1)).issubset(covered_pages)):
                raise RuntimeError(f"form_case_coverage_invalid:{form_id}")
            for field_id, expected in case["fields"].items():
                label = labels[field_id]
                page_path = temp / f"{form_id}-{label['page']}.png"
                render_page(pdftoppm, pdf, label["page"], page_path, args.dpi)
                image = Image.open(page_path).convert("RGB")
                draw = ImageDraw.Draw(image)
                font = ImageFont.load_default()
                scale = args.dpi / 72
                x1, y1, x2, y2 = [int(value * scale) for value in label["box"]]
                draw.rectangle((x1 + 2, max(y1, y2 - 24), x2 - 2, y2 - 2), fill="white")
                draw.text((x1 + 5, max(y1, y2 - 21)), expected, fill="black", font=font)
                crop = image.crop((max(0, x1 - 8), max(0, y1 - 8), min(image.width, x2 + 8), min(image.height, y2 + 8)))
                crop_path = temp / f"{form_id}-{field_id.replace('.', '-')}.png"
                crop.save(crop_path)
                tesseract_label = tesseract_labels.get((form_id, label["page"], field_id), {})
                try:
                    raw, latency_ms = model_response(args.base_url, args.model, crop_path, args.constrain_json)
                    score = score_vlm_response(raw, label["label"], expected)
                    recognized = score["recognized_value"]
                    matched = score["value_match"]
                    abstained = score["abstained"]
                    raw_text_match = normalize(expected) in normalize(raw)
                    error = None
                except Exception as exc:  # bounded benchmark records the failure class only
                    raw = ""
                    latency_ms = None
                    recognized = None
                    matched = False
                    abstained = True
                    raw_text_match = False
                    score = {"label_match": False, "abstention_reason": "request_failed", "confidence": None}
                    error = type(exc).__name__
                results.append({
                    "form_id": form_id,
                    "document_type": case["document_type"],
                    "layout_id": case["layout_id"],
                    "field_id": field_id,
                    "page": label["page"],
                    "label_hash": hashlib.sha256(label["label"].encode()).hexdigest()[:16],
                    "model_label_match": score["label_match"],
                    "tesseract_label_recognized": bool(tesseract_label.get("recognized", False)),
                    "tesseract_label_localized": bool(tesseract_label.get("localized", False)),
                    "tesseract_region_overlap": tesseract_label.get("overlap_ratio"),
                    "expected_value_hash": hashlib.sha256(expected.encode()).hexdigest(),
                    "recognized_value_hash": hashlib.sha256(recognized.encode()).hexdigest() if recognized else None,
                    "value_match": matched,
                    "raw_text_match": raw_text_match,
                    "abstained": abstained,
                    "abstention_reason": score["abstention_reason"],
                    "model_confidence": score["confidence"],
                    "region_source": "manifest_crop; localization scored independently by Tesseract",
                    "latency_ms": latency_ms,
                    "crop_bytes": crop_path.stat().st_size,
                    "error": error,
                    "response_hash": hashlib.sha256(raw.encode()).hexdigest() if raw else None,
                })

    matched = sum(item["value_match"] for item in results)
    completed = sum(item["latency_ms"] is not None for item in results)
    per_form = {}
    for form_id in CASES:
        rows = [item for item in results if item["form_id"] == form_id]
        per_form[form_id] = {
            "layout_id": rows[0]["layout_id"],
            "cases": len(rows),
            "tesseract_labels_recognized": sum(item["tesseract_label_recognized"] for item in rows),
            "tesseract_labels_localized": sum(item["tesseract_label_localized"] for item in rows),
            "vlm_values_matched": sum(item["value_match"] for item in rows),
            "vlm_abstained": sum(item["abstained"] for item in rows),
        }
    report = {
        "schema_version": "w2-local-vlm-benchmark-v2",
        "model": args.model,
        "endpoint": args.base_url,
        "structured_output_constraint": args.constrain_json,
        "request_timeout_seconds": 90,
        "data_class": "public_blank_forms_with_synthetic_overlays",
        "raw_images_retained": False,
        "raw_responses_retained": False,
        "deterministic_baseline": {
            "type": "tesseract_manifest_label_and_region_check",
            "report": str(args.tesseract_report.relative_to(REPO_ROOT)),
            "report_sha256": hashlib.sha256(args.tesseract_report.read_bytes()).hexdigest(),
            "vlm_localization_claimed": False,
            "cases": len(results),
        },
        "summary": {
            "cases": len(results),
            "value_matched": matched,
            "value_match_rate": round(matched / len(results), 4) if results else 0,
            "tesseract_label_identification": {
                "recognized": sum(item["tesseract_label_recognized"] for item in results),
                "cases": len(results),
            },
            "tesseract_region_localization": {
                "localized": sum(item["tesseract_label_localized"] for item in results),
                "cases": len(results),
            },
            "raw_text_matches": sum(item["raw_text_match"] for item in results),
            "raw_text_match_rate": round(sum(item["raw_text_match"] for item in results) / len(results), 4) if results else 0,
            "completed": completed,
            "abstained": sum(item["abstained"] for item in results),
            "abstention_rate": round(sum(item["abstained"] for item in results) / len(results), 4) if results else 0,
            "per_form": per_form,
            "latency_ms": {
                "min": min((item["latency_ms"] for item in results if item["latency_ms"] is not None), default=None),
                "max": max((item["latency_ms"] for item in results if item["latency_ms"] is not None), default=None),
            },
        },
        "results": results,
        "promotion": "not_promoted; deterministic_tesseract_baseline_remains_active",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
