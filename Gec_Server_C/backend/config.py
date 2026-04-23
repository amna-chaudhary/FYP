import os
from pathlib import Path
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)


def _clean_env_value(v: str) -> str:
    v = (v or "").strip().strip('"').strip("'")
    if v.startswith("ed25519-priv-"):
        v = v[len("ed25519-priv-"):]
    return v.strip()


def _normalize_address(v: str) -> str:
    v = _clean_env_value(v)
    if not v:
        return ""
    if not v.startswith("0x"):
        v = "0x" + v
    return v.lower()


def _normalize_private_key(v: str) -> str:
    v = _clean_env_value(v)
    if v.startswith("0x"):
        v = v[2:]
    return v.lower()


def _first(*keys: str, default: str = "") -> str:
    for k in keys:
        v = os.getenv(k)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return default


OPENAI_API_KEY = _clean_env_value(_first("OPENAI_API_KEY", default=""))

MCP_SERVER_URL = _clean_env_value(
    _first("MCP_SERVER_URL", default="http://localhost:8001/mcp/invoke")
)

APTOS_NODE_URL = _clean_env_value(
    _first("APTOS_NODE_URL", default="https://fullnode.testnet.aptoslabs.com/v1")
)

APTOS_EXPLORER_NETWORK = _clean_env_value(
    _first("APTOS_EXPLORER_NETWORK", "APTOS_NETWORK", default="testnet")
)

MODULE_ADDRESS = _normalize_address(
    _first(
        "MODULE_ADDRESS",
        "GECCHAIN_ADDRESS",
        default="0xc8c1214ccc5ae055ee5bb1eeac57cec4e760dccbdf7ca52b5d2bbcc1c7ed7cdb",
    )
)

DEFAULT_REGISTRY_ADDR = _normalize_address(
    _first("CERT_REGISTRY_ADDR", "DEFAULT_REGISTRY_ADDR", default=MODULE_ADDRESS)
)

DEFAULT_MARKET_ADDR = _normalize_address(
    _first("MARKET_ADDR", "MARKETPLACE_ADDR", "DEFAULT_MARKET_ADDR", default=MODULE_ADDRESS)
)

APTOS_SENDER_ADDRESS = _normalize_address(
    _first("APTOS_SENDER_ADDRESS", default=MODULE_ADDRESS)
)

APTOS_SENDER_PRIVATE_KEY_HEX = _normalize_private_key(
    _first("APTOS_SENDER_PRIVATE_KEY_HEX", "APTOS_PRIVATE_KEY_HEX", default="")
)

print("CONFIG LOADED")
print("OPENAI KEY:", bool(OPENAI_API_KEY))
print("MODULE ADDRESS:", MODULE_ADDRESS)
print("REGISTRY ADDRESS:", DEFAULT_REGISTRY_ADDR)
print("MARKET ADDRESS:", DEFAULT_MARKET_ADDR)
print("SENDER ADDRESS:", APTOS_SENDER_ADDRESS)
print("PRIVATE KEY SET:", bool(APTOS_SENDER_PRIVATE_KEY_HEX))