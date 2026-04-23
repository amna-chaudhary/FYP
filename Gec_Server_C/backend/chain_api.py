from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.aptos_client import (
    arg_address,
    arg_bytes,
    arg_string,
    arg_u64,
    submit_entry_function,
    view_function,
)

from backend.config import MODULE_ADDRESS, DEFAULT_MARKET_ADDR, DEFAULT_REGISTRY_ADDR

router = APIRouter()


class TxRequest(BaseModel):
    sender_private_key_hex: str
    sender_address: str


class TxResponse(BaseModel):
    tx_hash: str
    success: bool
    vm_status: str | None = None
    explorer_url: str | None = None


def _unwrap_view_scalar(x, default=0):
    if isinstance(x, list) and len(x) > 0:
        return x[0]
    return default


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
    owner: str | None = None
    device_id: str = "device-demo"
    prod_start: str = ""
    prod_end: str = ""
    face_value: int = 1


class TransferCertificateRequest(TxRequest):
    registry_addr: str = DEFAULT_REGISTRY_ADDR
    cert_id: int
    recipient: str
    quantity: int | None = None
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
        return TxResponse(**r.__dict__)
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
        return TxResponse(**r.__dict__)
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
        return TxResponse(**r.__dict__)
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
        return TxResponse(**r.__dict__)
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
        return TxResponse(**r.__dict__)
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