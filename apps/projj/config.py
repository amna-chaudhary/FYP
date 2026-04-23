from pathlib import Path

from dotenv import load_dotenv

# Compatibility wrapper: load app-level .env before exposing pipeline config.
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from rag.pipeline.config import *  # noqa: F401,F403
