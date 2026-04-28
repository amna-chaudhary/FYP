import json
import os
import re
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage
from langchain_core.retrievers import BaseRetriever
from langchain_openai import ChatOpenAI

from backend.config import (
    APTOS_SENDER_ADDRESS,
    APTOS_SENDER_PRIVATE_KEY_HEX,
    DEFAULT_MARKET_ADDR,
    DEFAULT_REGISTRY_ADDR,
    OPENAI_API_KEY,
)

if OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY


SYSTEM_PROMPT = """
You are the GEC Action Agent for a Green Energy Certificates platform.

Core rules:
- Be precise and operationally safe.
- Extract user intent and the required parameters from natural language.
- If required data is missing, ask for only the missing fields.
- Never execute destructive actions like transfer, retire/claim, cancel certificate, cancel listing,
  or accept marketplace requests until the user explicitly confirms.
- If intent confidence is low, ask a clarification question instead of guessing.
- Return structured JSON only when asked by the classifier prompt.
""".strip()

CLASSIFIER_PROMPT = """
You are classifying a user request for a Green Energy Certificates platform.

Available intents:
- CERT_INIT
- CERT_ADD_ISSUER
- CERT_REMOVE_ISSUER
- CERT_CREATE
- CERT_TRANSFER
- CERT_RETIRE
- CERT_CANCEL
- MARKET_INIT
- MARKET_LIST
- MARKET_CANCEL
- MARKET_REQUEST_BUY
- MARKET_ACCEPT_BUY
- MARKET_STATS
- AUDIT_INIT
- AUDIT_LOG
- UNKNOWN

Return strict JSON with this shape:
{
  "intent": "INTENT_NAME",
  "confidence": 0.0,
  "reason": "short reason"
}

System rules:
- Prefer UNKNOWN when the message is ambiguous.
- "claim cert X" means CERT_RETIRE.
- "retire cert X" means CERT_RETIRE.
- "list cert X price Y" means MARKET_LIST.
- "buy listing X" means MARKET_REQUEST_BUY.
- "accept buy request X" means MARKET_ACCEPT_BUY.
""".strip()

MAX_MEMORY_MESSAGES = int(os.getenv("GEC_AGENT_MEMORY_SIZE", "12"))

DESTRUCTIVE_INTENTS = {
    "CERT_TRANSFER",
    "CERT_RETIRE",
    "CERT_CANCEL",
    "MARKET_CANCEL",
    "MARKET_ACCEPT_BUY",
}

INTENT_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "CERT_INIT": {"required": [], "destructive": False},
    "CERT_ADD_ISSUER": {"required": ["issuer"], "destructive": False},
    "CERT_REMOVE_ISSUER": {"required": ["issuer"], "destructive": False},
    "CERT_CREATE": {"required": ["energy_amount", "energy_source", "location"], "destructive": False},
    "CERT_TRANSFER": {"required": ["cert_id", "recipient"], "destructive": True},
    "CERT_RETIRE": {"required": ["cert_id"], "destructive": True},
    "CERT_CANCEL": {"required": ["cert_id"], "destructive": True},
    "MARKET_INIT": {"required": [], "destructive": False},
    "MARKET_LIST": {"required": ["cert_id", "price"], "destructive": False},
    "MARKET_CANCEL": {"required": ["listing_id"], "destructive": True},
    "MARKET_REQUEST_BUY": {"required": ["listing_id"], "destructive": False},
    "MARKET_ACCEPT_BUY": {"required": ["listing_id"], "destructive": True},
    "MARKET_STATS": {"required": [], "destructive": False},
    "AUDIT_INIT": {"required": [], "destructive": False},
    "AUDIT_LOG": {"required": [], "destructive": False},
    "UNKNOWN": {"required": [], "destructive": False},
}


conversation_memory: Dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_MEMORY_MESSAGES))
pending_slot_sessions: Dict[str, Dict[str, Any]] = {}
pending_confirmations: Dict[str, Dict[str, Any]] = {}


