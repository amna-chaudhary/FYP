from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.chain_api import router as chain_router
from backend.agent import decide_and_respond
from backend.mcp_client import invoke_tool

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
    message: str


@app.get("/")
def root():
    return {"ok": True, "service": "gec-action-backend"}


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
def chat(req: ChatRequest):
    user_text = req.message or ""
    result = decide_and_respond(user_text)

    print("\n[CHAT INPUT]", user_text)
    print("[AGENT RESULT]", result)

    if result.get("type") == "action":
        mcp_req = result.get("mcp_request") or {}
        tool_name = mcp_req.get("tool_name")
        arguments = mcp_req.get("arguments") or {}

        print("[MCP TOOL]", tool_name)
        print("[MCP ARGS]", arguments)

        raw_mcp_response = invoke_tool(tool_name, arguments)
        print("[RAW MCP RESPONSE]", raw_mcp_response)

        normalized = normalize_mcp_response(raw_mcp_response)
        print("[NORMALIZED MCP RESPONSE]", normalized)

        return {
            "success": True,
            "reply": {
                "type": "mcp_result",
                "mcp_response": normalized
            },
        }

    return {
        "success": True,
        "reply": {
            "type": "answer",
            "text": result.get("text", ""),
        },
    }