from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class UserRecord:
    did: str
    account_address: str
    display_name: str = ""
    email: Optional[str] = None
    role: Optional[str] = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass
class CertificateRecord:
    id: str
    owner_did: str
    owner_account_address: str
    previous_owner_did: Optional[str] = None
    previous_owner_account_address: Optional[str] = None
    issuer_did: Optional[str] = None
    issuer_account_address: Optional[str] = None
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    energy_source: str = ""
    energy_amount: float = 0.0
    prod_start: Optional[str] = None
    prod_end: Optional[str] = None
    timestamp: Optional[str] = None
    location: str = ""
    status: str = "ACTIVE"
    tx_hash: Optional[str] = None
    explorer_url: Optional[str] = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass
class TransactionRecord:
    certificate_id: Optional[str]
    operation: str
    actor_did: str
    actor_account_address: Optional[str] = None
    recipient_did: Optional[str] = None
    recipient_account_address: Optional[str] = None
    tx_hash: Optional[str] = None
    metadata_json: Optional[str] = None
    occurred_at: str = field(default_factory=utc_now_iso)


@dataclass
class MarketplaceListingRecord:
    certificate_id: str
    seller_did: str
    seller_account_address: Optional[str] = None
    buyer_did: Optional[str] = None
    buyer_account_address: Optional[str] = None
    listing_id: Optional[str] = None
    price: float = 0.0
    currency: str = "PKR"
    listed_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    status: str = "OPEN"
    tx_hash: Optional[str] = None


@dataclass
class NotificationRecord:
    user_did: str
    title: str
    body: str
    category: str
    related_certificate_id: Optional[str] = None
    related_tx_hash: Optional[str] = None
    created_at: str = field(default_factory=utc_now_iso)
    read_at: Optional[str] = None
