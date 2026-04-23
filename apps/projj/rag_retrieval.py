# rag_retrieval.py
from __future__ import annotations

from typing import List, Dict, Any, Optional, Tuple


def _keyword_boost(question: str, chunk_text: str) -> float:
    """
    Small heuristic boost to help "why/how/benefits/flow/audit" queries.
    Keep boost small to not overpower embeddings.
    """
    q = (question or "").lower()
    t = (chunk_text or "").lower()

    boost = 0.0

    # Why/benefits intent
    if any(w in q for w in ["why", "benefit", "advantages", "purpose", "use case", "usecases"]):
        for kw in ["benefit", "rationale", "purpose", "compliance", "audit", "verify", "verification", "double counting"]:
            if kw in t:
                boost += 0.01

    # How/flow intent
    if any(w in q for w in ["how", "flow", "workflow", "process", "steps", "lifecycle"]):
        for kw in ["issue", "issuance", "create", "mint", "transfer", "retire", "proof", "hash", "metadata"]:
            if kw in t:
                boost += 0.01

    # Blockchain-ish intent
    if any(w in q for w in ["blockchain", "on-chain", "aptos", "tx", "transaction", "hash"]):
        for kw in ["aptos", "tx_hash", "onchain", "on-chain", "metadata_hash", "audit", "mint"]:
            if kw in t:
                boost += 0.01

    return min(boost, 0.08)


def _relevance_from_distance(dist: float) -> float:
    """
    FAISS score returned by LangChain is typically a distance-like value.
    Convert to a relevance-like score where higher is better.
    """
    return 1.0 / (1.0 + float(dist))


def retrieve_evidence(
    vs,
    question: str,
    *,
    top_k: int = 6,
    fetch_k: Optional[int] = None,
    threshold: float = 0.30,
    diversity: bool = True,
    per_file_cap: int = 2,
    use_keyword_boost: bool = True,
) -> List[Dict[str, Any]]:
    """
    Retrieve evidence chunks from a LangChain vector store (FAISS).

    Returns a list of evidence dicts sorted by final_score desc:
      {
        "final_score": float,
        "embedding_relevance": float,
        "boost": float,
        "source": str,
        "chunk_id": int,
        "start_index": Optional[int],
        "text": str
      }

    Features preserved from your original retrieval:
    - keyword boost (small)
    - diversity per file cap
    - threshold filter
    """
    if fetch_k is None:
        fetch_k = max(top_k * 4, 12)

    raw = vs.similarity_search_with_score(question, k=fetch_k)

    scored: List[Dict[str, Any]] = []
    for doc, dist in raw:
        rel = _relevance_from_distance(dist)
        text = doc.page_content or ""
        boost = _keyword_boost(question, text) if use_keyword_boost else 0.0
        final = float(rel + boost)

        ev = {
            "final_score": final,
            "embedding_relevance": float(rel),
            "boost": float(boost),
            "source": doc.metadata.get("source", "unknown"),
            "chunk_id": int(doc.metadata.get("chunk_id", -1)),
            "start_index": doc.metadata.get("start_index", None),
            "text": text,
        }
        scored.append(ev)

    scored.sort(key=lambda x: x["final_score"], reverse=True)

    # Threshold filter
    scored = [e for e in scored if e["final_score"] >= float(threshold)]

    if not diversity:
        return scored[:top_k]

    # Diversity: cap results per file/source
    out: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}

    for e in scored:
        src = e["source"] or "unknown"
        counts.setdefault(src, 0)
        if counts[src] >= per_file_cap:
            continue
        out.append(e)
        counts[src] += 1
        if len(out) >= top_k:
            break

    return out