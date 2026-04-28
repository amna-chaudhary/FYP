import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import app as api_app
from db import registry


class BackendApiServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        registry.DB_PATH = Path(self.tmp_dir.name) / "registry.sqlite3"
        registry.reset_db()
        api_app.JWT_SECRET = "test-secret-with-sufficient-length-12345"
        self.client = TestClient(api_app.app)

        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": "0xissuer",
                "energy_source": "solar",
                "energy_amount": 125,
                "location": "Lahore",
                "prod_start": "2025-04-20T14:00:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
                "device_id": "device-01",
            },
            {
                "tx_hash": "0xcreate",
                "energy_source": "solar",
                "issued_quantity": 125,
                "location": "Lahore",
                "cert_id": 9,
                "explorer_url": "https://explorer/0xcreate",
            },
            "did:example:alice",
        )
        registry.sync_action_result(
            "market_list",
            {
                "sender_address": "0xissuer",
                "cert_id": 9,
                "price": 4500,
            },
            {
                "tx_hash": "0xmarket",
            },
            "did:example:alice",
        )

        login = self.client.post(
            "/auth/login",
            json={
                "did": "did:example:alice",
                "accountAddress": "0xissuer",
                "displayName": "Alice",
            },
        )
        self.assertEqual(login.status_code, 200)
        self.token = login.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_protected_endpoints_require_bearer_token(self):
        response = self.client.get("/certificates")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH_REQUIRED")

    def test_auth_login_returns_session_token(self):
        response = self.client.post(
            "/auth/login",
            json={
                "did": "did:example:bob",
                "accountAddress": "0xb0b",
                "displayName": "Bob",
                "walletLabel": "Demo Wallet",
            },
        )
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["success"])
        self.assertEqual(body["nextStep"], "wallet-approve")
        self.assertIn("token", body)

    def test_get_certificates_returns_user_registry_items(self):
        response = self.client.get("/certificates", headers=self.headers)
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["items"][0]["id"], "GEC-9")

    def test_get_certificate_detail_returns_document_and_history(self):
        response = self.client.get("/certificates/GEC-9", headers=self.headers)
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["certificate"]["energy_source"], "solar")
        self.assertEqual(body["document"]["certificateId"], "GEC-9")
        self.assertGreaterEqual(len(body["transactionHistory"]), 1)

    def test_marketplace_notifications_and_reports_endpoints(self):
        market = self.client.get("/marketplace", headers=self.headers)
        notifications = self.client.get("/notifications", headers=self.headers)
        reports = self.client.get("/reports", headers=self.headers)

        self.assertEqual(market.status_code, 200)
        self.assertEqual(market.json()["count"], 1)
        self.assertEqual(notifications.status_code, 200)
        self.assertGreaterEqual(notifications.json()["count"], 1)
        self.assertEqual(reports.status_code, 200)
        self.assertEqual(reports.json()["report"]["summary"]["certificate_count"], 1)

    def test_chat_endpoint_requires_auth_and_returns_answer_payload(self):
        unauthorized = self.client.post("/chat", json={"message": "hello"})
        self.assertEqual(unauthorized.status_code, 401)

        with patch.object(api_app, "decide_and_respond", return_value={"type": "answer", "text": "Hi Alice"}):
            response = self.client.post("/chat", headers=self.headers, json={"message": "hello"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"]["text"], "Hi Alice")

    def test_validation_errors_are_formatted(self):
        response = self.client.post("/auth/login", json={"did": ""})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")


if __name__ == "__main__":
    unittest.main()
