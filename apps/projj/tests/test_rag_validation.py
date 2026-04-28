import unittest

from rag.pipeline.rag_main import validate_action_request


class FakeVectorStore:
    def similarity_search_with_score(self, question, k=12):
        class Doc:
            def __init__(self):
                self.page_content = "Certificates should use ISO 8601 hourly timestamps."
                self.metadata = {"source": "docs/gec_rules.md", "chunk_id": 0, "start_index": 0}

        return [(Doc(), 0.2)]


class RagValidationTests(unittest.TestCase):
    def setUp(self):
        self.vs = FakeVectorStore()

    def test_cert_create_allows_valid_hourly_timestamps(self):
        result = validate_action_request(
            "cert_create",
            {
                "energy_source": "solar",
                "energy_amount": 100,
                "location": "Lahore",
                "prod_start": "2025-04-20T14:00:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
            },
            self.vs,
        )
        self.assertTrue(result["allow"])
        self.assertEqual(result["violations"], [])
        self.assertGreater(len(result["evidence"]), 0)

    def test_cert_create_blocks_invalid_timestamp_granularity(self):
        result = validate_action_request(
            "cert_create",
            {
                "energy_source": "wind",
                "energy_amount": 50,
                "location": "Karachi",
                "prod_start": "2025-04-20T14:30:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
            },
            self.vs,
        )
        self.assertFalse(result["allow"])
        self.assertTrue(any("hourly granularity" in item for item in result["violations"]))

    def test_cert_create_warns_when_timestamps_are_missing(self):
        result = validate_action_request(
            "cert_create",
            {
                "energy_source": "hydro",
                "energy_amount": 25,
                "location": "Islamabad",
            },
            self.vs,
        )
        self.assertTrue(result["allow"])
        self.assertTrue(any("timestamps were not supplied" in item for item in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
