import os
import re
from typing import Dict, Any, Optional, List

from langchain_openai import ChatOpenAI
from langchain_core.retrievers import BaseRetriever
from langchain_core.messages import HumanMessage

from backend.config import (
    OPENAI_API_KEY,
    DEFAULT_MARKET_ADDR,
    DEFAULT_REGISTRY_ADDR,
    APTOS_SENDER_ADDRESS,
    APTOS_SENDER_PRIVATE_KEY_HEX,
)

if OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY


def _require_env() -> List[str]:
    missing = []
    if not APTOS_SENDER_ADDRESS:
        missing.append("APTOS_SENDER_ADDRESS")
    if not APTOS_SENDER_PRIVATE_KEY_HEX:
        missing.append("APTOS_SENDER_PRIVATE_KEY_HEX")
    return missing


MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
chat_model = ChatOpenAI(model=MODEL_NAME, temperature=0.1)


class DummyRetriever(BaseRetriever):
    def _get_relevant_documents(self, query):
        from langchain_core.documents import Document
        return [Document(page_content="No documents loaded.", metadata={"source": "dummy"})]


vectorstore = DummyRetriever()


class SimpleRetrievalQA:
    def __init__(self, llm, retriever: BaseRetriever, k: int = 4):
        self.llm = llm
        self.retriever = retriever
        self.k = k

    def __call__(self, inputs: dict):
        query = inputs.get("query") or ""
        docs = self.retriever._get_relevant_documents(query)[: self.k]
        context = "\n\n".join([doc.page_content for doc in docs])
        prompt = (
            "You are a domain assistant for a Green Energy Certificates (GEC) registry.\n"
            "Use the following context (if any) to answer briefly and clearly.\n\n"
            f"Context:\n{context}\n\nQuestion: {query}\nAnswer:"
        )
        chat_resp = self.llm.generate([[HumanMessage(content=prompt)]])
        answer = chat_resp.generations[0][0].text
        return {"result": answer, "source_documents": docs}


qa_chain = SimpleRetrievalQA(llm=chat_model, retriever=vectorstore, k=4)


def _extract_u64(text: str) -> Optional[int]:
    m = re.search(r"\b(\d+)\b", text)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _extract_hex_address(text: str) -> Optional[str]:
    m = re.search(r"(0x[a-fA-F0-9]{10,})", text)
    return m.group(1).lower() if m else None


def _extract_all_hex_addresses(text: str) -> List[str]:
    return [x.lower() for x in re.findall(r"(0x[a-fA-F0-9]{10,})", text)]


def _extract_after_word(user_text: str, word: str) -> Optional[str]:
    pattern = rf"{word}\s+([A-Za-z0-9_\-:/.]+)"
    m = re.search(pattern, user_text, re.IGNORECASE)
    if not m:
        return None
    return m.group(1).rstrip(".,; ")


def _extract_energy_source(user_text: str) -> Optional[str]:
    sources = ["solar", "wind", "hydro", "biomass", "geothermal", "thermal"]
    lower = user_text.lower()
    for s in sources:
        if s in lower:
            return s
    return None


