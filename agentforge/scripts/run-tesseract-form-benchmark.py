"""Run a redacted Tesseract label-recognition baseline on public blank forms.

The benchmark renders the sourced blank PDFs, runs local Tesseract TSV OCR, and
checks whether manifest labels are recoverable from the page text. It stores
counts, hashes, and coordinate availability only; it never stores OCR text or
rendered pages.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from form_benchmark_metrics import score_label_region


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "docs/agentforge/fixtures/w2-external-form-manifest.json"
DEFAULT_OUTPUT = REPO_ROOT / "docs/agentforge/evidence/W2_TESSERACT_BASELINE.json"
DEFAULT_TESSERACT = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_version(tesseract: Path) -> str:
    result = subprocess.run(
        [str(tesseract), "--version"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()[0].strip()


def render_pages(pdf_path: Path, output_dir: Path, dpi: int) -> list[Path]:
    prefix = output_dir / pdf_path.stem
    result = subprocess.run(
        ["pdftoppm.exe", "-r", str(dpi), "-png", str(pdf_path), str(prefix)],
        check=True,
        capture_output=True,
        text=True,
    )
    del result
    return sorted(output_dir.glob(f"{pdf_path.stem}-*.png"))


def ocr_page(tesseract: Path, image_path: Path, output_base: Path) -> tuple[list[dict[str, object]], int]:
    tsv_path = output_base.with_suffix(".tsv")
    subprocess.run(
        [str(tesseract), str(image_path), str(output_base), "--psm", "6", "tsv"],
        check=True,
        capture_output=True,
        text=True,
    )
    with tsv_path.open(encoding="utf-8", errors="replace", newline="") as handle:
        rows = []
        for row in csv.DictReader(handle, delimiter="\t"):
            text = (row.get("text") or "").strip()
            if not text:
                continue
            rows.append({
                "page_num": int(row["page_num"]),
                "block_num": int(row["block_num"]),
                "par_num": int(row["par_num"]),
                "line_num": int(row["line_num"]),
                "word_num": int(row["word_num"]),
                "text": text,
                "left": int(row["left"]),
                "top": int(row["top"]),
                "width": int(row["width"]),
                "height": int(row["height"]),
            })
    return rows, len(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--tesseract", type=Path, default=DEFAULT_TESSERACT)
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()

    tesseract = args.tesseract.resolve()
    if not tesseract.exists():
        raise SystemExit(f"Tesseract executable not found: {tesseract}")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    results: list[dict[str, object]] = []

    with tempfile.TemporaryDirectory(prefix="agentforge-tesseract-") as temp_dir:
        temp_path = Path(temp_dir)
        for form in manifest["forms"]:
            pdf_path = REPO_ROOT / "docs/agentforge" / form["path"]
            page_results: list[dict[str, object]] = []
            pages = render_pages(pdf_path, temp_path, args.dpi)
            for page_number, image_path in enumerate(pages, start=1):
                words, coordinate_count = ocr_page(
                    tesseract,
                    image_path,
                    temp_path / f"{form['id']}-page-{page_number}",
                )
                page_labels = [
                    item for item in form["labels"] if item["page"] == page_number
                ]
                normalized_text = normalize(" ".join(str(word["text"]) for word in words))
                label_results = [
                    {
                        "field_id": item["field_id"],
                        "label_hash": hashlib.sha256(item["label"].encode()).hexdigest()[:16],
                        "recognized": normalize(item["label"]) in normalized_text,
                        **score_label_region(item["label"], words, item["box"], args.dpi),
                    }
                    for item in page_labels
                ]
                page_results.append({
                    "page": page_number,
                    "image_sha256": sha256(image_path),
                    "coordinate_word_count": coordinate_count,
                    "labels": label_results,
                })
            label_results = [item for page in page_results for item in page["labels"]]
            results.append({
                "id": form["id"],
                "layout_id": form["layout_id"],
                "source_sha256": form["sha256"],
                "page_count": len(pages),
                "labels_total": len(label_results),
                "labels_recognized": sum(1 for item in label_results if item["recognized"]),
                "labels_recognized_in_region": sum(1 for item in label_results if item["localized"]),
                "region_localization_rate": sum(1 for item in label_results if item["localized"]) / len(label_results) if label_results else 0.0,
                "pages": page_results,
            })

    total = sum(int(item["labels_total"]) for item in results)
    recognized = sum(int(item["labels_recognized"]) for item in results)
    report = {
        "schema_version": "w2-tesseract-baseline-v2",
        "tool": "tesseract",
        "tesseract_path": str(tesseract),
        "tesseract_version": command_version(tesseract),
        "dpi": args.dpi,
        "synthetic_only": False,
        "input_boundary": "public blank forms only; no patient data or completed forms",
        "labels_total": total,
        "labels_recognized": recognized,
        "label_recall": recognized / total if total else 0.0,
        "labels_recognized_in_region": sum(int(form["labels_recognized_in_region"]) for form in results),
        "region_localization_rate": sum(int(form["labels_recognized_in_region"]) for form in results) / total if total else 0.0,
        "coordinate_output_available": all(
            page["coordinate_word_count"] > 0
            for form in results
            for page in form["pages"]
        ),
        "forms": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "tesseract_version": report["tesseract_version"],
        "labels_recognized": recognized,
        "labels_total": total,
        "label_recall": report["label_recall"],
        "labels_recognized_in_region": report["labels_recognized_in_region"],
        "region_localization_rate": report["region_localization_rate"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
