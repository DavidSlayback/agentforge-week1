import unittest

from form_benchmark_metrics import parse_vlm_json, score_label_region, score_vlm_response


class VlmResponseTests(unittest.TestCase):
    def test_valid_response_requires_exact_label_and_value(self):
        result = score_vlm_response(
            '{"label":"Patient ID","value":"SYN-PAT-001","confidence":0.9,"abstain":false}',
            "Patient ID",
            "SYN-PAT-001",
        )
        self.assertTrue(result["label_match"])
        self.assertTrue(result["value_match"])
        self.assertFalse(result["abstained"])

    def test_malformed_or_unlabeled_output_abstains_without_value(self):
        malformed = score_vlm_response("SYN-PAT-001", "Patient ID", "SYN-PAT-001")
        unlabeled = parse_vlm_json('{"value":"SYN-PAT-001","confidence":0.9,"abstain":false}')
        self.assertTrue(malformed["abstained"])
        self.assertIsNone(malformed["recognized_value"])
        self.assertEqual(unlabeled["reason"], "label_missing")

    def test_wrong_label_and_explicit_abstention_do_not_become_facts(self):
        wrong = score_vlm_response(
            '{"label":"Specimen ID","value":"SYN-PAT-001","confidence":0.9,"abstain":false}',
            "Patient ID",
            "SYN-PAT-001",
        )
        abstain = score_vlm_response(
            '{"label":"Patient ID","value":null,"confidence":0.2,"abstain":true}',
            "Patient ID",
            "SYN-PAT-001",
        )
        self.assertFalse(wrong["value_match"])
        self.assertTrue(wrong["abstained"])
        self.assertTrue(abstain["abstained"])
        self.assertIsNone(abstain["recognized_value"])


class LabelRegionTests(unittest.TestCase):
    def test_multiword_ocr_label_is_matched_and_localized_to_manifest_region(self):
        words = [
            {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 1, "text": "Date", "left": 100, "top": 100, "width": 36, "height": 12},
            {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 2, "text": "of", "left": 140, "top": 100, "width": 14, "height": 12},
            {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 3, "text": "Birth", "left": 158, "top": 100, "width": 38, "height": 12},
        ]
        result = score_label_region("Date of Birth", words, [34, 34, 74, 48], 200)
        self.assertTrue(result["recognized"])
        self.assertTrue(result["localized"])
        self.assertEqual(result["overlap_ratio"], 1.0)

    def test_page_text_hit_outside_manifest_box_is_not_localized(self):
        words = [
            {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 1, "text": "Patient", "left": 500, "top": 500, "width": 50, "height": 12},
            {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "word_num": 2, "text": "Name", "left": 555, "top": 500, "width": 35, "height": 12},
        ]
        result = score_label_region("Patient Name", words, [25, 25, 100, 60], 72)
        self.assertTrue(result["recognized"])
        self.assertFalse(result["localized"])


if __name__ == "__main__":
    unittest.main()