def _require_env() -> List[str]:
    missing = []
    if not APTOS_SENDER_ADDRESS:
        missing.append("APTOS_SENDER_ADDRESS")
    if not APTOS_SENDER_PRIVATE_KEY_HEX:
        missing.append("APTOS_SENDER_PRIVATE_KEY_HEX")
    return missing


MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
chat_model = ChatOpenAI(model=MODEL_NAME, temperature=0.1) if OPENAI_API_KEY else None


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

        if self.llm is None:
            return {
                "result": (
                    "I could not confidently map that request to a supported blockchain action. "
                    "Please rephrase it with the certificate or listing number and the action you want to perform."
                ),
                "source_documents": docs,
            }

        prompt = (
            "You are a domain assistant for a Green Energy Certificates (GEC) registry.\n"
            "Use the following context (if any) to answer briefly and clearly.\n\n"
            f"Context:\n{context}\n\nQuestion: {query}\nAnswer:"
        )
        chat_resp = self.llm.generate([[HumanMessage(content=prompt)]])
        answer = chat_resp.generations[0][0].text
        return {"result": answer, "source_documents": docs}


qa_chain = SimpleRetrievalQA(llm=chat_model, retriever=vectorstore, k=4)


def _remember(user_id: str, role: str, content: str) -> None:
    conversation_memory[user_id].append({"role": role, "content": content})


def _recent_context(user_id: str) -> str:
    items = list(conversation_memory.get(user_id, []))[-6:]
    if not items:
        return ""
    return "\n".join([f"{item['role']}: {item['content']}" for item in items])


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


# Phrases that indicate the user is issuing a command, not replying with only a place name.
_LOCATION_STANDALONE_BLOCKLIST = re.compile(
    r"\b(issue|create|mint|certificate|certificates|registry|marketplace|aptos|"
    r"transfer|retire|claim|cancel|listing|buy|sell|price|kwh|energy)\b",
    re.IGNORECASE,
)


def _extract_location(user_text: str) -> Optional[str]:
    """Parse a place name from natural language or a short follow-up reply."""
    raw = (user_text or "").strip()
    if not raw:
        return None

    patterns = [
        r"\blocation\s*[:\s]+\s*(.+)$",
        r"\blocated\s+in\s+(.+)$",
        r"\bin\s+([^\n]+)$",
    ]

    for pattern in patterns:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m:
            loc = m.group(1).strip().rstrip(".,; ")
            if loc:
                return loc

    # Single-line reply (slot follow-up): "Lahore", "Punjab, Pakistan", etc.
    # Must not look like a full cert_create command (otherwise "issue 50 solar certificate" matches as "location").
    if len(raw) > 120 or _LOCATION_STANDALONE_BLOCKLIST.search(raw):
        return None
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\s,.\-()/&']*", raw):
        return raw.rstrip(".,; ")

    return None


