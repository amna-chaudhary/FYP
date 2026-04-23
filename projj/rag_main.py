from __future__ import annotations

import re
from typing import Any, Dict, List

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from llm_clients import get_llm
from rag_retrieval import retrieve_evidence


# -------------------------
# Simple intent helpers
# -------------------------

_GREET_RE = re.compile(
    r"^(hi|hello|hey|assalam|assalam-o-alaikum|salam|aoa|good\s+(morning|afternoon|evening))\b",
    re.I,
)

_GEC_KEYWORDS = [
    "gec", "certificate", "certificates", "granular", "energy", "registry", "bundle",
    "issue", "issuance", "mint", "transfer", "retire", "retirement", "audit", "proof",
    "aptos", "mcp", "marketplace", "account", "device", "on-chain", "blockchain"
]


def is_greeting(text: str) -> bool:
    return bool(_GREET_RE.match((text or "").strip()))


def is_in_scope(text: str) -> bool:
    t = (text or "").lower()
    if is_greeting(t):
        return True
    return any(k in t for k in _GEC_KEYWORDS)


# -------------------------
# Prompt
# -------------------------

RAG_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are the assistant for a Final Year Project: a Green Energy Certificate (GEC) platform.\n"
     "Use the provided CONTEXT as your primary source.\n"
     "If the context is insufficient, you may answer briefly from general knowledge, but clearly label it as a general explanation.\n"
     "Be concise and practical. When relevant, mention which file(s) the info came from."),
    ("human", "CONTEXT:\n{context}\n\nQUESTION: {question}")
])


def _format_context(evidence: List[Dict[str, Any]]) -> str:
    if not evidence:
        return ""
    parts: List[str] = []
    for e in evidence:
        header = (
            f"[source={e.get('source','unknown')} | chunk={e.get('chunk_id')} | "
            f"start={e.get('start_index')} | score={e.get('final_score'):.3f}]"
        )
        parts.append(header)
        parts.append((e.get("text") or "").strip())
        parts.append("\n---\n")
    return "\n".join(parts)


def answer_question(question: str, vs, *, top_k: int = 6, threshold: float = 0.30) -> str:
    """
    vs: LangChain FAISS vectorstore (from rag_index.load_index()).
    """
    q = (question or "").strip()
    if not q:
        return "Please type a question."

    # ✅ Friendly greetings
    if is_greeting(q):
        return (
            "Assalam-o-Alaikum! 👋\n\n"
            "I can help with anything about the GEC project: certificates, issuance/transfer/retirement flows, "
            "registry APIs, MCP tools, Aptos on-chain logging, and how the demo app works.\n\n"
            "Try: **What is a GEC?** or **How do I create and transfer a certificate?**"
        )

    # ✅ Don’t hard-block out-of-scope; respond politely
    if not is_in_scope(q):
        return (
            "I can definitely chat 🙂 — but this assistant is optimized for the **GEC project**.\n\n"
            "Ask me about: GEC basics, how issuance/transfer/retirement works, registry endpoints, "
            "Marketplace/Registry UI, MCP tools, or Aptos on-chain audit logs.\n\n"
            "If you still want, rephrase your question and include a GEC keyword (e.g., “in our GEC project, …”)."
        )

    evidence = retrieve_evidence(
        vs,
        q,
        top_k=top_k,
        threshold=threshold,
        diversity=True,
        per_file_cap=2,
        use_keyword_boost=True,
    )

    context = _format_context(evidence)
    llm = get_llm()

    # ✅ If RAG finds nothing, still answer something useful
    if not context.strip():
        return (
            "I couldn't find that in the indexed project repo yet.\n\n"
            "General explanation: A **Green Energy Certificate (GEC)** is a digital certificate representing "
            "a specific amount of electricity generated from renewable sources. It can be **issued**, "
            "**transferred**, and **retired** to claim renewable consumption and avoid double-counting."
        )

    chain = RAG_PROMPT | llm | StrOutputParser()
    return chain.invoke({"context": context, "question": q})