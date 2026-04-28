import os
from typing import Any, Dict

import requests


RAG_SERVICE_URL = os.getenv("RAG_SERVICE_URL", "http://127.0.0.1:8000").rstrip("/")


def validate_action(action: str, payload: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
    url = f"{RAG_SERVICE_URL}/validate-action"
    body = {"action": action, "payload": payload}

    try:
        resp = requests.post(url, json=body, timeout=timeout)
    except requests.RequestException as exc:
        return {
            "success": False,
            "available": False,
            "allow": True,
            "warnings": [f"RAG validation unavailable: {exc}"],
            "evidence": [],
        }

    try:
        data = resp.json()
    except Exception:
        return {
            "success": False,
            "available": False,
            "allow": True,
            "warnings": ["RAG validation returned a non-JSON response."],
            "evidence": [],
        }

    data.setdefault("available", True)
    data.setdefault("allow", True)
    data.setdefault("warnings", [])
    data.setdefault("violations", [])
    data.setdefault("evidence", [])
    return data
