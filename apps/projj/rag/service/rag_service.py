from contextlib import asynccontextmanager
from typing import Optional
import traceback

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import INDEX_PATH
from rag_index import load_index, build_index
from rag_main import answer_question

VS = None  # global FAISS vectorstore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global VS
    try:
        VS = load_index()
        print(f"[RAG-SERVICE] ✅ Loaded index from {INDEX_PATH}")
    except Exception as e:
        VS = None
        print(f"[RAG-SERVICE] ❌ Index not loaded. Build it manually first. Error: {e}")
        traceback.print_exc()
    yield


app = FastAPI(
    title="GEC RAG Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FrontendChatRequest(BaseModel):
    message: Optional[str] = None
    question: Optional[str] = None
    userId: Optional[str] = None
    mode: Optional[str] = None
    audience: Optional[str] = None
    include_sources: Optional[bool] = None


@app.get("/")
def health():
    return {
        "success": True,
        "reply": {
            "type": "answer",
            "text": "GEC RAG Service is running."
        },
        "meta": {
            "index_loaded": VS is not None,
            "index_path": INDEX_PATH,
            "endpoints": ["/chat", "/build-index"],
        },
    }


@app.post("/build-index")
def build_index_endpoint():
    global VS
    try:
        build_index(force_rebuild=True)
        VS = load_index()
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": "Index rebuilt and reloaded successfully."
            },
        }
    except Exception as e:
        print("[RAG-SERVICE ERROR in /build-index]")
        traceback.print_exc()
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": f"Failed to rebuild index: {str(e)}"
            },
        }


@app.post("/chat")
def chat(req: FrontendChatRequest):
    question = (req.question or req.message or "").strip()

    if not question:
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": "Missing 'message' or 'question' in request body."
            },
        }

    if VS is None:
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": (
                    "⚠️ RAG index is not loaded yet. "
                    "Run: python build_rag_index.py "
                    "(or POST /build-index) and restart the RAG service."
                ),
            },
        }

    try:
        ans = answer_question(question, VS)
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": str(ans),
            },
        }
    except Exception as e:
        print("[RAG-SERVICE ERROR in /chat]")
        traceback.print_exc()
        return {
            "success": True,
            "reply": {
                "type": "answer",
                "text": f"RAG error: {str(e)}",
            },
        }