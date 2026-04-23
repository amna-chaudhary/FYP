# Apps Layout

This repository now uses `apps/` as the canonical application root.

## Canonical Paths

| App | Canonical Path | What It Contains |
| --- | --- | --- |
| Main web + router + RAG | `apps/projj` | Frontend app, Node router backend, Python RAG service |
| Action + MCP stack | `apps/Gec_Server_C` | FastAPI action backend, MCP proxy, Aptos integration |

Use canonical `apps/...` paths in scripts, docs, and IDE setup.

## Environment Templates

- `apps/projj/.env.example`
- `apps/projj/backend/.env.example`
- `apps/Gec_Server_C/.env.example`
- `apps/Gec_Server_C/backend/.env.example`
