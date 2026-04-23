import os
from pathlib import Path
from typing import Iterable, List

from config import ALLOWED_EXTENSIONS, REPO_PATH, MAX_CHARS, OVERLAP_CHARS
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter


def iter_files(root: Path = Path(REPO_PATH)) -> Iterable[Path]:
    """
    Yields repository files that match allowed extensions.
    """
    root = Path(root)
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix.lower() in ALLOWED_EXTENSIONS:
                yield p


def read_file(path: Path) -> str:
    """
    Reads a text file safely (ignores decode errors).
    """
    return Path(path).read_text(encoding="utf-8", errors="ignore")


def load_documents(root: Path = Path(REPO_PATH)) -> List[Document]:
    """
    Loads repo files into LangChain Document objects with metadata.
    """
    root = Path(root)
    docs: List[Document] = []
    for fp in iter_files(root):
        rel = str(fp.relative_to(root))
        text = read_file(fp).strip()
        if not text:
            continue
        docs.append(Document(page_content=text, metadata={"source": rel}))
    return docs


def split_documents(
    docs: List[Document],
    chunk_size: int = MAX_CHARS,
    chunk_overlap: int = OVERLAP_CHARS,
) -> List[Document]:
    """
    Splits Documents using LangChain splitter.
    Adds start index metadata for traceability (useful for blockchain proof / auditing).
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=True,
    )
    chunks = splitter.split_documents(docs)

    # Stable chunk ids so you can log/anchor later
    for i, d in enumerate(chunks):
        d.metadata["chunk_id"] = i

    return chunks