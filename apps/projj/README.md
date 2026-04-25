# `apps/projj` Structure Guide

This app is now organized into clear runtime domains: `frontend`, `backend`, and `rag`.

## Implemented Structure

```text
apps/projj/
├── frontend/
│   ├── pages/
│   ├── scripts/
│   ├── styles/
│   └── assets/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── utils/
│   ├── server.js
│   └── package.json
├── rag/
│   ├── service/
│   ├── pipeline/
│   ├── scripts/
│   ├── data/
│   ├── index_store/
│   └── logs/
├── index.html               # redirect -> frontend/pages/landing.html
├── landing.html             # redirect -> frontend/pages/landing.html
├── login.html               # redirect -> frontend/pages/login.html
├── otp.html                 # redirect -> frontend/pages/otp.html
├── register.html            # redirect -> frontend/pages/register.html
├── rag_service.py           # compatibility wrapper
├── build_rag_index.py       # compatibility wrapper
├── config.py                # compatibility wrapper
├── llm_clients.py           # compatibility wrapper
├── rag_index.py             # compatibility wrapper
├── rag_main.py              # compatibility wrapper
├── rag_retrieval.py         # compatibility wrapper
├── rag_ingestion.py         # compatibility wrapper
├── rag_gec.py               # compatibility wrapper
├── .env
├── .env.example
├── requirements.txt
├── package.json
└── package-lock.json
```

## Runtime Entry Points

- Frontend main page:
  - `apps/projj/frontend/pages/index.html`
- Node backend:
  - `apps/projj/backend/server.js`
- RAG API service:
  - `apps/projj/rag/service/rag_service.py`

Backward-compatible entry points are kept at app root:

- `apps/projj/index.html` redirects to `frontend/pages/landing.html`
- `apps/projj/rag_service.py` re-exports service objects
- `apps/projj/build_rag_index.py` re-exports index builder script

## Benefits

- Cleaner ownership boundaries:
  - `frontend/` for UI assets and pages
  - `backend/` for Node auth/router
  - `rag/` for Python retrieval pipeline and artifacts
- Safer refactoring with smaller, focused directories.
- Easier CI/CD separation per subsystem.
