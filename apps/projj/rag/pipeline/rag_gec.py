# rag_gec.py
import os
import json
import hashlib
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from config import (
    REPO_PATH,
    INDEX_PATH,
    ALLOWED_EXTENSIONS,
    MAX_CHARS,
    OVERLAP_CHARS,
    RAG_SIMILARITY_THRESHOLD,
)
from llm_clients import get_llm, get_embeddings

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

from langchain_text_splitters import RecursiveCharacterTextSplitter

# Vector store (FAISS) - stable & simple locally
from langchain_community.vectorstores import FAISS


# -------------------------
# Blockchain/MCP-ready audit
# -------------------------
class AuditLogger:
    """
    Writes JSONL events with input/output hashes.
    Later you can:
      - anchor hashes on-chain
      - send events to an MCP tool
      - store logs in IPFS
    """
    def __init__(self, log_path: str = "rag/logs/rag_audit_log.jsonl"):
        self.log_path = Path(log_path)

    @staticmethod
    def _sha256(obj: Any) -> str:
        raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def log_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        record = {
            "event_type": event_type,
            "payload": payload,
            "payload_hash": self._sha256(payload),
        }
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


audit = AuditLogger()


# -------------------------
# Repo ingestion
# -------------------------
def iter_repo_files(root: Path) -> List[Path]:
    files: List[Path] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix.lower() in ALLOWED_EXTENSIONS:
                files.append(p)
    return files


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def load_repo_documents(repo_root: Path) -> List[Document]:
    docs: List[Document] = []
    for fp in iter_repo_files(repo_root):
        rel = str(fp.relative_to(repo_root))
        text = read_text_file(fp).strip()
        if not text:
            continue
        docs.append(Document(page_content=text, metadata={"source": rel}))
    return docs


# -------------------------
# Index build / load
# -------------------------
def index_dir_from_index_path(index_path: Path) -> Path:
    """
    Your old INDEX_PATH was a JSON file. With FAISS we store a directory.
    If INDEX_PATH ends with .json, we convert it to a folder name.
    """
    if index_path.suffix.lower() == ".json":
        return index_path.with_suffix("")  # "gec_rag_index"
    return index_path


def build_or_load_vectorstore(force_rebuild: bool = False) -> FAISS:
    index_dir = index_dir_from_index_path(Path(INDEX_PATH))
    embeddings = get_embeddings()

    if index_dir.exists() and not force_rebuild:
        print(f"[INFO] Loading FAISS index from: {index_dir}")
        return FAISS.load_local(str(index_dir), embeddings, allow_dangerous_deserialization=True)

    print(f"[INFO] Building index from repo: {REPO_PATH}")
    repo_docs = load_repo_documents(Path(REPO_PATH))
    print(f"[INFO] Loaded {len(repo_docs)} raw documents.")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=MAX_CHARS,
        chunk_overlap=OVERLAP_CHARS,
        add_start_index=True,  # gives start index in metadata
    )
    split_docs = splitter.split_documents(repo_docs)
    print(f"[INFO] Split into {len(split_docs)} chunks.")

    # Add stable chunk ids
    for i, d in enumerate(split_docs):
        d.metadata["chunk_id"] = i

    vs = FAISS.from_documents(split_docs, embeddings)
    index_dir.mkdir(parents=True, exist_ok=True)
    vs.save_local(str(index_dir))

    print(f"[INFO] Saved FAISS index to: {index_dir}")

    audit.log_event("index_built", {
        "repo_path": str(REPO_PATH),
        "index_dir": str(index_dir),
        "raw_docs": len(repo_docs),
        "chunks": len(split_docs),
        "chunk_size": MAX_CHARS,
        "overlap": OVERLAP_CHARS,
    })

    return vs


# -------------------------
# Retrieval with threshold
# -------------------------
def retrieve_topk_with_threshold(
    vs: FAISS,
    question: str,
    top_k: int = 5,
    similarity_threshold: float = RAG_SIMILARITY_THRESHOLD
) -> List[Tuple[Document, float]]:
    """
    FAISS returns distances by default; LangChain exposes similarity_search_with_score.
    Lower score can mean closer depending on metric. To keep your threshold idea,
    we do a conservative filter:
      - take top_k*3 candidates
      - normalize into a "relevance-like" score in [0,1] using a simple transform
    This is not perfect, but it behaves predictably for your FYP.
    """
    candidates = vs.similarity_search_with_score(question, k=max(top_k * 3, 10))

    # Turn distance-like score into relevance-like score (bigger is better)
    # relevance = 1 / (1 + distance)
    scored: List[Tuple[Document, float]] = []
    for doc, dist in candidates:
        relevance = 1.0 / (1.0 + float(dist))
        scored.append((doc, relevance))

    scored.sort(key=lambda x: x[1], reverse=True)
    filtered = [(d, s) for (d, s) in scored if s >= similarity_threshold][:top_k]

    audit.log_event("retrieval", {
        "question": question,
        "top_k": top_k,
        "threshold": similarity_threshold,
        "returned": [
            {
                "source": d.metadata.get("source"),
                "chunk_id": d.metadata.get("chunk_id"),
                "start_index": d.metadata.get("start_index"),
                "relevance": s,
            }
            for d, s in filtered
        ]
    })

    return filtered


def format_context(docs_with_scores: List[Tuple[Document, float]]) -> str:
    parts: List[str] = []
    for doc, score in docs_with_scores:
        src = doc.metadata.get("source", "unknown")
        chunk_id = doc.metadata.get("chunk_id", -1)
        start_idx = doc.metadata.get("start_index", None)
        header = f"[source={src} | chunk={chunk_id} | start={start_idx} | relevance={score:.3f}]"
        parts.append(header)
        parts.append(doc.page_content.strip())
        parts.append("\n---\n")
    return "\n".join(parts)


# -------------------------
# RAG chain (LangChain)
# -------------------------
RAG_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are an AI assistant for a Final Year Project about a Green Energy Certificate (GEC) platform.\n"
     "Answer using ONLY the provided CONTEXT.\n"
     "If the answer is not clearly present in the context, say:\n"
     "\"I don't know based on the project documentation.\"\n"
     "When possible, cite the source filenames shown in the context headers."),
    ("human", "CONTEXT:\n{context}\n\nQUESTION: {question}")
])


def answer_question(vs: FAISS, question: str) -> str:
    llm = get_llm()

    docs_with_scores = retrieve_topk_with_threshold(vs, question, top_k=5)
    context = format_context(docs_with_scores)

    chain = (
        {"context": lambda _: context, "question": RunnablePassthrough()}
        | RAG_PROMPT
        | llm
        | StrOutputParser()
    )

    answer = chain.invoke(question)

    audit.log_event("answer", {
        "question": question,
        "answer": answer,
        "context_sources": [
            {"source": d.metadata.get("source"), "chunk_id": d.metadata.get("chunk_id")}
            for d, _ in docs_with_scores
        ],
    })

    return answer


# -------------------------
# Main CLI
# -------------------------
def main():
    vs = build_or_load_vectorstore(force_rebuild=False)

    print("Ask questions about your GEC repo. Type 'exit' to quit.\n")

    while True:
        try:
            q = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n[INFO] Goodbye.")
            break

        if not q:
            continue
        if q.lower() in {"exit", "quit"}:
            print("[INFO] Goodbye.")
            break

        print("[INFO] Thinking with LangChain RAG...")
        ans = answer_question(vs, q)
        print("\nGEC-RAG:", ans, "\n")


if __name__ == "__main__":
    main()
