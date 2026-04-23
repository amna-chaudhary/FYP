import os
from pathlib import Path

from config import (
    REPO_PATH,
    INDEX_PATH,
    MAX_CHARS,
    OVERLAP_CHARS,
    ALLOWED_EXTENSIONS,
)
from llm_clients import get_embeddings

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS


# -------------------------
# Ignore heavy / useless folders
# -------------------------
IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    "venv",
    ".venv",
    "env",
    ".env",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    "gec_rag_index",
    ".mypy_cache",
    ".pytest_cache",
}

# Skip very large files (in bytes)
MAX_FILE_SIZE_BYTES = 1024 * 1024  # 1 MB

# Build embeddings in smaller groups
FAISS_BATCH_SIZE = 200


# ---------- Repo ingestion ----------
def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        # In-place filter so os.walk does not descend into ignored dirs
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]

        for name in filenames:
            p = Path(dirpath) / name

            if p.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue

            try:
                if p.stat().st_size > MAX_FILE_SIZE_BYTES:
                    continue
            except Exception:
                continue

            yield p


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def load_repo_documents(repo_root: Path) -> list[Document]:
    docs: list[Document] = []

    for fp in iter_files(repo_root):
        try:
            rel = str(fp.relative_to(repo_root))
            text = read_file(fp).strip()

            if not text:
                continue

            docs.append(
                Document(
                    page_content=text,
                    metadata={"source": rel},
                )
            )
        except Exception as e:
            print(f"[RAG] Skipping file due to read error: {fp} -> {e}")

    return docs


def _index_dir_from_index_path(index_path: Path) -> Path:
    """
    If INDEX_PATH was 'gec_rag_index.json', store FAISS in folder 'gec_rag_index'.
    """
    if index_path.suffix.lower() == ".json":
        return index_path.with_suffix("")
    return index_path


def _batched(items, batch_size: int):
    for i in range(0, len(items), batch_size):
        yield items[i:i + batch_size]


# ---------- Build / Load vector index ----------
def build_index(force_rebuild: bool = False) -> Path:
    """
    Builds a FAISS index from the repository files.
    Returns the directory where the index is stored.
    """
    repo_root = Path(REPO_PATH)
    index_dir = _index_dir_from_index_path(Path(INDEX_PATH))

    if not repo_root.exists() or not repo_root.is_dir():
        raise FileNotFoundError(
            f"[RAG] REPO_PATH does not exist or is not a directory: {repo_root}\n"
            "Fix config.REPO_PATH (or set env var GEC_REPO_PATH) to your cloned repo folder."
        )

    embeddings = get_embeddings()

    if index_dir.exists() and not force_rebuild:
        print(f"[RAG] Index already exists at {index_dir}. Use force_rebuild=True to recreate.")
        return index_dir

    print(f"[RAG] Building index from repo: {repo_root}")
    raw_docs = load_repo_documents(repo_root)
    print(f"[RAG] Loaded {len(raw_docs)} raw documents.")

    if len(raw_docs) == 0:
        raise RuntimeError(
            "[RAG] Loaded 0 documents. This usually means:\n"
            " - ALLOWED_EXTENSIONS doesn't match your repo files, or\n"
            " - the repo folder is empty / wrong path.\n"
            "Check REPO_PATH and ALLOWED_EXTENSIONS in config.py."
        )

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=MAX_CHARS,
        chunk_overlap=OVERLAP_CHARS,
        add_start_index=True,
    )

    chunks = splitter.split_documents(raw_docs)
    print(f"[RAG] Split into {len(chunks)} chunks.")

    if len(chunks) == 0:
        raise RuntimeError("[RAG] Split into 0 chunks. Check your chunking settings and input docs.")

    for i, d in enumerate(chunks):
        d.metadata["chunk_id"] = i

    # Remove old index if rebuilding
    if index_dir.exists() and force_rebuild:
        for child in index_dir.glob("*"):
            try:
                if child.is_file():
                    child.unlink()
            except Exception:
                pass

    index_dir.mkdir(parents=True, exist_ok=True)

    # -------- Memory-safe FAISS creation in batches --------
    vectorstore = None
    total_batches = (len(chunks) + FAISS_BATCH_SIZE - 1) // FAISS_BATCH_SIZE

    for batch_num, batch_docs in enumerate(_batched(chunks, FAISS_BATCH_SIZE), start=1):
        print(f"[RAG] Processing batch {batch_num}/{total_batches} ({len(batch_docs)} chunks)")

        if vectorstore is None:
            vectorstore = FAISS.from_documents(batch_docs, embeddings)
        else:
            vectorstore.add_documents(batch_docs)

    if vectorstore is None:
        raise RuntimeError("[RAG] Failed to create FAISS vectorstore.")

    vectorstore.save_local(str(index_dir))
    print(f"[RAG] Saved FAISS index to: {index_dir}")

    return index_dir


def load_index() -> FAISS:
    """Loads the FAISS vector store index from disk and returns it."""
    index_dir = _index_dir_from_index_path(Path(INDEX_PATH))

    if not index_dir.exists():
        raise FileNotFoundError(f"[RAG] Index not found at {index_dir}. Run build_index() first.")

    embeddings = get_embeddings()
    print(f"[RAG] Loading FAISS index from: {index_dir}")

    return FAISS.load_local(
        str(index_dir),
        embeddings,
        allow_dangerous_deserialization=True,
    )