def _extract_cert_id_from_text(user_text: str) -> Optional[int]:
    m = re.search(r"cert\s+(\d+)", user_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return _extract_u64(user_text)


def _missing_fields_message(action: str, missing: List[str], understood: str = "") -> Dict[str, Any]:
    bullet_list = "\n".join([f"- {m}" for m in missing])
    understood_block = f"\n\nI understood:\n{understood}" if understood else ""
    answer = (
        f"⚠ I couldn't complete **{action}** because some required fields are missing.\n\n"
        f"**Missing fields:**\n{bullet_list}"
        f"{understood_block}\n\n"
        f"Please resend with missing values.\n"
    )
    return {"type": "answer", "text": answer}


def _tx_base() -> Dict[str, Any]:
    return {
        "sender_private_key_hex": APTOS_SENDER_PRIVATE_KEY_HEX,
        "sender_address": APTOS_SENDER_ADDRESS,
    }


def decide_and_respond(user_text: str) -> Dict[str, Any]:
    missing_env = _require_env()
    if missing_env:
        return _missing_fields_message(
            "setup",
            [f"Set environment variable: {x}" for x in missing_env],
            understood="Your backend needs sender key+address in backend/.env",
        )

    t = user_text.lower().strip()

    # =========================
    # CERT REGISTRY
    # =========================

    if "init registry" in t or ("cert" in t and "init" in t):
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_init",
                "arguments": _tx_base(),
            },
        }

    if "add issuer" in t or "whitelist issuer" in t:
        issuer = _extract_hex_address(user_text)
        registry_addr = DEFAULT_REGISTRY_ADDR

        missing = []
        if not registry_addr:
            missing.append("registry_addr")
        if not issuer:
            missing.append("issuer address (0x...)")

        if missing:
            return _missing_fields_message(
                "cert_add_issuer",
                missing,
                understood=f"- parsed issuer: {issuer}\n- parsed registry_addr: {registry_addr}",
            )

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "issuer": issuer,
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_add_issuer",
                "arguments": args,
            },
        }

    if "remove issuer" in t:
        issuer = _extract_hex_address(user_text)
        registry_addr = DEFAULT_REGISTRY_ADDR

        missing = []
        if not registry_addr:
            missing.append("registry_addr")
        if not issuer:
            missing.append("issuer address (0x...)")

        if missing:
            return _missing_fields_message(
                "cert_remove_issuer",
                missing,
                understood=f"- parsed issuer: {issuer}\n- parsed registry_addr: {registry_addr}",
            )

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "issuer": issuer,
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_remove_issuer",
                "arguments": args,
            },
        }

    if "issue" in t or "create certificate" in t or "mint" in t or "create gec" in t:
        energy_amount = _extract_u64(user_text)
        energy_source = _extract_energy_source(user_text)
        location = _extract_after_word(user_text, "location")
        registry_addr = _extract_hex_address(user_text) or DEFAULT_REGISTRY_ADDR

        missing: List[str] = []
        if not registry_addr:
            missing.append("registry address")
        if energy_amount is None or energy_amount <= 0:
            missing.append("energy_amount (number) e.g. 50")
        if not energy_source:
            missing.append("energy_source e.g. solar/wind")
        if not location:
            missing.append("location e.g. location Lahore")

        if missing:
            understood = "\n".join([
                f"- parsed registry_addr: {registry_addr}",
                f"- parsed energy_amount: {energy_amount}",
                f"- parsed energy_source: {energy_source}",
                f"- parsed location: {location}",
            ])
            return _missing_fields_message("cert_create", missing, understood)

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "energy_source": energy_source,
            "energy_amount": int(energy_amount),
            "location": location,
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_create",
                "arguments": args,
            },
        }

    if "transfer" in t and "cert" in t:
        cert_id = _extract_cert_id_from_text(user_text)
        addrs = _extract_all_hex_addresses(user_text)
        recipient = addrs[-1] if addrs else None
        registry_addr = DEFAULT_REGISTRY_ADDR

        missing: List[str] = []
        if not registry_addr:
            missing.append("registry_addr")
        if cert_id is None or cert_id <= 0:
            missing.append("cert_id (number) e.g. cert 1")
        if not recipient:
            missing.append("recipient address (0x...)")

        if missing:
            understood = "\n".join([
                f"- parsed registry_addr: {registry_addr}",
                f"- parsed cert_id: {cert_id}",
                f"- parsed recipient: {recipient}",
            ])
            return _missing_fields_message("cert_transfer", missing, understood)

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "cert_id": int(cert_id),
            "recipient": recipient,
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_transfer",
                "arguments": args,
            },
        }

    if "claim" in t or "retire" in t:
        cert_id = _extract_cert_id_from_text(user_text)
        registry_addr = DEFAULT_REGISTRY_ADDR

        missing: List[str] = []
        if not registry_addr:
            missing.append("registry_addr")
        if cert_id is None or cert_id <= 0:
            missing.append("cert_id (number) e.g. cert 1")

        if missing:
            understood = "\n".join([
                f"- parsed registry_addr: {registry_addr}",
                f"- parsed cert_id: {cert_id}",
            ])
            return _missing_fields_message("cert_claim", missing, understood)

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "cert_id": int(cert_id),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_claim",
                "arguments": args,
            },
        }

    if "cancel certificate" in t or ("cancel" in t and "cert" in t) or "void" in t:
        cert_id = _extract_cert_id_from_text(user_text)
        registry_addr = DEFAULT_REGISTRY_ADDR

        missing: List[str] = []
        if not registry_addr:
            missing.append("registry_addr")
        if cert_id is None or cert_id <= 0:
            missing.append("cert_id (number) e.g. cert 1")

        if missing:
            understood = "\n".join([
                f"- parsed registry_addr: {registry_addr}",
                f"- parsed cert_id: {cert_id}",
            ])
            return _missing_fields_message("cert_cancel", missing, understood)

        args = _tx_base()
        args.update({
            "registry_addr": registry_addr,
            "cert_id": int(cert_id),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "cert_cancel",
                "arguments": args,
            },
        }

    # =========================
    # MARKETPLACE
    # =========================

    if "init marketplace" in t or ("market" in t and "init" in t):
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_init",
                "arguments": _tx_base(),
            },
        }

    if "list" in t and ("market" in t or "sale" in t):
        listing_price = _extract_u64(user_text)
        cert_id = _extract_cert_id_from_text(user_text)
        market_addr = _extract_hex_address(user_text) or DEFAULT_MARKET_ADDR

        missing: List[str] = []
        if not market_addr:
            missing.append("market_addr")
        if cert_id is None or cert_id <= 0:
            missing.append("cert_id (e.g. 'cert 3')")
        if listing_price is None or listing_price <= 0:
            missing.append("price (number) e.g. 100")

        if missing:
            understood = "\n".join([
                f"- market_addr: {market_addr}",
                f"- cert_id: {cert_id}",
                f"- price: {listing_price}",
            ])
            return _missing_fields_message("market_list", missing, understood)

        args = _tx_base()
        args.update({
            "market_addr": market_addr,
            "cert_id": int(cert_id),
            "price": int(listing_price),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_list",
                "arguments": args,
            },
        }

    if "cancel listing" in t:
        listing_id = _extract_u64(user_text)
        market_addr = DEFAULT_MARKET_ADDR

        missing: List[str] = []
        if not market_addr:
            missing.append("market_addr")
        if listing_id is None or listing_id <= 0:
            missing.append("listing_id (number) e.g. 1")

        if missing:
            understood = "\n".join([
                f"- market_addr: {market_addr}",
                f"- listing_id: {listing_id}",
            ])
            return _missing_fields_message("market_cancel", missing, understood)

        args = _tx_base()
        args.update({
            "market_addr": market_addr,
            "listing_id": int(listing_id),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_cancel",
                "arguments": args,
            },
        }

    if ("buy" in t or "request buy" in t) and ("listing" in t or "market" in t):
        listing_id = _extract_u64(user_text)
        market_addr = DEFAULT_MARKET_ADDR

        missing: List[str] = []
        if not market_addr:
            missing.append("market_addr")
        if listing_id is None or listing_id <= 0:
            missing.append("listing_id (number) e.g. 1")

        if missing:
            understood = "\n".join([
                f"- market_addr: {market_addr}",
                f"- listing_id: {listing_id}",
            ])
            return _missing_fields_message("market_request_buy", missing, understood)

        args = _tx_base()
        args.update({
            "market_addr": market_addr,
            "listing_id": int(listing_id),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_request_buy",
                "arguments": args,
            },
        }

    if "accept buy" in t or "accept purchase" in t or "accept request" in t:
        listing_id = _extract_u64(user_text)
        market_addr = DEFAULT_MARKET_ADDR

        missing: List[str] = []
        if not market_addr:
            missing.append("market_addr")
        if listing_id is None or listing_id <= 0:
            missing.append("listing_id (number) e.g. 1")

        if missing:
            understood = "\n".join([
                f"- market_addr: {market_addr}",
                f"- listing_id: {listing_id}",
            ])
            return _missing_fields_message("market_accept_buy", missing, understood)

        args = _tx_base()
        args.update({
            "market_addr": market_addr,
            "listing_id": int(listing_id),
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_accept_buy",
                "arguments": args,
            },
        }

    if "stats" in t and "market" in t:
        market_addr = _extract_hex_address(user_text) or DEFAULT_MARKET_ADDR
        if not market_addr:
            return _missing_fields_message("market_stats", ["market_addr"])
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "market_stats",
                "arguments": {"market_addr": market_addr},
            },
        }

    # =========================
    # AUDIT
    # =========================

    if "audit init" in t:
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "audit_init",
                "arguments": _tx_base(),
            },
        }

    if "audit" in t and ("log" in t or "record" in t):
        action = _extract_after_word(user_text, "action") or "manual"
        details = _extract_after_word(user_text, "details") or user_text
        target = _extract_hex_address(user_text) or APTOS_SENDER_ADDRESS

        args = _tx_base()
        args.update({
            "action": action,
            "details": details,
            "target": target,
        })
        return {
            "type": "action",
            "mcp_request": {
                "tool_name": "audit_log",
                "arguments": args,
            },
        }

    rag_result = qa_chain({"query": user_text})
    answer = rag_result.get("result") or ""
    return {"type": "answer", "text": answer}