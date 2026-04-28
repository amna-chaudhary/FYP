from __future__ import annotations

import binascii
import inspect
import typing
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from aptos_sdk.account import Account
from aptos_sdk.account_address import AccountAddress
from aptos_sdk.async_client import RestClient
from aptos_sdk.bcs import Serializer
from aptos_sdk.transactions import EntryFunction, TransactionArgument, TransactionPayload

from backend.config import APTOS_NODE_URL, APTOS_EXPLORER_NETWORK


@dataclass
class TxResult:
    tx_hash: str
    success: bool
    vm_status: str | None = None
    explorer_url: str | None = None
    raw_tx: Dict[str, Any] | None = None


def _clean_hex(h: str) -> str:
    h = (h or "").strip().strip('"').strip("'")
    if h.startswith("ed25519-priv-"):
        h = h[len("ed25519-priv-"):]
    if h.startswith("0x"):
        h = h[2:]
    return h.lower()


def _normalize_address(addr: str) -> str:
    addr = (addr or "").strip().strip('"').strip("'")
    if addr and not addr.startswith("0x"):
        addr = "0x" + addr
    return addr.lower()


def _type_hint_includes_str(t: Any) -> bool:
    if t is str:
        return True
    args = getattr(t, "__args__", None)
    if isinstance(args, tuple) and str in args:
        return True
    return False


def _load_key_accepts_str_key() -> bool:
    if not hasattr(Account, "load_key"):
        return False
    try:
        hints = typing.get_type_hints(Account.load_key)
        if _type_hint_includes_str(hints.get("key")):
            return True
    except (TypeError, KeyError, NameError):
        pass
    try:
        load_key_sig = inspect.signature(Account.load_key)
        key_param = load_key_sig.parameters.get("key")
        if not key_param or key_param.annotation is inspect.Parameter.empty:
            return False
        ann = key_param.annotation
        if ann is str or ann == "str":
            return True
        if isinstance(ann, str) and "str" in ann:
            return True
    except (TypeError, ValueError):
        pass
    return False


def account_from_private_key_hex(priv_hex: str) -> Account:
    priv_hex = _clean_hex(priv_hex)

    if hasattr(Account, "load_key"):
        if _load_key_accepts_str_key():
            return Account.load_key(priv_hex)
        try:
            return Account.load_key(priv_hex)
        except TypeError:
            pass

        priv_bytes = binascii.unhexlify(priv_hex)
        return Account.load_key(priv_bytes)

    raise ValueError("Unsupported aptos_sdk version: Account.load_key not found")


def _parse_address(addr: str) -> AccountAddress:
    addr = _normalize_address(addr)

    if hasattr(AccountAddress, "from_str_relaxed"):
        return AccountAddress.from_str_relaxed(addr)

    if hasattr(AccountAddress, "from_str"):
        return AccountAddress.from_str(addr)

    raise ValueError("Unsupported aptos_sdk version: AccountAddress parser not found")


def arg_u64(v: int) -> TransactionArgument:
    return TransactionArgument(int(v), Serializer.u64)


def arg_address(addr: str) -> TransactionArgument:
    return TransactionArgument(_parse_address(addr), Serializer.struct)


def arg_string(s: str) -> TransactionArgument:
    return TransactionArgument(str(s), Serializer.str)


def arg_bytes(v: bytes) -> TransactionArgument:
    return TransactionArgument(v, Serializer.to_bytes)


class AptosTxClient:
    def __init__(self, node_url: str, explorer_network: str = "testnet"):
        self.node_url = node_url.rstrip("/")
        self.rest = RestClient(self.node_url)
        self.explorer_network = explorer_network

    async def _fetch_tx_by_hash(self, txn_hash: str) -> Dict[str, Any]:
        url = f"{self.node_url}/transactions/by_hash/{txn_hash}"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json()

    async def submit_entry_function(
        self,
        sender_private_key_hex: str,
        module_address: str,
        module_name: str,
        function_name: str,
        args: List[TransactionArgument],
        type_args: Optional[List[str]] = None,
        max_gas_amount: Optional[int] = None,
        gas_unit_price: Optional[int] = None,
    ) -> TxResult:
        acct = account_from_private_key_hex(sender_private_key_hex)

        entry = EntryFunction.natural(
            f"{_normalize_address(module_address)}::{module_name}",
            function_name,
            type_args or [],
            args,
        )
        payload = TransactionPayload(entry)

        signed_txn = await self.rest.create_bcs_signed_transaction(acct, payload)
        txn_hash = await self.rest.submit_bcs_transaction(signed_txn)

        tx_info = None

        try:
            tx_info = await self.rest.wait_for_transaction(txn_hash)
        except Exception:
            tx_info = None

        if tx_info is None:
            tx_info = await self._fetch_tx_by_hash(txn_hash)

        success = bool(tx_info.get("success", False))
        vm_status = tx_info.get("vm_status")
        explorer = f"https://explorer.aptoslabs.com/txn/{txn_hash}?network={self.explorer_network}"

        return TxResult(
            tx_hash=txn_hash,
            success=success,
            vm_status=vm_status,
            explorer_url=explorer,
            raw_tx=tx_info,
        )

    async def view(
        self,
        function: str,
        type_arguments: Optional[List[str]] = None,
        arguments: Optional[List[Any]] = None,
    ) -> Any:
        payload: Dict[str, Any] = {
            "function": function,
            "type_arguments": type_arguments or [],
            "arguments": arguments or [],
        }

        url = f"{self.node_url}/view"

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return r.json()


def get_aptos_client() -> AptosTxClient:
    return AptosTxClient(
        node_url=APTOS_NODE_URL,
        explorer_network=APTOS_EXPLORER_NETWORK,
    )


async def submit_entry_function(
    sender_private_key_hex: str,
    module_address: str,
    module_name: str,
    function_name: str,
    args: List[TransactionArgument],
    type_args: Optional[List[str]] = None,
    max_gas_amount: Optional[int] = None,
    gas_unit_price: Optional[int] = None,
) -> TxResult:
    client = get_aptos_client()
    return await client.submit_entry_function(
        sender_private_key_hex=sender_private_key_hex,
        module_address=module_address,
        module_name=module_name,
        function_name=function_name,
        args=args,
        type_args=type_args,
        max_gas_amount=max_gas_amount,
        gas_unit_price=gas_unit_price,
    )


async def view_function(
    function: str,
    args: Optional[List[Any]] = None,
    type_arguments: Optional[List[str]] = None,
) -> Any:
    client = get_aptos_client()
    return await client.view(
        function=function,
        arguments=args or [],
        type_arguments=type_arguments or [],
    )


async def fetch_tx_by_hash(tx_hash: str) -> Dict[str, Any]:
    client = get_aptos_client()
    return await client._fetch_tx_by_hash(tx_hash)
