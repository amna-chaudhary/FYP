import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

REPO_PATH = os.getenv("GEC_REPO_PATH", str(PROJECT_ROOT))

INDEX_PATH = os.getenv("GEC_INDEX_PATH", "rag/index_store/gec_rag_index")

EMBED_MODEL = os.getenv("GEC_EMBED_MODEL", "text-embedding-3-small")
CHAT_MODEL = os.getenv("GEC_CHAT_MODEL", "gpt-4o-mini")

ALLOWED_EXTENSIONS = {
    ".md", ".txt", ".json",
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".html", ".css",
    ".move", ".toml"
}

MAX_CHARS = int(os.getenv("GEC_MAX_CHARS", "1500"))
OVERLAP_CHARS = int(os.getenv("GEC_OVERLAP_CHARS", "200"))
RAG_SIMILARITY_THRESHOLD = float(os.getenv("GEC_RAG_SIMILARITY_THRESHOLD", "0.30"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
