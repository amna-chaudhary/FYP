import requests
from backend.config import MCP_SERVER_URL


def invoke_tool(tool_name: str, arguments: dict = None, headers: dict = None, timeout: int = 30):
    payload = {
        "tool_name": tool_name,
        "arguments": arguments or {},
        "headers": headers or {},
    }

    try:
        resp = requests.post(MCP_SERVER_URL, json=payload, timeout=timeout)
    except requests.RequestException as e:
        return {
            "status_code": 502,
            "body": {
                "success": False,
                "error": f"Could not reach MCP server: {str(e)}"
            },
            "headers": {},
        }

    try:
        data = resp.json()
    except Exception:
        data = {
            "success": False,
            "error": resp.text
        }

    return {
        "status_code": resp.status_code,
        "body": data,
        "headers": dict(resp.headers),
    }