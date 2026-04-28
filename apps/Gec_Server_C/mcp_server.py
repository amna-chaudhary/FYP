import json
import logging
import typing as t
import os
from pathlib import Path
from datetime import datetime, timezone

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

OPENAPI_PATH = Path("openapi.json")
UNDERLYING_REST_BASE = os.getenv("UNDERLYING_REST_BASE", "http://127.0.0.1:8001")
TOOL_LOG_PATH = Path(os.getenv("MCP_TOOL_LOG_PATH", "logs/mcp_tool_calls.jsonl"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_server")

app = FastAPI(title="MCP Proxy Server (from OpenAPI)", version="0.1")

if not OPENAPI_PATH.exists():
    logger.error("OpenAPI file not found at %s. Update OPENAPI_PATH.", OPENAPI_PATH)
    raise SystemExit(f"OpenAPI file not found at {OPENAPI_PATH.resolve()}")

with OPENAPI_PATH.open("r", encoding="utf-8") as f:
    openapi = json.load(f)

operation_map: t.Dict[str, t.Dict] = {}
paths = openapi.get("paths", {})


def _resolve_schema(schema: t.Any) -> t.Any:
    if not isinstance(schema, dict):
        return schema

    if "$ref" in schema:
        ref = schema["$ref"]
        if ref.startswith("#/"):
            node: t.Any = openapi
            for part in ref[2:].split("/"):
                node = node.get(part, {})
            return _resolve_schema(node)
        return schema

    resolved = {}
    for key, value in schema.items():
        if key == "properties" and isinstance(value, dict):
            resolved[key] = {k: _resolve_schema(v) for k, v in value.items()}
        elif key == "items":
            resolved[key] = _resolve_schema(value)
        elif key in {"allOf", "oneOf", "anyOf"} and isinstance(value, list):
            resolved[key] = [_resolve_schema(item) for item in value]
        else:
            resolved[key] = value
    return resolved


def _build_input_schema(operation: dict) -> dict:
    result = {"parameters": [], "request_body": None}

    for param in operation.get("parameters", []):
        result["parameters"].append(
            {
                "name": param.get("name"),
                "in": param.get("in"),
                "required": param.get("required", False),
                "description": param.get("description"),
                "schema": _resolve_schema(param.get("schema", {})),
            }
        )

    request_body = operation.get("requestBody", {})
    json_body = request_body.get("content", {}).get("application/json")
    if json_body:
        result["request_body"] = _resolve_schema(json_body.get("schema", {}))

    return result


def _build_output_schema(operation: dict) -> dict:
    result = {}
    for code, meta in operation.get("responses", {}).items():
        json_body = (meta or {}).get("content", {}).get("application/json")
        result[code] = {
            "description": (meta or {}).get("description"),
            "schema": _resolve_schema(json_body.get("schema", {})) if json_body else None,
        }
    return result


def _log_tool_call(entry: dict) -> None:
    TOOL_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TOOL_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")

for path, methods in paths.items():
    for method, operation in methods.items():
        if method.lower() not in {"get", "post", "put", "patch", "delete", "head", "options"}:
            continue
        op_id = operation.get("operationId") or f"{method}_{path}"
        operation_map[op_id] = {
            "method": method.lower(),
            "path": path,
            "operation": operation,
            "input_schema": _build_input_schema(operation),
            "output_schema": _build_output_schema(operation),
        }

logger.info("Loaded %d operations from OpenAPI", len(operation_map))


class MCPInvokeRequest(BaseModel):
    tool_name: str
    arguments: t.Optional[dict] = None
    headers: t.Optional[dict] = None


class MCPInvokeResponse(BaseModel):
    status_code: int
    headers: dict
    body: t.Any


def build_request_for_operation(op_meta: dict, args: dict):
    method = op_meta["method"]
    raw_path = op_meta["path"]
    operation = op_meta["operation"]
    args = args or {}

    path_params = {}
    query_params = {}
    body_json = None

    parameters = operation.get("parameters", [])
    for p in parameters:
        pname = p.get("name")
        loc = p.get("in")
        required = p.get("required", False)

        if loc == "path":
            if pname in args:
                path_params[pname] = args[pname]
            elif required:
                raise HTTPException(status_code=400, detail=f"Missing required path param: {pname}")

        elif loc == "query" and pname in args:
            query_params[pname] = args[pname]

    if "requestBody" in operation:
        if "body" in args and isinstance(args["body"], dict):
            body_json = args["body"]
        else:
            body_json = {
                k: v for k, v in args.items()
                if k not in path_params and k not in query_params
            }

    url_path = raw_path
    for pname, pval in path_params.items():
        url_path = url_path.replace("{" + pname + "}", str(pval))

    url = UNDERLYING_REST_BASE.rstrip("/") + url_path

    return {
        "method": method,
        "url": url,
        "params": query_params if query_params else None,
        "json": body_json,
    }


@app.post("/mcp/invoke", response_model=MCPInvokeResponse)
def mcp_invoke(req: MCPInvokeRequest):
    tool = req.tool_name
    args = req.arguments or {}
    headers = req.headers or {}
    started_at = datetime.now(timezone.utc).isoformat()

    if tool not in operation_map:
        raise HTTPException(status_code=404, detail=f"Tool/operation '{tool}' not found in OpenAPI spec.")

    op_meta = operation_map[tool]

    try:
        req_kwargs = build_request_for_operation(op_meta, args)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error building request")
        raise HTTPException(status_code=400, detail=str(e))

    method = req_kwargs["method"]
    url = req_kwargs["url"]
    params = req_kwargs.get("params")
    json_body = req_kwargs.get("json")

    logger.info(
        "Invoking underlying REST: %s %s (params=%s, body=%s)",
        method.upper(),
        url,
        params,
        json_body,
    )

    try:
        response = requests.request(
            method,
            url,
            params=params,
            json=json_body,
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as e:
        logger.exception("HTTP request failed")
        _log_tool_call(
            {
                "timestamp": started_at,
                "tool_name": tool,
                "method": method.upper(),
                "url": url,
                "params": params,
                "request_body": json_body,
                "success": False,
                "status_code": 502,
                "error": str(e),
            }
        )
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")

    resp_headers = dict(response.headers)
    try:
        resp_body = response.json()
    except ValueError:
        resp_body = response.text

    _log_tool_call(
        {
            "timestamp": started_at,
            "tool_name": tool,
            "method": method.upper(),
            "url": url,
            "params": params,
            "request_body": json_body,
            "success": 200 <= response.status_code < 300,
            "status_code": response.status_code,
            "response_body": resp_body,
        }
    )

    return MCPInvokeResponse(
        status_code=response.status_code,
        headers=resp_headers,
        body=resp_body,
    )


@app.get("/mcp/tools")
def list_tools():
    items = []
    for op_id, meta in operation_map.items():
        items.append({
            "tool_name": op_id,
            "method": meta["method"].upper(),
            "path": meta["path"],
            "summary": meta["operation"].get("summary"),
            "description": meta["operation"].get("description"),
            "input_schema": meta["input_schema"],
            "output_schema": meta["output_schema"],
        })
    return {"count": len(items), "tools": items, "log_path": str(TOOL_LOG_PATH)}