def _normalize_cert_create_prod_window(slots: Dict[str, Any]) -> None:
    """Expand date-only ISO dates to hourly UTC timestamps; default one-hour window."""
    ps = str(slots.get("prod_start") or "").strip()
    if not ps:
        return
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", ps):
        slots["prod_start"] = f"{ps}T00:00:00Z"

    pe = str(slots.get("prod_end") or "").strip()
    ps = str(slots.get("prod_start") or "").strip()
    if pe and re.fullmatch(r"\d{4}-\d{2}-\d{2}", pe):
        slots["prod_end"] = f"{pe}T00:00:00Z"

    pe = str(slots.get("prod_end") or "").strip()
    if ps and not pe:
        try:
            dt = datetime.fromisoformat(ps.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            end_dt = dt + timedelta(hours=1)
            slots["prod_end"] = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass


def _extract_energy_source(user_text: str) -> Optional[str]:
    sources = ["solar", "wind", "hydro", "biomass", "geothermal", "thermal"]
    lower = user_text.lower()
    for s in sources:
        if s in lower:
            return s
    return None


def _extract_iso_datetimes(user_text: str) -> List[str]:
    patterns = [
        r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z\b",
        r"\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\b",
        r"\b\d{4}-\d{2}-\d{2}\b",
    ]
    found: List[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, user_text):
            if match not in found:
                found.append(match)
    return found


def _extract_cert_id_from_text(user_text: str) -> Optional[int]:
    m = re.search(r"cert(?:ificate)?\s*#?\s*(\d+)", user_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return _extract_u64(user_text)


def _extract_listing_id_from_text(user_text: str) -> Optional[int]:
    m = re.search(r"listing\s*#?\s*(\d+)", user_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return _extract_u64(user_text)


def _extract_price(user_text: str) -> Optional[int]:
    m = re.search(r"\bprice\s+(\d+)\b", user_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    if "pkr" in user_text.lower():
        return _extract_u64(user_text)
    return _extract_u64(user_text)


def _tx_base() -> Dict[str, Any]:
    return {
        "sender_private_key_hex": APTOS_SENDER_PRIVATE_KEY_HEX,
        "sender_address": APTOS_SENDER_ADDRESS,
    }


def _normalize_aptos_owner_address(addr: Optional[str]) -> Optional[str]:
    if not addr or not str(addr).strip():
        return None
    a = str(addr).strip().strip('"').strip("'")
    if not a.startswith("0x"):
        a = "0x" + a
    return a.lower()


def _default_slots(intent: str) -> Dict[str, Any]:
    slots: Dict[str, Any] = {}
    if intent.startswith("CERT_"):
        slots["registry_addr"] = DEFAULT_REGISTRY_ADDR
    if intent.startswith("MARKET_"):
        slots["market_addr"] = DEFAULT_MARKET_ADDR
    return slots


def _fill_slots(intent: str, user_text: str, existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    slots = dict(existing or {})
    slots.update({k: v for k, v in _default_slots(intent).items() if v and not slots.get(k)})

    if intent in {"CERT_ADD_ISSUER", "CERT_REMOVE_ISSUER"}:
        slots["issuer"] = slots.get("issuer") or _extract_hex_address(user_text)
    elif intent == "CERT_CREATE":
        timestamps = _extract_iso_datetimes(user_text)
        slots["energy_amount"] = slots.get("energy_amount") or _extract_u64(user_text)
        slots["energy_source"] = slots.get("energy_source") or _extract_energy_source(user_text)
        slots["location"] = slots.get("location") or _extract_location(user_text)
        if not slots.get("prod_start") and timestamps:
            slots["prod_start"] = timestamps[0]
        if not slots.get("prod_end") and len(timestamps) > 1:
            slots["prod_end"] = timestamps[1]
        slots["registry_addr"] = slots.get("registry_addr") or _extract_hex_address(user_text) or DEFAULT_REGISTRY_ADDR
        _normalize_cert_create_prod_window(slots)
    elif intent == "CERT_TRANSFER":
        addresses = _extract_all_hex_addresses(user_text)
        slots["cert_id"] = slots.get("cert_id") or _extract_cert_id_from_text(user_text)
        slots["recipient"] = slots.get("recipient") or (addresses[-1] if addresses else None)
        slots["registry_addr"] = slots.get("registry_addr") or DEFAULT_REGISTRY_ADDR
    elif intent in {"CERT_RETIRE", "CERT_CANCEL"}:
        slots["cert_id"] = slots.get("cert_id") or _extract_cert_id_from_text(user_text)
        slots["registry_addr"] = slots.get("registry_addr") or DEFAULT_REGISTRY_ADDR
    elif intent == "MARKET_LIST":
        slots["cert_id"] = slots.get("cert_id") or _extract_cert_id_from_text(user_text)
        slots["price"] = slots.get("price") or _extract_price(user_text)
        slots["market_addr"] = slots.get("market_addr") or _extract_hex_address(user_text) or DEFAULT_MARKET_ADDR
    elif intent in {"MARKET_CANCEL", "MARKET_REQUEST_BUY", "MARKET_ACCEPT_BUY"}:
        slots["listing_id"] = slots.get("listing_id") or _extract_listing_id_from_text(user_text)
        slots["market_addr"] = slots.get("market_addr") or DEFAULT_MARKET_ADDR
    elif intent == "MARKET_STATS":
        slots["market_addr"] = slots.get("market_addr") or _extract_hex_address(user_text) or DEFAULT_MARKET_ADDR
    elif intent == "AUDIT_LOG":
        slots["action"] = slots.get("action") or _extract_after_word(user_text, "action") or "manual"
        slots["details"] = slots.get("details") or _extract_after_word(user_text, "details") or user_text
        slots["target"] = slots.get("target") or _extract_hex_address(user_text) or APTOS_SENDER_ADDRESS

    return slots


def _missing_slots(intent: str, slots: Dict[str, Any]) -> List[str]:
    required = INTENT_SCHEMAS.get(intent, {}).get("required", [])
    missing = []
    for name in required:
        value = slots.get(name)
        if value is None or value == "":
            missing.append(name)
    return missing


def _slot_label(name: str) -> str:
    labels = {
        "issuer": "issuer address (0x...)",
        "energy_amount": "energy amount (number, e.g. 50)",
        "energy_source": "energy source (solar/wind/hydro)",
        "location": "location (e.g. Lahore)",
        "cert_id": "certificate id (e.g. cert 1)",
        "recipient": "recipient address (0x...)",
        "listing_id": "listing id (e.g. listing 1)",
        "price": "listing price (number)",
    }
    return labels.get(name, name)


def _ask_for_missing_slots(user_id: str, intent: str, slots: Dict[str, Any], missing: List[str]) -> Dict[str, Any]:
    pending_slot_sessions[user_id] = {"intent": intent, "slots": slots}
    prompt = "\n".join([f"- {_slot_label(item)}" for item in missing])
    understood = "\n".join([f"- {k}: {v}" for k, v in slots.items() if v not in (None, "")]) or "- nothing reliable yet"
    answer = (
        f"I can help with **{intent.lower()}**, but I still need:\n{prompt}\n\n"
        f"So far I understood:\n{understood}\n\n"
        "Reply with the missing value(s), or say `cancel` to stop."
    )
    return {"type": "answer", "text": answer}


def _affirmative(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"yes", "y", "confirm", "confirmed", "proceed", "go ahead", "do it", "sure"}


def _negative(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"no", "n", "cancel", "stop", "never mind", "dont", "don't"}


def _should_use_rag(text: str) -> bool:
    lowered = text.lower()
    return any(
        phrase in lowered
        for phrase in ["how", "what", "why", "explain", "guide", "workflow", "help", "procedure", "steps"]
    )


def _heuristic_intent(user_text: str) -> Dict[str, Any]:
    t = user_text.lower().strip()
    if not t:
        return {"intent": "UNKNOWN", "confidence": 0.0, "reason": "empty message"}

    rules = [
        ("CERT_INIT", lambda s: "init registry" in s or ("cert" in s and "init" in s), 0.98, "registry initialization"),
        ("CERT_ADD_ISSUER", lambda s: "add issuer" in s or "whitelist issuer" in s, 0.97, "issuer add"),
        ("CERT_REMOVE_ISSUER", lambda s: "remove issuer" in s, 0.97, "issuer remove"),
        ("CERT_TRANSFER", lambda s: "transfer" in s and "cert" in s, 0.95, "certificate transfer"),
        ("CERT_RETIRE", lambda s: "claim" in s or "retire" in s, 0.95, "certificate retirement"),
        ("CERT_CANCEL", lambda s: "cancel certificate" in s or ("cancel" in s and "cert" in s) or "void" in s, 0.95, "certificate cancellation"),
        ("CERT_CREATE", lambda s: "issue" in s or "create certificate" in s or "mint" in s or "create gec" in s, 0.93, "certificate creation"),
        ("MARKET_INIT", lambda s: "init marketplace" in s or ("market" in s and "init" in s), 0.97, "market init"),
        ("MARKET_CANCEL", lambda s: "cancel listing" in s, 0.96, "listing cancel"),
        ("MARKET_ACCEPT_BUY", lambda s: "accept buy" in s or "accept purchase" in s or "accept request" in s, 0.95, "accept buy"),
        ("MARKET_REQUEST_BUY", lambda s: ("buy" in s or "request buy" in s) and ("listing" in s or "market" in s), 0.93, "buy request"),
        ("MARKET_LIST", lambda s: "list" in s and ("market" in s or "sale" in s or "price" in s), 0.91, "market list"),
        ("MARKET_STATS", lambda s: "stats" in s and "market" in s, 0.9, "market stats"),
        ("AUDIT_INIT", lambda s: "audit init" in s, 0.97, "audit init"),
        ("AUDIT_LOG", lambda s: "audit" in s and ("log" in s or "record" in s), 0.9, "audit log"),
    ]

    for intent, predicate, confidence, reason in rules:
        if predicate(t):
            return {"intent": intent, "confidence": confidence, "reason": reason}

    return {"intent": "UNKNOWN", "confidence": 0.25, "reason": "no high-confidence rule matched"}


def _llm_intent(user_text: str, user_id: str) -> Optional[Dict[str, Any]]:
    if chat_model is None:
        return None

    context = _recent_context(user_id)
    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"{CLASSIFIER_PROMPT}\n\n"
        f"Recent conversation:\n{context or 'none'}\n\n"
        f"User message:\n{user_text}\n"
    )
    try:
        response = chat_model.invoke([HumanMessage(content=prompt)])
        raw = getattr(response, "content", "") or ""
        data = json.loads(raw)
        intent = str(data.get("intent", "UNKNOWN")).upper()
        confidence = float(data.get("confidence", 0.0))
        reason = str(data.get("reason", ""))
        if intent not in INTENT_SCHEMAS:
            intent = "UNKNOWN"
            confidence = 0.0
        return {"intent": intent, "confidence": confidence, "reason": reason}
    except Exception:
        return None


def classify_intent(user_text: str, user_id: str) -> Dict[str, Any]:
    heuristic = _heuristic_intent(user_text)
    if heuristic["confidence"] >= 0.9:
        return heuristic

    llm_guess = _llm_intent(user_text, user_id)
    if llm_guess and llm_guess["confidence"] >= heuristic["confidence"]:
        return llm_guess

    return heuristic


def _tool_summary(intent: str, slots: Dict[str, Any]) -> str:
    summaries = {
        "CERT_TRANSFER": f"transfer certificate {slots.get('cert_id')} to {slots.get('recipient')}",
        "CERT_RETIRE": f"retire certificate {slots.get('cert_id')}",
        "CERT_CANCEL": f"cancel certificate {slots.get('cert_id')}",
        "MARKET_CANCEL": f"cancel listing {slots.get('listing_id')}",
        "MARKET_ACCEPT_BUY": f"accept buy request for listing {slots.get('listing_id')}",
    }
    return summaries.get(intent, intent.lower())


def _build_action(intent: str, slots: Dict[str, Any], owner_account_address: Optional[str] = None) -> Dict[str, Any]:
    args = _tx_base()

    if intent == "CERT_INIT":
        return {"tool_name": "cert_init", "arguments": args}
    if intent == "CERT_ADD_ISSUER":
        args.update({"registry_addr": slots["registry_addr"], "issuer": slots["issuer"]})
        return {"tool_name": "cert_add_issuer", "arguments": args}
    if intent == "CERT_REMOVE_ISSUER":
        args.update({"registry_addr": slots["registry_addr"], "issuer": slots["issuer"]})
        return {"tool_name": "cert_remove_issuer", "arguments": args}
    if intent == "CERT_CREATE":
        args.update(
            {
                "registry_addr": slots["registry_addr"],
                "energy_source": slots["energy_source"],
                "energy_amount": int(slots["energy_amount"]),
                "location": slots["location"],
                "prod_start": slots.get("prod_start", ""),
                "prod_end": slots.get("prod_end", ""),
            }
        )
        owner = _normalize_aptos_owner_address(owner_account_address) or _normalize_aptos_owner_address(
            slots.get("owner")
        )
        if owner:
            args["owner"] = owner
        return {"tool_name": "cert_create", "arguments": args}
    if intent == "CERT_TRANSFER":
        args.update(
            {
                "registry_addr": slots["registry_addr"],
                "cert_id": int(slots["cert_id"]),
                "recipient": slots["recipient"],
            }
        )
        return {"tool_name": "cert_transfer", "arguments": args}
    if intent == "CERT_RETIRE":
        args.update({"registry_addr": slots["registry_addr"], "cert_id": int(slots["cert_id"])})
        return {"tool_name": "cert_claim", "arguments": args}
    if intent == "CERT_CANCEL":
        args.update({"registry_addr": slots["registry_addr"], "cert_id": int(slots["cert_id"])})
        return {"tool_name": "cert_cancel", "arguments": args}
    if intent == "MARKET_INIT":
        return {"tool_name": "market_init", "arguments": args}
    if intent == "MARKET_LIST":
        args.update(
            {
                "market_addr": slots["market_addr"],
                "cert_id": int(slots["cert_id"]),
                "price": int(slots["price"]),
            }
        )
        return {"tool_name": "market_list", "arguments": args}
    if intent == "MARKET_CANCEL":
        args.update({"market_addr": slots["market_addr"], "listing_id": int(slots["listing_id"])})
        return {"tool_name": "market_cancel", "arguments": args}
    if intent == "MARKET_REQUEST_BUY":
        args.update({"market_addr": slots["market_addr"], "listing_id": int(slots["listing_id"])})
        return {"tool_name": "market_request_buy", "arguments": args}
    if intent == "MARKET_ACCEPT_BUY":
        args.update({"market_addr": slots["market_addr"], "listing_id": int(slots["listing_id"])})
        return {"tool_name": "market_accept_buy", "arguments": args}
    if intent == "MARKET_STATS":
        return {"tool_name": "market_stats", "arguments": {"market_addr": slots["market_addr"]}}
    if intent == "AUDIT_INIT":
        return {"tool_name": "audit_init", "arguments": args}
    if intent == "AUDIT_LOG":
        args.update(
            {
                "action": slots.get("action", "manual"),
                "details": slots.get("details", ""),
                "target": slots.get("target") or APTOS_SENDER_ADDRESS,
            }
        )
        return {"tool_name": "audit_log", "arguments": args}

    raise ValueError(f"Unsupported intent: {intent}")


def _clarification_message() -> Dict[str, Any]:
    return {
        "type": "answer",
        "text": (
            "I’m not fully sure which blockchain action you want. "
            "Try something like `issue 50 solar certificate location Lahore`, "
            "`transfer cert 1 to 0x...`, or `list cert 3 price 100`."
        ),
    }


def _handle_pending_confirmation(user_id: str, user_text: str) -> Optional[Dict[str, Any]]:
    pending = pending_confirmations.get(user_id)
    if not pending:
        return None

    if _affirmative(user_text):
        pending_confirmations.pop(user_id, None)
        return {
            "type": "action",
            "mcp_request": pending["mcp_request"],
            "text": f"Confirmed: {_tool_summary(pending['intent'], pending['slots'])}",
        }

    if _negative(user_text):
        pending_confirmations.pop(user_id, None)
        return {"type": "answer", "text": "Okay, I cancelled that action."}

    return {
        "type": "answer",
        "text": (
            f"I’m waiting for confirmation to {_tool_summary(pending['intent'], pending['slots'])}. "
            "Reply `yes` to continue or `cancel` to stop."
        ),
    }


def _handle_pending_slots(user_id: str, user_text: str, owner_account_address: Optional[str] = None) -> Optional[Dict[str, Any]]:
    pending = pending_slot_sessions.get(user_id)
    if not pending:
        return None

    if _negative(user_text):
        pending_slot_sessions.pop(user_id, None)
        return {"type": "answer", "text": "Okay, I dropped that in-progress request."}

    intent = pending["intent"]
    slots = _fill_slots(intent, user_text, pending.get("slots"))
    missing = _missing_slots(intent, slots)
    if missing:
        pending_slot_sessions[user_id] = {"intent": intent, "slots": slots}
        return _ask_for_missing_slots(user_id, intent, slots, missing)

    pending_slot_sessions.pop(user_id, None)
    return _finalize_intent(user_id, intent, slots, owner_account_address)


def _finalize_intent(
    user_id: str,
    intent: str,
    slots: Dict[str, Any],
    owner_account_address: Optional[str] = None,
) -> Dict[str, Any]:
    mcp_request = _build_action(intent, slots, owner_account_address=owner_account_address)

    if INTENT_SCHEMAS[intent]["destructive"]:
        pending_confirmations[user_id] = {
            "intent": intent,
            "slots": slots,
            "mcp_request": mcp_request,
        }
        return {
            "type": "answer",
            "text": (
                f"I’m ready to {_tool_summary(intent, slots)}.\n\n"
                "Are you sure? Reply `yes` to continue or `cancel` to stop."
            ),
        }

    return {"type": "action", "mcp_request": mcp_request}


def decide_and_respond(
    user_text: str,
    user_id: str = "anonymous",
    owner_account_address: Optional[str] = None,
) -> Dict[str, Any]:
    clean_text = (user_text or "").strip()
    _remember(user_id, "user", clean_text)

    confirmation_response = _handle_pending_confirmation(user_id, clean_text)
    if confirmation_response is not None:
        _remember(user_id, "assistant", confirmation_response.get("text", confirmation_response.get("type", "")))
        return confirmation_response

    pending_slot_response = _handle_pending_slots(user_id, clean_text, owner_account_address)
    if pending_slot_response is not None:
        _remember(user_id, "assistant", pending_slot_response.get("text", pending_slot_response.get("type", "")))
        return pending_slot_response

    missing_env = _require_env()
    if missing_env:
        answer = (
            "I can't execute blockchain actions yet because backend signing config is missing:\n"
            + "\n".join([f"- {item}" for item in missing_env])
        )
        response = {"type": "answer", "text": answer}
        _remember(user_id, "assistant", answer)
        return response

    classification = classify_intent(clean_text, user_id)
    intent = classification["intent"]
    confidence = classification["confidence"]

    if intent == "UNKNOWN":
        if _should_use_rag(clean_text):
            rag_result = qa_chain({"query": clean_text})
            answer = rag_result.get("result") or ""
            response = {"type": "answer", "text": answer}
        else:
            response = _clarification_message()
        _remember(user_id, "assistant", response.get("text", ""))
        return response

    if confidence < 0.55:
        response = _clarification_message()
        _remember(user_id, "assistant", response.get("text", ""))
        return response

    slots = _fill_slots(intent, clean_text)
    missing = _missing_slots(intent, slots)
    if missing:
        response = _ask_for_missing_slots(user_id, intent, slots, missing)
        _remember(user_id, "assistant", response.get("text", ""))
        return response

    response = _finalize_intent(user_id, intent, slots, owner_account_address)
    _remember(user_id, "assistant", response.get("text", response.get("type", "")))
    return response
