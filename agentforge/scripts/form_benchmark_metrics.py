"""Strict parsers and source-region metrics for local form benchmarks."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def parse_vlm_json(text: str) -> dict[str, Any]:
    """Parse the exact one-region JSON schema; malformed output abstains."""
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {"valid": False, "reason": "invalid_json"}
    if not isinstance(value, dict):
        return {"valid": False, "reason": "response_not_object"}
    label = value.get("label")
    field_value = value.get("value")
    confidence = value.get("confidence")
    abstain = value.get("abstain")
    if not isinstance(label, str) or not label.strip():
        return {"valid": False, "reason": "label_missing"}
    if field_value is not None and (not isinstance(field_value, str) or not field_value.strip()):
        return {"valid": False, "reason": "value_invalid"}
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        return {"valid": False, "reason": "confidence_invalid"}
    if not isinstance(abstain, bool):
        return {"valid": False, "reason": "abstain_flag_invalid"}
    if not abstain and field_value is None:
        return {"valid": False, "reason": "value_missing_without_abstention"}
    return {
        "valid": True,
        "label": label.strip(),
        "value": field_value.strip() if field_value is not None else None,
        "confidence": float(confidence),
        "abstain": abstain,
        "reason": "model_abstained" if abstain else None,
    }


def score_vlm_response(text: str, expected_label: str, expected_value: str) -> dict[str, Any]:
    """Score a local response without retaining its text or expected value."""
    parsed = parse_vlm_json(text)
    if not parsed["valid"]:
        return {
            "label_match": False,
            "value_match": False,
            "abstained": True,
            "abstention_reason": parsed["reason"],
            "recognized_value": None,
            "confidence": None,
        }
    label_match = normalize(parsed["label"]) == normalize(expected_label)
    value_match = label_match and not parsed["abstain"] and normalize(parsed["value"] or "") == normalize(expected_value)
    reason = parsed["reason"]
    if not parsed["abstain"] and not label_match:
        reason = "label_mismatch"
    elif not parsed["abstain"] and not value_match:
        reason = "value_mismatch"
    return {
        "label_match": label_match,
        "value_match": value_match,
        "abstained": parsed["abstain"] or not label_match or not value_match,
        "abstention_reason": reason,
        "recognized_value": parsed["value"],
        "confidence": parsed["confidence"],
    }


def score_label_region(label: str, words: list[dict[str, Any]], pdf_box: list[float], dpi: int) -> dict[str, Any]:
    """Match OCR words to a manifest label and score whether they lie in its ROI."""
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for word in words:
        if word.get("text", "").strip():
            grouped[tuple(word.get(key) for key in ("page_num", "block_num", "par_num", "line_num"))].append(word)
    target = normalize(label)
    best_overlap = 0.0
    recognized = False
    for line_words in grouped.values():
        line_words.sort(key=lambda item: int(item.get("word_num", 0)))
        spans: list[tuple[int, int, dict[str, Any]]] = []
        pieces: list[str] = []
        cursor = 0
        for word in line_words:
            piece = normalize(word["text"])
            if not piece:
                continue
            pieces.append(piece)
            spans.append((cursor, cursor + len(piece), word))
            cursor += len(piece)
        line = "".join(pieces)
        start = line.find(target)
        if start < 0:
            continue
        recognized = True
        end = start + len(target)
        matched = [word for lo, hi, word in spans if lo < end and hi > start]
        if not matched:
            continue
        scale = dpi / 72.0
        x1, y1, x2, y2 = (item * scale for item in pdf_box)
        left = min(int(word["left"]) for word in matched)
        top = min(int(word["top"]) for word in matched)
        right = max(int(word["left"]) + int(word["width"]) for word in matched)
        bottom = max(int(word["top"]) + int(word["height"]) for word in matched)
        area = max(0, right - left) * max(0, bottom - top)
        intersection = max(0, min(right, x2) - max(left, x1)) * max(0, min(bottom, y2) - max(top, y1))
        overlap = intersection / area if area else 0.0
        best_overlap = max(best_overlap, overlap)
    return {
        "recognized": recognized,
        "localized": recognized and best_overlap >= 0.5,
        "overlap_ratio": round(best_overlap, 4),
    }
