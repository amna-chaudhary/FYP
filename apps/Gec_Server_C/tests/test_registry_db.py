import tempfile
import unittest
from pathlib import Path

from db import registry


class RegistryDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        registry.DB_PATH = Path(self.tmp_dir.name) / "registry.sqlite3"
        registry.reset_db()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_sync_cert_create_persists_certificate_transaction_and_notification(self):
        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": "0x111",
                "owner": "0xowner000000000000000000000000000000000000000000000000000000000000",
                "energy_source": "solar",
                "energy_amount": 100,
                "location": "Lahore",
                "prod_start": "2025-04-20T14:00:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
                "device_id": "device-demo",
            },
            {
                "tx_hash": "0xabc",
                "energy_source": "solar",
                "issued_quantity": 100,
                "location": "Lahore",
                "cert_id": 5,
                "explorer_url": "https://explorer/0xabc",
            },
            "did:example:alice",
        )

        cert = registry.get_certificate_by_id("GEC-5")
        self.assertIsNotNone(cert)
        self.assertEqual(cert["owner_account_address"], "0xowner000000000000000000000000000000000000000000000000000000000000")
        self.assertTrue(cert["owner_did"].startswith("did:local:0xowner"))
        self.assertEqual(cert["status"], "ACTIVE")

        txs = registry.connect().execute("SELECT COUNT(*) AS c FROM transactions").fetchone()["c"]
        notices = registry.connect().execute("SELECT COUNT(*) AS c FROM notifications").fetchone()["c"]
        self.assertEqual(txs, 1)
        self.assertEqual(notices, 1)

    def test_sync_cert_create_same_owner_as_signer_uses_session_did(self):
        wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": wallet,
                "owner": wallet,
                "energy_source": "solar",
                "energy_amount": 10,
                "location": "Karachi",
                "prod_start": "2025-06-01T10:00:00Z",
                "prod_end": "2025-06-01T11:00:00Z",
            },
            {
                "tx_hash": "0xselfmint",
                "energy_source": "solar",
                "issued_quantity": 10,
                "location": "Karachi",
                "cert_id": 42,
            },
            "did:example:carol",
        )
        cert = registry.get_certificate_by_id("GEC-42")
        self.assertIsNotNone(cert)
        self.assertEqual(cert["owner_did"], "did:example:carol")
        self.assertEqual(cert["owner_account_address"].lower(), wallet.lower())

    def test_search_certificates_matches_wallet_when_owner_did_is_local(self):
        """Legacy rows used did:local:0x… while the UI session uses the SSI DID."""
        now = registry.utc_now_iso()
        with registry.connect() as conn:
            conn.execute(
                """
                INSERT INTO certificates (
                    id, owner_did, owner_account_address, previous_owner_did,
                    previous_owner_account_address, energy_source, energy_amount,
                    prod_start, prod_end, timestamp, location, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "GEC-legacy-1",
                    "did:local:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "did:local:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "solar",
                    5.0,
                    "2025-01-01T00:00:00Z",
                    "2025-01-01T01:00:00Z",
                    "2025-01-01T00:00:00Z",
                    "Test",
                    "ACTIVE",
                    now,
                    now,
                ),
            )
            conn.commit()
        rows = registry.search_certificates(
            owner_did="did:example:alice",
            owner_account_address="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "GEC-legacy-1")

    def test_search_certificates_filters_by_owner_status_and_source(self):
        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": "0x111",
                "energy_source": "wind",
                "energy_amount": 40,
                "location": "Karachi",
                "prod_start": "2025-04-20T14:00:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
            },
            {
                "tx_hash": "0x1",
                "energy_source": "wind",
                "issued_quantity": 40,
                "location": "Karachi",
                "cert_id": 1,
            },
            "did:example:bob",
        )
        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": "0x111",
                "energy_source": "solar",
                "energy_amount": 20,
                "location": "Lahore",
                "prod_start": "2025-05-20T14:00:00Z",
                "prod_end": "2025-05-20T15:00:00Z",
            },
            {
                "tx_hash": "0x2",
                "energy_source": "solar",
                "issued_quantity": 20,
                "location": "Lahore",
                "cert_id": 2,
            },
            "did:example:alice",
        )

        results = registry.search_certificates(owner_did="did:example:alice", status="ACTIVE", energy_source="solar")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], "GEC-2")

    def test_sync_transfer_updates_previous_owner(self):
        registry.sync_action_result(
            "cert_create",
            {
                "sender_address": "0xaaa",
                "energy_source": "solar",
                "energy_amount": 10,
                "location": "Lahore",
                "prod_start": "2025-04-20T14:00:00Z",
                "prod_end": "2025-04-20T15:00:00Z",
            },
            {
                "tx_hash": "0xabc",
                "energy_source": "solar",
                "issued_quantity": 10,
                "location": "Lahore",
                "cert_id": 7,
            },
            "did:example:alice",
        )

        registry.sync_action_result(
            "cert_transfer",
            {
                "sender_address": "0xaaa",
                "cert_id": 7,
                "recipient": "0xbbb",
            },
            {
                "tx_hash": "0xdef",
            },
            "did:example:alice",
        )

        cert = registry.get_certificate_by_id("GEC-7")
        self.assertEqual(cert["previous_owner_did"], "did:example:alice")
        self.assertEqual(cert["owner_account_address"], "0xbbb")

    def test_market_list_stores_listing_id_and_cancel_updates_row(self):
        registry.sync_action_result(
            "market_list",
            {
                "sender_address": "0xseller",
                "cert_id": 3,
                "price": 50,
            },
            {"tx_hash": "0xlist1", "listing_id": 7},
            "did:example:seller",
        )
        row = registry.connect().execute(
            "SELECT * FROM marketplace_listings WHERE certificate_id = ?",
            ("GEC-3",),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["listing_id"], "7")
        self.assertEqual(row["status"], "OPEN")

        registry.sync_action_result(
            "market_cancel",
            {"sender_address": "0xseller", "listing_id": 7},
            {"tx_hash": "0xcancel1"},
            "did:example:seller",
        )
        row2 = registry.connect().execute(
            "SELECT status FROM marketplace_listings WHERE listing_id = ?",
            ("7",),
        ).fetchone()
        self.assertEqual(row2["status"], "CANCELLED")

    def test_market_request_buy_sets_pending_and_buyer(self):
        registry.sync_action_result(
            "market_list",
            {"sender_address": "0xseller", "cert_id": 9, "price": 40},
            {"tx_hash": "0xlist2", "listing_id": 2},
            "did:example:seller",
        )
        registry.sync_action_result(
            "market_request_buy",
            {"sender_address": "0xbuyerwallet", "listing_id": 2},
            {"tx_hash": "0xreq1"},
            "did:example:buyer",
        )
        row = registry.connect().execute(
            "SELECT status, buyer_did, buyer_account_address FROM marketplace_listings WHERE listing_id = ?",
            ("2",),
        ).fetchone()
        self.assertEqual(row["status"], "PENDING")
        self.assertEqual(row["buyer_did"], "did:example:buyer")
        self.assertEqual(row["buyer_account_address"], "0xbuyerwallet")

        registry.sync_action_result(
            "market_accept_buy",
            {"sender_address": "0xseller", "listing_id": 2},
            {"tx_hash": "0xacc1"},
            "did:example:seller",
        )
        sold = registry.connect().execute(
            "SELECT status, buyer_did FROM marketplace_listings WHERE listing_id = ?",
            ("2",),
        ).fetchone()
        self.assertEqual(sold["status"], "SOLD")
        self.assertEqual(sold["buyer_did"], "did:example:buyer")


if __name__ == "__main__":
    unittest.main()
