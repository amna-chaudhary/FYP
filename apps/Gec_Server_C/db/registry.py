from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from db.models import (
    CertificateRecord,
    MarketplaceListingRecord,
    NotificationRecord,
    TransactionRecord,
    UserRecord,
    utc_now_iso,
)


DB_PATH = Path(os.getenv("REGISTRY_DB_PATH", str(Path(__file__).resolve().parent / "gec_registry.sqlite3")))
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
SCHEMA_PATH = MIGRATIONS_DIR / "001_registry_schema.sql"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _find_certificate_id_by_numeric_suffix(conn: sqlite3.Connection, cert_id: int) -> Optional[str]:
    """
    If certificates are stored with display ids like GEC-2026-000123, actions that only
    know the numeric id (123) should still be able to find the record.
    """
    try:
        suffix = str(int(cert_id)).zfill(6)
    except Exception:
        return None
    row = conn.execute(
        "SELECT id FROM certificates WHERE id LIKE ? ORDER BY created_at DESC LIMIT 1",
        (f"GEC-%-{suffix}",),
    ).fetchone()
    return row["id"] if row else None


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()


def reset_db() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()


def _execute(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> None:
    conn.execute(sql, tuple(params))


def ensure_user(conn: sqlite3.Connection, user: UserRecord) -> None:
    _execute(
        conn,
        """
        INSERT INTO users (
            did, account_address, display_name, email, role, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(did) DO UPDATE SET
            account_address = excluded.account_address,
            display_name = excluded.display_name,
            email = excluded.email,
            role = excluded.role,
            updated_at = excluded.updated_at
        """,
        (
            user.did,
            user.account_address,
            user.display_name,
            user.email,
            user.role,
            user.created_at,
            user.updated_at,
        ),
    )


def upsert_certificate(conn: sqlite3.Connection, cert: CertificateRecord) -> None:
    _execute(
        conn,
        """
        INSERT INTO certificates (
            id, owner_did, owner_account_address, previous_owner_did, previous_owner_account_address,
            issuer_did, issuer_account_address, device_id, device_name, energy_source, energy_amount,
            prod_start, prod_end, timestamp, location, status, tx_hash, explorer_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            owner_did = excluded.owner_did,
            owner_account_address = excluded.owner_account_address,
            previous_owner_did = excluded.previous_owner_did,
            previous_owner_account_address = excluded.previous_owner_account_address,
            issuer_did = excluded.issuer_did,
            issuer_account_address = excluded.issuer_account_address,
            device_id = excluded.device_id,
            device_name = excluded.device_name,
            energy_source = excluded.energy_source,
            energy_amount = excluded.energy_amount,
            prod_start = excluded.prod_start,
            prod_end = excluded.prod_end,
            timestamp = excluded.timestamp,
            location = excluded.location,
            status = excluded.status,
            tx_hash = excluded.tx_hash,
            explorer_url = excluded.explorer_url,
            updated_at = excluded.updated_at
        """,
        (
            cert.id,
            cert.owner_did,
            cert.owner_account_address,
            cert.previous_owner_did,
            cert.previous_owner_account_address,
            cert.issuer_did,
            cert.issuer_account_address,
            cert.device_id,
            cert.device_name,
            cert.energy_source,
            cert.energy_amount,
            cert.prod_start,
            cert.prod_end,
            cert.timestamp,
            cert.location,
            cert.status,
            cert.tx_hash,
            cert.explorer_url,
            cert.created_at,
            cert.updated_at,
        ),
    )


def create_transaction(conn: sqlite3.Connection, tx: TransactionRecord) -> None:
    _execute(
        conn,
        """
        INSERT INTO transactions (
            certificate_id, operation, actor_did, actor_account_address, recipient_did,
            recipient_account_address, tx_hash, metadata_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tx.certificate_id,
            tx.operation,
            tx.actor_did,
            tx.actor_account_address,
            tx.recipient_did,
            tx.recipient_account_address,
            tx.tx_hash,
            tx.metadata_json,
            tx.occurred_at,
        ),
    )


def upsert_marketplace_listing(conn: sqlite3.Connection, listing: MarketplaceListingRecord) -> None:
    _execute(
        conn,
        """
        INSERT INTO marketplace_listings (
            certificate_id, seller_did, seller_account_address, buyer_did, buyer_account_address,
            listing_id, price, currency, listed_at, updated_at, status, tx_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(certificate_id) DO UPDATE SET
            seller_did = excluded.seller_did,
            seller_account_address = excluded.seller_account_address,
            buyer_did = excluded.buyer_did,
            buyer_account_address = excluded.buyer_account_address,
            listing_id = excluded.listing_id,
            price = excluded.price,
            currency = excluded.currency,
            updated_at = excluded.updated_at,
            status = excluded.status,
            tx_hash = excluded.tx_hash
        """,
        (
            listing.certificate_id,
            listing.seller_did,
            listing.seller_account_address,
            listing.buyer_did,
            listing.buyer_account_address,
            listing.listing_id,
            listing.price,
            listing.currency,
            listing.listed_at,
            listing.updated_at,
            listing.status,
            listing.tx_hash,
        ),
    )


def create_notification(conn: sqlite3.Connection, notification: NotificationRecord) -> None:
    _execute(
        conn,
        """
        INSERT INTO notifications (
            user_did, title, body, category, related_certificate_id, related_tx_hash, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            notification.user_did,
            notification.title,
            notification.body,
            notification.category,
            notification.related_certificate_id,
            notification.related_tx_hash,
            notification.created_at,
            notification.read_at,
        ),
    )


def _derive_user_identity(user_id: Optional[str], account_address: Optional[str]) -> UserRecord:
    value = user_id or account_address or "anonymous"
    is_did = value.startswith("did:")
    return UserRecord(
        did=value if is_did else f"did:local:{value}",
        account_address=account_address or value,
        display_name=value,
        role="platform-user",
        created_at=utc_now_iso(),
        updated_at=utc_now_iso(),
    )


def _norm_hex_addr(addr: Optional[str]) -> str:
    if not addr or not str(addr).strip():
        return ""
    a = str(addr).strip().lower()
    if not a.startswith("0x"):
        a = "0x" + a
    return a


def _same_hex_addr(a: Optional[str], b: Optional[str]) -> bool:
    na, nb = _norm_hex_addr(a), _norm_hex_addr(b)
    return bool(na and nb and na == nb)


def user_can_view_certificate(
    *,
    user_did: Optional[str],
    user_account_address: Optional[str],
    record: Dict[str, Any],
) -> bool:
    if not record:
        return False
    if user_did and record.get("owner_did") == user_did:
        return True
    if user_did and record.get("previous_owner_did") == user_did:
        return True
    if _same_hex_addr(user_account_address, record.get("owner_account_address")):
        return True
    if _same_hex_addr(user_account_address, record.get("previous_owner_account_address")):
        return True
    return False


def sync_action_result(tool_name: str, arguments: Dict[str, Any], result_body: Dict[str, Any], user_id: Optional[str]) -> None:
    init_db()

    tx_hash = result_body.get("tx_hash")
    explorer_url = result_body.get("explorer_url")
    actor_account = arguments.get("sender_address")
    actor = _derive_user_identity(user_id, actor_account)
    now = utc_now_iso()

    with connect() as conn:
        ensure_user(conn, actor)

        if tool_name == "cert_create":
            # Prefer the canonical display id if backend provides it (GEC-YYYY-NNNNNN).
            display_id = result_body.get("display_id")
            if display_id and isinstance(display_id, str) and display_id.strip():
                cert_identifier = display_id.strip()
            else:
                cert_identifier = f"GEC-{result_body.get('cert_id') or tx_hash or 'pending'}"
            owner_account = result_body.get("owner_account_id") or arguments.get("owner") or actor.account_address
            explicit_owner = bool(arguments.get("owner"))
            # When the on-chain owner is the same wallet as the signer, keep the session DID so
            # GET /certificates (filtered by JWT did) returns the minted certificate.
            if explicit_owner and _same_hex_addr(owner_account, arguments.get("sender_address")):
                owner = actor
            elif not explicit_owner:
                owner = _derive_user_identity(user_id, owner_account)
            else:
                owner = _derive_user_identity(None, owner_account)
            ensure_user(conn, owner)
            cert = CertificateRecord(
                id=cert_identifier,
                owner_did=owner.did,
                owner_account_address=owner.account_address,
                previous_owner_did=owner.did,
                previous_owner_account_address=owner.account_address,
                issuer_did=actor.did,
                issuer_account_address=actor.account_address,
                device_id=arguments.get("device_id"),
                device_name="GEC Device",
                energy_source=result_body.get("energy_source") or arguments.get("energy_source") or "",
                energy_amount=float(result_body.get("issued_quantity") or arguments.get("energy_amount") or 0),
                prod_start=arguments.get("prod_start"),
                prod_end=arguments.get("prod_end"),
                timestamp=arguments.get("prod_start") or result_body.get("created_at") or now,
                location=result_body.get("location") or arguments.get("location") or "",
                status="ACTIVE",
                tx_hash=tx_hash,
                explorer_url=explorer_url,
                created_at=result_body.get("created_at") or now,
                updated_at=now,
            )
            upsert_certificate(conn, cert)
            create_transaction(
                conn,
                TransactionRecord(
                    certificate_id=cert.id,
                    operation="CREATE",
                    actor_did=actor.did,
                    actor_account_address=actor.account_address,
                    tx_hash=tx_hash,
                    metadata_json=json.dumps({"tool_name": tool_name, "arguments": arguments}),
                    occurred_at=now,
                ),
            )
            create_notification(
                conn,
                NotificationRecord(
                    user_did=owner.did,
                    title="Certificate issued",
                    body=f"Certificate {cert.id} was issued successfully.",
                    category="CERTIFICATE",
                    related_certificate_id=cert.id,
                    related_tx_hash=tx_hash,
                    created_at=now,
                ),
            )

        elif tool_name in {"cert_transfer", "cert_claim", "cert_cancel"}:
            cert_id = arguments.get("cert_id")
            cert_identifier = None
            current = None
            if cert_id is not None:
                # Try legacy format first, then display-id suffix lookup.
                cert_identifier = f"GEC-{cert_id}"
                current = get_certificate_by_id(cert_identifier)
                if not current:
                    display_id = _find_certificate_id_by_numeric_suffix(conn, int(cert_id))
                    if display_id:
                        cert_identifier = display_id
                        current = get_certificate_by_id(cert_identifier)

            if current:
                new_owner_account = current["owner_account_address"]
                prev_owner_did = current["owner_did"]
                prev_owner_account = current["owner_account_address"]
                status = current["status"]
                if tool_name == "cert_transfer":
                    new_owner_account = arguments.get("recipient")
                    status = "ACTIVE"
                elif tool_name == "cert_claim":
                    status = "RETIRED"
                elif tool_name == "cert_cancel":
                    status = "CANCELLED"

                new_owner = _derive_user_identity(user_id if tool_name != "cert_transfer" else arguments.get("recipient"), new_owner_account)
                ensure_user(conn, new_owner)
                cert = CertificateRecord(
                    id=current["id"],
                    owner_did=new_owner.did,
                    owner_account_address=new_owner.account_address,
                    previous_owner_did=prev_owner_did,
                    previous_owner_account_address=prev_owner_account,
                    issuer_did=current["issuer_did"],
                    issuer_account_address=current["issuer_account_address"],
                    device_id=current["device_id"],
                    device_name=current["device_name"],
                    energy_source=current["energy_source"],
                    energy_amount=float(current["energy_amount"]),
                    prod_start=current["prod_start"],
                    prod_end=current["prod_end"],
                    timestamp=current["timestamp"],
                    location=current["location"],
                    status=status,
                    tx_hash=tx_hash,
                    explorer_url=explorer_url or current["explorer_url"],
                    created_at=current["created_at"],
                    updated_at=now,
                )
                upsert_certificate(conn, cert)
                create_transaction(
                    conn,
                    TransactionRecord(
                        certificate_id=cert.id,
                        operation={
                            "cert_transfer": "TRANSFER",
                            "cert_claim": "RETIRE",
                            "cert_cancel": "CANCEL",
                        }[tool_name],
                        actor_did=actor.did,
                        actor_account_address=actor.account_address,
                        recipient_did=new_owner.did if tool_name == "cert_transfer" else None,
                        recipient_account_address=new_owner.account_address if tool_name == "cert_transfer" else None,
                        tx_hash=tx_hash,
                        metadata_json=json.dumps({"tool_name": tool_name, "arguments": arguments}),
                        occurred_at=now,
                    ),
                )

        elif tool_name in {"market_list", "market_request_buy", "market_cancel", "market_accept_buy"}:
            cert_id = arguments.get("cert_id")
            certificate_identifier = f"GEC-{cert_id}" if cert_id is not None else None
            listing_id_arg = arguments.get("listing_id")
            listing_id_str = str(int(listing_id_arg)) if listing_id_arg is not None else None

            def _certificate_id_for_listing_tx() -> Optional[str]:
                if certificate_identifier:
                    return certificate_identifier
                if not listing_id_str:
                    return None
                row = conn.execute(
                    "SELECT certificate_id FROM marketplace_listings WHERE listing_id = ?",
                    (listing_id_str,),
                ).fetchone()
                return row["certificate_id"] if row else None

            if tool_name == "market_list" and certificate_identifier:
                lid = result_body.get("listing_id")
                listing_id_val = str(int(lid)) if lid is not None else listing_id_str
                upsert_marketplace_listing(
                    conn,
                    MarketplaceListingRecord(
                        certificate_id=certificate_identifier,
                        seller_did=actor.did,
                        seller_account_address=actor.account_address,
                        listing_id=listing_id_val,
                        price=float(arguments.get("price") or 0),
                        currency="PKR",
                        listed_at=now,
                        updated_at=now,
                        status="OPEN",
                        tx_hash=tx_hash,
                    ),
                )
            elif tool_name == "market_request_buy" and listing_id_str:
                buyer = _derive_user_identity(user_id, actor_account)
                ensure_user(conn, buyer)
                conn.execute(
                    """
                    UPDATE marketplace_listings
                    SET status = ?, buyer_did = ?, buyer_account_address = ?, updated_at = ?, tx_hash = ?
                    WHERE listing_id = ?
                    """,
                    ("PENDING", buyer.did, buyer.account_address, now, tx_hash, listing_id_str),
                )
            elif tool_name == "market_cancel" and listing_id_str:
                conn.execute(
                    """
                    UPDATE marketplace_listings
                    SET status = ?, updated_at = ?, tx_hash = ?
                    WHERE listing_id = ?
                    """,
                    ("CANCELLED", now, tx_hash, listing_id_str),
                )
            elif tool_name == "market_accept_buy" and listing_id_str:
                conn.execute(
                    """
                    UPDATE marketplace_listings
                    SET status = ?, updated_at = ?, tx_hash = ?
                    WHERE listing_id = ?
                    """,
                    ("SOLD", now, tx_hash, listing_id_str),
                )

            cert_for_tx = _certificate_id_for_listing_tx()
            create_transaction(
                conn,
                TransactionRecord(
                    certificate_id=cert_for_tx,
                    operation={
                        "market_list": "LIST",
                        "market_request_buy": "REQUEST_BUY",
                        "market_cancel": "LISTING_CANCEL",
                        "market_accept_buy": "TRADE",
                    }[tool_name],
                    actor_did=actor.did,
                    actor_account_address=actor.account_address,
                    tx_hash=tx_hash,
                    metadata_json=json.dumps({"tool_name": tool_name, "arguments": arguments}),
                    occurred_at=now,
                ),
            )

        elif tool_name == "audit_log":
            create_transaction(
                conn,
                TransactionRecord(
                    certificate_id=None,
                    operation=arguments.get("action", "AUDIT").upper(),
                    actor_did=actor.did,
                    actor_account_address=actor.account_address,
                    recipient_account_address=arguments.get("target"),
                    tx_hash=tx_hash,
                    metadata_json=json.dumps({"tool_name": tool_name, "details": arguments.get("details", "")}),
                    occurred_at=now,
                ),
            )

        conn.commit()


def search_certificates(
    *,
    owner_did: Optional[str] = None,
    owner_account_address: Optional[str] = None,
    status: Optional[str] = None,
    energy_source: Optional[str] = None,
    start_from: Optional[str] = None,
    start_to: Optional[str] = None,
) -> List[Dict[str, Any]]:
    init_db()
    clauses = []
    params: List[Any] = []

    if owner_did and owner_account_address:
        clauses.append(
            "(owner_did = ? OR LOWER(owner_account_address) = LOWER(?))"
        )
        params.extend([owner_did, owner_account_address])
    elif owner_did:
        clauses.append("owner_did = ?")
        params.append(owner_did)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if energy_source:
        clauses.append("LOWER(energy_source) = LOWER(?)")
        params.append(energy_source)
    if start_from:
        clauses.append("timestamp >= ?")
        params.append(start_from)
    if start_to:
        clauses.append("timestamp <= ?")
        params.append(start_to)

    sql = "SELECT * FROM certificates"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY created_at DESC"

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]


def get_certificate_by_id(certificate_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not certificate_id:
        return None
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT * FROM certificates WHERE id = ?", (certificate_id,)).fetchone()
        return dict(row) if row else None


def list_transactions(
    *,
    certificate_id: Optional[str] = None,
    actor_did: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    init_db()
    clauses = []
    params: List[Any] = []

    if certificate_id:
        clauses.append("certificate_id = ?")
        params.append(certificate_id)
    if actor_did:
        clauses.append("actor_did = ?")
        params.append(actor_did)

    sql = "SELECT * FROM transactions"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY occurred_at DESC LIMIT ?"
    params.append(limit)

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]


def list_marketplace_listings(
    *,
    status: Optional[str] = None,
    seller_did: Optional[str] = None,
    buyer_did: Optional[str] = None,
) -> List[Dict[str, Any]]:
    init_db()
    clauses = []
    params: List[Any] = []

    if status:
        if status == "OPEN":
            clauses.append("status IN (?, ?)")
            params.extend(["OPEN", "PENDING"])
        else:
            clauses.append("status = ?")
            params.append(status)
    if seller_did:
        clauses.append("seller_did = ?")
        params.append(seller_did)
    if buyer_did:
        clauses.append("buyer_did = ?")
        params.append(buyer_did)

    sql = "SELECT * FROM marketplace_listings"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC"

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]


def list_notifications(
    *,
    user_did: str,
    unread_only: bool = False,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    init_db()
    clauses = ["user_did = ?"]
    params: List[Any] = [user_did]

    if unread_only:
        clauses.append("read_at IS NULL")

    sql = "SELECT * FROM notifications WHERE " + " AND ".join(clauses)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]


def get_user_by_did(did: str) -> Optional[Dict[str, Any]]:
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE did = ?", (did,)).fetchone()
        return dict(row) if row else None


def build_user_report(user_did: str, owner_account_address: Optional[str] = None) -> Dict[str, Any]:
    certificates = search_certificates(
        owner_did=user_did,
        owner_account_address=owner_account_address,
    )
    notifications = list_notifications(user_did=user_did, limit=10)
    listings = list_marketplace_listings(seller_did=user_did)
    transactions = list_transactions(actor_did=user_did, limit=20)

    total_energy = sum(float(item.get("energy_amount") or 0) for item in certificates)
    active_count = sum(1 for item in certificates if item.get("status") == "ACTIVE")
    retired_count = sum(1 for item in certificates if item.get("status") == "RETIRED")
    cancelled_count = sum(1 for item in certificates if item.get("status") == "CANCELLED")

    return {
        "user_did": user_did,
        "summary": {
            "certificate_count": len(certificates),
            "active_certificates": active_count,
            "retired_certificates": retired_count,
            "cancelled_certificates": cancelled_count,
            "open_listings": sum(1 for item in listings if item.get("status") in ("OPEN", "PENDING")),
            "total_energy_amount": total_energy,
            "notification_count": len(notifications),
            "transaction_count": len(transactions),
        },
        "recent_certificates": certificates[:10],
        "recent_transactions": transactions[:10],
        "recent_notifications": notifications[:10],
    }
