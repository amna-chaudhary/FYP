from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.aptos_client import (
    arg_address,
    arg_bytes,
    arg_string,
    arg_u64,
    fetch_tx_by_hash,
    submit_entry_function,
    view_function,
)

from backend.config import MODULE_ADDRESS, DEFAULT_MARKET_ADDR, DEFAULT_REGISTRY_ADDR, APTOS_EXPLORER_NETWORK

from datetime import datetime, timezone

router = APIRouter()


class TxRequest(BaseModel):
    sender_private_key_hex: str
    sender_address: str


class TxResponse(BaseModel):
    tx_hash: str
    success: bool
    vm_status: Optional[str] = None
    explorer_url: Optional[str] = None
    sender_address: Optional[str] = None
    account_id: Optional[str] = None
    owner_account_id: Optional[str] = None
    source_account_id: Optional[str] = None
    target_account_id: Optional[str] = None
    issued_quantity: Optional[int] = None
    transferred_quantity: Optional[int] = None
    retired_quantity: Optional[int] = None
    energy_source: Optional[str] = None
    location: Optional[str] = None
    cert_id: Optional[int] = None
    listing_id: Optional[int] = None
    created_at: Optional[str] = None
    module_address: Optional[str] = None
    display_id: Optional[str] = None


class CertificateViewRecord(BaseModel):
    id: int
    display_id: str
    owner: str
    previous_owner: str
    issuer: str
    device_id: str
    device_name: str
    energy_source: str
    energy_amount: int
    prod_start: str
    prod_end: str
    location: str
    status: str
    created_at: str
    tx_hash: Optional[str] = None
    explorer_url: Optional[str] = None
    network: str = "Aptos"
    smart_contract_id: str = MODULE_ADDRESS


def _unwrap_view_scalar(x, default=0):
    if isinstance(x, list) and len(x) > 0:
        return x[0]
    return default


def _status_from_u8(v: int) -> str:
    # Mirrors Move constants in GECertificate.move
    if v == 1:
        return "ACTIVE"
    if v == 2:
        return "RETIRED"
    if v == 3:
        return "CANCELLED"
    return "UNKNOWN"


def _format_display_id(created_at_iso: str, numeric_id: int) -> str:
    try:
        year = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00")).year
    except Exception:
        year = datetime.now(timezone.utc).year
    return f"GEC-{year}-{int(numeric_id):06d}"


