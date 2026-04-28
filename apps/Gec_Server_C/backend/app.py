from pathlib import Path

from dotenv import load_dotenv
load_dotenv()
shared_node_env = Path(__file__).resolve().parents[2] / "projj" / "backend" / ".env"
if shared_node_env.exists():
    load_dotenv(shared_node_env, override=False)

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.chain_api import router as chain_router
from backend.aptos_client import view_function
from backend.config import MODULE_ADDRESS, DEFAULT_REGISTRY_ADDR, APTOS_EXPLORER_NETWORK
from backend.agent import decide_and_respond
from backend.mcp_client import invoke_tool
from backend.rag_client import validate_action
from db.registry import (
    build_user_report,
    get_certificate_by_id,
    get_user_by_did,
    list_marketplace_listings,
    list_notifications,
    list_transactions,
    search_certificates,
    sync_action_result,
    user_can_view_certificate,
)


def _same_hex(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False
    aa = str(a).strip().lower()
    bb = str(b).strip().lower()
    if not aa.startswith("0x"):
        aa = "0x" + aa
    if not bb.startswith("0x"):
        bb = "0x" + bb
    return aa == bb


def _parse_cert_identifier(text: str) -> Optional[int]:
    s = str(text or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    up = s.upper()
    if up.startswith("GEC-"):
        parts = s.split("-")
        if len(parts) >= 3 and parts[-1].isdigit():
            return int(parts[-1])
        if s[4:].isdigit():
            return int(s[4:])
    return None


async def _fetch_onchain_certificate(cert_numeric_id: int, registry_addr: str = DEFAULT_REGISTRY_ADDR) -> Optional[dict]:
    base = f"{MODULE_ADDRESS}::gec_certificate"
    view_res = await view_function(f"{base}::get_certificate", [registry_addr, str(int(cert_numeric_id))])
    tuple0 = view_res[0] if isinstance(view_res, list) and view_res else view_res
    if not isinstance(tuple0, list) or len(tuple0) < 13:
        return None

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

    status = {1: "ACTIVE", 2: "RETIRED", 3: "CANCELLED"}.get(int(status_u8), "UNKNOWN")
    created_at_iso = datetime.fromtimestamp(int(created_at_sec), tz=timezone.utc).isoformat()
    display_id = f"GEC-{datetime.fromisoformat(created_at_iso).year}-{int(cid):06d}"

    return {
        "id": display_id,
        "numeric_id": int(cid),
        "owner_account_address": str(owner),
        "previous_owner_account_address": str(previous_owner),
        "issuer_account_address": str(issuer),
        "device_id": str(device_id),
        "device_name": str(device_name),
        "energy_source": str(energy_source),
        "energy_amount": float(energy_amount),
        "prod_start": str(prod_start),
        "prod_end": str(prod_end),
        "timestamp": str(prod_start) if prod_start else created_at_iso,
        "location": str(location),
        "status": status,
        "created_at": created_at_iso,
        "smart_contract_id": MODULE_ADDRESS,
        "network": f"Aptos {APTOS_EXPLORER_NETWORK}",
    }

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = "HS256"
JWT_TTL_HOURS = int(os.getenv("JWT_TTL_HOURS", "24"))

app = FastAPI(title="GEC Backend API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chain_router)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    userId: Optional[str] = None


class LoginRequest(BaseModel):
    did: str = Field(min_length=3)
    accountAddress: Optional[str] = None
    displayName: Optional[str] = None
    walletLabel: Optional[str] = None


def error_response(status_code: int, code: str, message: str, details=None):
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "details": details,
            },
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return error_response(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "VALIDATION_ERROR",
        "Request validation failed.",
        exc.errors(),
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        return error_response(exc.status_code, detail["code"], detail["message"], detail.get("details"))
    return error_response(exc.status_code, "HTTP_ERROR", str(detail))


def create_session_token(*, did: str, account_address: Optional[str], display_name: Optional[str]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": did,
        "did": did,
        "accountAddress": account_address,
        "displayName": display_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def require_auth(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED", "message": "Missing bearer token."},
        )

    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_EXPIRED", "message": "Session token has expired."},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Invalid session token."},
        )

    did = payload.get("did") or payload.get("sub")
    if not did:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Token is missing subject information."},
        )
    return payload


@app.get("/")
def root():
    return {"ok": True, "service": "gec-action-backend"}


@app.post("/auth/login")
def auth_login(req: LoginRequest):
    did = req.did.strip()
    profile = get_user_by_did(did)
    token = create_session_token(
        did=did,
        account_address=req.accountAddress or (profile or {}).get("account_address"),
        display_name=req.displayName or (profile or {}).get("display_name"),
    )
    return {
        "success": True,
        "message": "SSI login flow initiated.",
        "nextStep": "wallet-approve",
        "challenge": {
            "type": "ssi-login",
            "did": did,
            "walletLabel": req.walletLabel or "SSI Wallet",
        },
        "token": token,
        "user": {
            "did": did,
            "accountAddress": req.accountAddress or (profile or {}).get("account_address"),
            "displayName": req.displayName or (profile or {}).get("display_name") or did,
        },
    }


def normalize_mcp_response(raw):
    """
    Normalizes all MCP responses into one stable shape:
    {
        "ok": True/False,
        "status_code": int,
        "body": { actual_result_here }
    }
    """
    if not isinstance(raw, dict):
        return {
            "ok": False,
            "status_code": 500,
            "body": {
                "success": False,
                "detail": "Invalid MCP response format"
            }
        }

    status_code = raw.get("status_code", 500)
    outer_body = raw.get("body", {})

    # MCP proxy nested shape:
    # {
    #   "status_code": 200,
    #   "body": {
    #       "status_code": 200,
    #       "headers": {...},
    #       "body": {
    #           "tx_hash": "...",
    #           "success": true,
    #           ...
    #       }
    #   }
    # }
    if isinstance(outer_body, dict) and isinstance(outer_body.get("body"), dict):
        actual_body = outer_body.get("body", {})
        ok = status_code == 200 and actual_body.get("success") is True
        return {
            "ok": ok,
            "status_code": status_code,
            "body": actual_body
        }

    # Direct usable shape
    ok = status_code == 200 and isinstance(outer_body, dict) and outer_body.get("success") is True
    return {
        "ok": ok,
        "status_code": status_code,
        "body": outer_body if isinstance(outer_body, dict) else {
            "success": False,
            "detail": str(outer_body)
        }
    }


@app.post("/chat")
def chat(req: ChatRequest, session=Depends(require_auth)):
    user_text = req.message or ""
    user_id = req.userId or session.get("did") or "anonymous"
    owner_account_address = session.get("accountAddress")
    result = decide_and_respond(user_text, user_id=user_id, owner_account_address=owner_account_address)

    print("\n[CHAT INPUT]", user_text)
    print("[CHAT USER]", user_id)
    print("[AGENT RESULT]", result)

    if result.get("type") == "action":
        mcp_req = result.get("mcp_request") or {}
        tool_name = mcp_req.get("tool_name")
        arguments = mcp_req.get("arguments") or {}
        validation = validate_action(tool_name, arguments)

        print("[MCP TOOL]", tool_name)
        print("[MCP ARGS]", arguments)
        print("[RAG VALIDATION]", validation)

        if validation.get("allow") is False:
            violations = validation.get("violations") or ["Operation blocked by policy validation."]
            warnings = validation.get("warnings") or []
            details = "\n".join([f"- {item}" for item in violations])
            warning_block = ""
            if warnings:
                warning_block = "\n\nAdditional notes:\n" + "\n".join([f"- {item}" for item in warnings])
            return {
                "success": True,
                "reply": {
                    "type": "answer",
                    "text": f"I can’t execute that action yet because validation failed:\n{details}{warning_block}",
                },
                "validation": validation,
            }

        raw_mcp_response = invoke_tool(tool_name, arguments)
        print("[RAW MCP RESPONSE]", raw_mcp_response)

        normalized = normalize_mcp_response(raw_mcp_response)
        print("[NORMALIZED MCP RESPONSE]", normalized)

        if normalized.get("ok"):
            try:
                sync_action_result(tool_name, arguments, normalized.get("body") or {}, user_id)
            except Exception as exc:
                print("[REGISTRY SYNC ERROR]", repr(exc))

        return {
            "success": True,
            "reply": {
                "type": "mcp_result",
                "mcp_response": normalized
            },
            "validation": validation,
        }

    return {
        "success": True,
        "reply": {
            "type": "answer",
            "text": result.get("text", ""),
        },
    }


@app.get("/certificates")
def list_certificates(
    session=Depends(require_auth),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    energy_source: Optional[str] = Query(default=None),
    start_from: Optional[str] = Query(default=None),
    start_to: Optional[str] = Query(default=None),
):
    user_did = session.get("did")
    account = session.get("accountAddress")
    items = search_certificates(
        owner_did=user_did,
        owner_account_address=account,
        status=status_filter,
        energy_source=energy_source,
        start_from=start_from,
        start_to=start_to,
    )
    return {"success": True, "items": items, "count": len(items)}


@app.get("/certificates/{certificate_id}")
async def certificate_detail(certificate_id: str, session=Depends(require_auth)):
    # Prefer registry DB (contains tx hash + explorer URL), but fall back to on-chain view for deep links.
    record = get_certificate_by_id(certificate_id)

    if not record:
        numeric = _parse_cert_identifier(certificate_id)
        if numeric is None:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Certificate not found."})
        onchain = await _fetch_onchain_certificate(numeric)
        if not onchain:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Certificate not found."})

        viewer = session.get("accountAddress")
        if not (_same_hex(viewer, onchain.get("owner_account_address")) or _same_hex(viewer, onchain.get("previous_owner_account_address"))):
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Certificate access denied."})

        # If the registry DB has a record under the display id, enrich tx fields.
        record = get_certificate_by_id(onchain["id"]) or onchain
        if record is not onchain:
            for k, v in onchain.items():
                record.setdefault(k, v)

    if not user_can_view_certificate(
        user_did=session.get("did"),
        user_account_address=session.get("accountAddress"),
        record=record,
    ):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Certificate access denied."})

    history = list_transactions(certificate_id=record.get("id") or certificate_id, limit=100)
    return {
        "success": True,
        "certificate": record,
        "transactionHistory": history,
        "document": {
            "certificateId": record.get("id"),
            "energySource": record.get("energy_source"),
            "energyAmount": record.get("energy_amount"),
            "deviceId": record.get("device_id"),
            "deviceName": record.get("device_name"),
            "productionStart": record.get("prod_start"),
            "productionEnd": record.get("prod_end"),
            "timestamp": record.get("timestamp") or record.get("created_at"),
            "location": record.get("location"),
            "status": record.get("status"),
            "txHash": record.get("tx_hash"),
            "explorerUrl": record.get("explorer_url"),
            "network": record.get("network"),
            "smartContractId": record.get("smart_contract_id") or MODULE_ADDRESS,
            "currentOwner": record.get("owner_account_address"),
            "previousOwner": record.get("previous_owner_account_address"),
            "issuer": record.get("issuer_account_address"),
            "createdAt": record.get("created_at"),
        },
    }


@app.get("/marketplace")
def marketplace_feed(
    session=Depends(require_auth),
    status_filter: str = Query(default="OPEN", alias="status"),
):
    items = list_marketplace_listings(status=status_filter)
    return {"success": True, "items": items, "count": len(items)}


@app.get("/notifications")
def notification_feed(
    session=Depends(require_auth),
    unread_only: bool = Query(default=False),
):
    user_did = session.get("did")
    items = list_notifications(user_did=user_did, unread_only=unread_only)
    return {"success": True, "items": items, "count": len(items)}


@app.get("/reports")
def reports(session=Depends(require_auth)):
    user_did = session.get("did")
    return {
        "success": True,
        "report": build_user_report(user_did, owner_account_address=session.get("accountAddress")),
    }
