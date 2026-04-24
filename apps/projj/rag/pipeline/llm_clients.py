from __future__ import annotations

from config import OPENAI_API_KEY, CHAT_MODEL, EMBED_MODEL
from langchain_openai import ChatOpenAI, OpenAIEmbeddings


def _require_key() -> str:
    key = (OPENAI_API_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add a valid key in your environment or .env and restart the server."
        )
    return key


def get_llm() -> ChatOpenAI:
    """
    Chat model used for final answer generation.
    """
    key = _require_key()
    return ChatOpenAI(
        model=CHAT_MODEL,
        api_key=key,
        temperature=0.2,
    )


def get_embeddings() -> OpenAIEmbeddings:
    """
    Embedding model used for FAISS indexing + retrieval.
    """
    key = _require_key()
    return OpenAIEmbeddings(
        model=EMBED_MODEL,
        api_key=key,
    )