def _iso_from_unix_seconds(sec: int) -> str:
    try:
        return datetime.fromtimestamp(int(sec), tz=timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _parse_cert_identifier(text: str) -> int:
    s = str(text or "").strip()
    if not s:
        raise ValueError("Missing certificate identifier")
    if s.isdigit():
        return int(s)
    # Accept display id like GEC-2026-000123
    if s.upper().startswith("GEC-"):
        parts = s.split("-")
        if len(parts) >= 3 and parts[-1].isdigit():
            return int(parts[-1])
    # Accept GEC-123 (legacy registry id format)
    if s.upper().startswith("GEC-") and s[4:].isdigit():
        return int(s[4:])
    raise ValueError(f"Unsupported certificate identifier: {s}")


def _extract_issued_cert_id_from_tx(raw_tx: dict) -> Optional[int]:
    if not isinstance(raw_tx, dict):
        return None
    events = raw_tx.get("events") or []
    for ev in events:
        try:
            typ = str(ev.get("type") or "")
            data = ev.get("data") or {}
            if typ.endswith("gec_certificate::CertificateIssuedEvent") and "cert_id" in data:
                return int(data["cert_id"])
        except Exception:
            continue
    return None


# =========================
# CERTIFICATES
# =========================

class InitRegistryRequest(TxRequest):
    pass


class AddIssuerRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    issuer: str


class RemoveIssuerRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    issuer: str


class CreateCertificateRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    energy_source: str
    energy_amount: int
    location: str
    owner: Optional[str] = None
    device_id: str = "device-demo"
    prod_start: str = ""
    prod_end: str = ""
    face_value: int = 1


class TransferCertificateRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    cert_id: int
    recipient: str
    quantity: Optional[int] = None
    note: str = "api transfer"


class ClaimCertificateRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    cert_id: int


class CancelCertificateRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    cert_id: int
    beneficiary: str = "api cancel"


@router.post("/certificates/init", response_model=TxResponse, operation_id="cert_init")
async def cert_init(req: InitRegistryRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="init",
            args=[],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/add-issuer", response_model=TxResponse, operation_id="cert_add_issuer")
async def cert_add_issuer(req: AddIssuerRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="add_issuer",
            args=[
                arg_address(req.registry_addr),
                arg_address(req.issuer),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/remove-issuer", response_model=TxResponse, operation_id="cert_remove_issuer")
async def cert_remove_issuer(req: RemoveIssuerRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="remove_issuer",
            args=[
                arg_address(req.registry_addr),
                arg_address(req.issuer),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/create", response_model=TxResponse, operation_id="cert_create")
async def cert_create(req: CreateCertificateRequest):
    try:
        owner = req.owner or req.sender_address

        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="create_certificate_simple",
            args=[
                arg_address(req.registry_addr),
                arg_address(owner),
                arg_string(req.device_id),
                arg_string(req.energy_source),
                arg_string(req.prod_start),
                arg_string(req.prod_end),
                arg_u64(req.energy_amount),
                arg_u64(req.face_value),
                arg_string(req.location),
            ],
        )
        cert_id: Optional[int] = None
        created_at_iso: Optional[str] = None

        try:
            raw_tx = r.raw_tx or await fetch_tx_by_hash(r.tx_hash)
            cert_id = _extract_issued_cert_id_from_tx(raw_tx)
        except Exception:
            cert_id = None

        # If we successfully learned the cert id, fetch full details via view.
        if cert_id is not None:
            base = f"{MODULE_ADDRESS}::gec_certificate"
            view_res = await view_function(
                f"{base}::get_certificate",
                [req.registry_addr, str(int(cert_id))],
            )
            # Aptos view returns a JSON array; first element is the tuple.
            tuple0 = view_res[0] if isinstance(view_res, list) and view_res else view_res
            if isinstance(tuple0, list) and len(tuple0) >= 12:
                created_at_iso = _iso_from_unix_seconds(int(tuple0[11]))
            elif isinstance(tuple0, dict) and "created_at" in tuple0:
                created_at_iso = _iso_from_unix_seconds(int(tuple0["created_at"]))
        if not created_at_iso:
            created_at_iso = datetime.now(timezone.utc).isoformat()

        display_id = _format_display_id(created_at_iso, cert_id or 0)

        return TxResponse(
            **r.__dict__,
            sender_address=req.sender_address,
            account_id=owner,
            owner_account_id=owner,
            issued_quantity=req.energy_amount,
            energy_source=req.energy_source,
            location=req.location,
            cert_id=cert_id,
            created_at=created_at_iso,
            module_address=MODULE_ADDRESS,
            display_id=display_id if cert_id is not None else None,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/chain/certificates/{cert_identifier}",
    response_model=CertificateViewRecord,
    operation_id="cert_view",
)
async def cert_view(cert_identifier: str, registry_addr: str = DEFAULT_REGISTRY_ADDR):
    try:
        cert_id = _parse_cert_identifier(cert_identifier)
        base = f"{MODULE_ADDRESS}::gec_certificate"
        view_res = await view_function(
            f"{base}::get_certificate",
            [registry_addr, str(int(cert_id))],
        )
        tuple0 = view_res[0] if isinstance(view_res, list) and view_res else view_res
        if not isinstance(tuple0, list) or len(tuple0) < 13:
            raise HTTPException(status_code=404, detail="Certificate not found")

        (
            cid,
            owner,
            previous_owner,
            device_id,
            device_name,
            energy_source,
            energy_amount,
            prod_start,
            prod_end,
            location,
            status_u8,
            created_at_sec,
            issuer,
        ) = tuple0[:13]

        created_at_iso = _iso_from_unix_seconds(int(created_at_sec))
        display_id = _format_display_id(created_at_iso, int(cid))
        status = _status_from_u8(int(status_u8))

        return CertificateViewRecord(
            id=int(cid),
            display_id=display_id,
            owner=str(owner),
            previous_owner=str(previous_owner),
            issuer=str(issuer),
            device_id=str(device_id),
            device_name=str(device_name),
            energy_source=str(energy_source),
            energy_amount=int(energy_amount),
            prod_start=str(prod_start),
            prod_end=str(prod_end),
            location=str(location),
            status=status,
            created_at=created_at_iso,
            tx_hash=None,
            explorer_url=None,
            network=f"Aptos {APTOS_EXPLORER_NETWORK}",
            smart_contract_id=MODULE_ADDRESS,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/transfer", response_model=TxResponse, operation_id="cert_transfer")
async def cert_transfer(req: TransferCertificateRequest):
    try:
        qty = req.quantity

        if qty is None:
            base = f"{MODULE_ADDRESS}::gec_certificate"
            view_res = await view_function(
                f"{base}::get_bundle_quantity",
                [req.registry_addr, str(req.cert_id)],
            )
            qty = int(_unwrap_view_scalar(view_res, 1))

        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="transfer_certificate",
            args=[
                arg_address(req.registry_addr),
                arg_u64(req.cert_id),
                arg_address(req.recipient),
                arg_u64(qty),
                arg_bytes(req.note.encode("utf-8")),
            ],
        )
        return TxResponse(
            **r.__dict__,
            sender_address=req.sender_address,
            source_account_id=req.sender_address,
            target_account_id=req.recipient,
            transferred_quantity=qty,
            cert_id=req.cert_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/claim", response_model=TxResponse, operation_id="cert_claim")
async def cert_claim(req: ClaimCertificateRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="claim_certificate",
            args=[
                arg_address(req.registry_addr),
                arg_u64(req.cert_id),
            ],
        )
        return TxResponse(
            **r.__dict__,
            sender_address=req.sender_address,
            account_id=req.sender_address,
            owner_account_id=req.sender_address,
            cert_id=req.cert_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/certificates/cancel", response_model=TxResponse, operation_id="cert_cancel")
async def cert_cancel(req: CancelCertificateRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_certificate",
            function_name="cancel_certificate",
            args=[
                arg_address(req.registry_addr),
                arg_u64(req.cert_id),
                arg_string(req.beneficiary),
            ],
        )
        return TxResponse(
            **r.__dict__,
            sender_address=req.sender_address,
            account_id=req.sender_address,
            owner_account_id=req.sender_address,
            cert_id=req.cert_id,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =========================
# MARKETPLACE
# =========================

class InitMarketplaceRequest(TxRequest):
    pass


class ListCertificateRequest(TxRequest):
    market_addr: str = DEFAULT_MARKET_ADDR
    cert_id: int
    price: int


class CancelListingRequest(TxRequest):
    market_addr: str = DEFAULT_MARKET_ADDR
    listing_id: int


class RequestBuyRequest(TxRequest):
    market_addr: str = DEFAULT_MARKET_ADDR
    listing_id: int


class AcceptBuyRequest(TxRequest):
    market_addr: str = DEFAULT_MARKET_ADDR
    listing_id: int


class MarketplaceStats(BaseModel):
    listing_count: int
    total_trades: int
    total_volume: int


@router.post("/marketplace/init", response_model=TxResponse, operation_id="market_init")
async def market_init(req: InitMarketplaceRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_marketplace",
            function_name="initialize_marketplace",
            args=[],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/marketplace/list", response_model=TxResponse, operation_id="market_list")
async def market_list(req: ListCertificateRequest):
    try:
        base = f"{MODULE_ADDRESS}::gec_marketplace"
        count_before = 0
        try:
            listing_count = await view_function(f"{base}::get_listing_count", [req.market_addr])
            count_before = int(_unwrap_view_scalar(listing_count, 0))
        except Exception:
            count_before = 0

        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_marketplace",
            function_name="list_certificate",
            args=[
                arg_address(req.market_addr),
                arg_u64(req.cert_id),
                arg_u64(req.price),
            ],
        )
        new_listing_id: Optional[int] = None
        if r.success:
            new_listing_id = count_before + 1
        return TxResponse(**r.__dict__, cert_id=req.cert_id, listing_id=new_listing_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/marketplace/cancel", response_model=TxResponse, operation_id="market_cancel")
async def market_cancel(req: CancelListingRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_marketplace",
            function_name="cancel_listing",
            args=[
                arg_address(req.market_addr),
                arg_u64(req.listing_id),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/marketplace/request-buy", response_model=TxResponse, operation_id="market_request_buy")
async def market_request_buy(req: RequestBuyRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_marketplace",
            function_name="request_buy",
            args=[
                arg_address(req.market_addr),
                arg_u64(req.listing_id),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/marketplace/accept-buy", response_model=TxResponse, operation_id="market_accept_buy")
async def market_accept_buy(req: AcceptBuyRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_marketplace",
            function_name="accept_buy_request",
            args=[
                arg_address(req.market_addr),
                arg_u64(req.listing_id),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/marketplace/{market_addr}/stats", response_model=MarketplaceStats, operation_id="market_stats")
async def market_stats(market_addr: str):
    try:
        base = f"{MODULE_ADDRESS}::gec_marketplace"

        listing_count = await view_function(f"{base}::get_listing_count", [market_addr])
        total_trades = await view_function(f"{base}::get_total_trades", [market_addr])
        total_volume = await view_function(f"{base}::get_total_volume", [market_addr])

        return MarketplaceStats(
            listing_count=int(_unwrap_view_scalar(listing_count, 0)),
            total_trades=int(_unwrap_view_scalar(total_trades, 0)),
            total_volume=int(_unwrap_view_scalar(total_volume, 0)),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =========================
# AUDIT
# =========================

class InitAuditRequest(TxRequest):
    pass


class AuditLogRequest(TxRequest):
    action: str
    details: str
    target: str


@router.post("/audit/init", response_model=TxResponse, operation_id="audit_init")
async def audit_init(req: InitAuditRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_audit",
            function_name="init",
            args=[],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/audit/log", response_model=TxResponse, operation_id="audit_log")
async def audit_log(req: AuditLogRequest):
    try:
        r = await submit_entry_function(
            sender_private_key_hex=req.sender_private_key_hex,
            module_address=MODULE_ADDRESS,
            module_name="gec_audit",
            function_name="log",
            args=[
                arg_string(req.action),
                arg_string(req.details),
                arg_address(req.target),
            ],
        )
        return TxResponse(**r.__dict__)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
