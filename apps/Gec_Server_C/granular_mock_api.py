from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

app = FastAPI(title="GranularCertOS Mock API")

class BaseBundleAction(BaseModel):
    account_id: Optional[str] = None
    quantity: Optional[int] = None
    filters: Dict[str, Any] = {}


class CreateCertificateBundleRequest(BaseModel):
    account_id: Optional[str] = None
    device_id: Optional[str] = None
    quantity: Optional[int] = None
    energy_source: Optional[str] = None
    from_datetime: Optional[str] = None
    to_datetime: Optional[str] = None
    filters: Dict[str, Any] = {}


class TransferCertificateBundleRequest(BaseModel):
    source_account_id: Optional[str] = None
    target_account_id: Optional[str] = None
    quantity: Optional[int] = None
    filters: Dict[str, Any] = {}


class CancelCertificateBundleRequest(BaseBundleAction):
    reason: Optional[str] = None


class QueryCertificateBundlesRequest(BaseModel):
    account_id: Optional[str] = None
    device_id: Optional[str] = None
    status: Optional[str] = None
    energy_source: Optional[str] = None
    limit: Optional[int] = 10

@app.post("/certificates/certificates/create")
def create_certificate_bundle(req: CreateCertificateBundleRequest):
    """
    Mock endpoint for issuing GECs.
    """
    return {
        "status": "success",
        "action": "issue_gecs",
        "message": "Mock: GECs issued successfully.",
        "issued_quantity": req.quantity,
        "account_id": req.account_id,
        "device_id": req.device_id,
        "energy_source": req.energy_source,
        "time_window": {
            "from": req.from_datetime,
            "to": req.to_datetime,
        },
        "filters": req.filters,
    }


@app.post("/certificates/certificates/transfer")
def transfer_certificate_bundle(req: TransferCertificateBundleRequest):
    """
    Mock endpoint for transferring GECs between accounts.
    """
    return {
        "status": "success",
        "action": "transfer_gecs",
        "message": "Mock: GECs transferred successfully.",
        "transferred_quantity": req.quantity,
        "source_account_id": req.source_account_id,
        "target_account_id": req.target_account_id,
        "filters": req.filters,
    }


@app.post("/certificates/certificates/cancel")
def cancel_certificate_bundle(req: CancelCertificateBundleRequest):
    """
    Mock endpoint for cancelling/retiring GECs.
    """
    return {
        "status": "success",
        "action": "retire_gecs",
        "message": "Mock: GECs retired/cancelled successfully.",
        "retired_quantity": req.quantity,
        "account_id": req.account_id,
        "reason": req.reason,
        "filters": req.filters,
    }


@app.get("/certificates/certificates/query")
def query_certificate_bundles(
    account_id: Optional[str] = None,
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    energy_source: Optional[str] = None,
    limit: int = 10,
):
    """
    Mock endpoint for querying GEC bundles.
    """
    dummy: List[Dict[str, Any]] = [
        {
            "bundle_id": "BUNDLE001",
            "account_id": account_id or "ACC001",
            "device_id": device_id or "D123",
            "status": status or "active",
            "energy_source": energy_source or "solar",
            "quantity": 50,
        }
    ]
    return {
        "status": "success",
        "action": "query_gecs",
        "message": "Mock: Returning example GEC bundles.",
        "results": dummy[: limit or 10],
    }
