# Green Energy Certificate Project Overview

Note: Canonical app locations are now under `apps/`:

- `apps/projj`
- `apps/Gec_Server_C`

Legacy top-level paths (`projj`, `Gec_Server_C`) are kept as compatibility symlinks.

This repository contains a Final Year Project for a Green Energy Certificate (GEC) platform. The project combines a chat-style web interface, Retrieval-Augmented Generation (RAG), an action router, an MCP/OpenAPI proxy, and Aptos blockchain transaction helpers.

In simple terms, the system has two main jobs:

1. Answer user questions about the GEC project using a local RAG knowledge base.
2. Convert concrete user commands into certificate, marketplace, or audit actions on Aptos.

## High-Level Architecture

The project is split into two major application areas:

| Area | Purpose |
| --- | --- |
| `projj/` | Main user-facing app. Includes the EnergyCert Bot frontend, Node.js router backend, authentication, marketplace UI, registry UI, and Python RAG service. |
| `Gec_Server_C/` | Action backend. Includes FastAPI endpoints for Aptos certificate/marketplace/audit actions, an MCP proxy server generated from `openapi.json`, and a simpler frontend prototype. |

The intended runtime flow looks like this:

```text
Browser frontend
    |
    v
Node router backend on :3000
    |
    |-- question/help/procedure intent --> Python RAG service on :8000
    |
    |-- concrete action intent ---------> FastAPI action backend on :8001 or :8000
                                             |
                                             v
                                      Aptos fullnode / Move modules
```

There is also an MCP proxy flow inside `Gec_Server_C`:

```text
FastAPI /chat action decision
    |
    v
MCP client
    |
    v
MCP proxy /mcp/invoke
    |
    v
Underlying REST API from OpenAPI operationId
    |
    v
Aptos transaction endpoint
```

## Root Files

| File | Explanation |
| --- | --- |
| `.gitignore` | Ignores dependency folders, virtual environments, environment files, caches, and VS Code settings. |
| `package.json` | Root-level Node dependency file. It includes `bcryptjs`, `jsonwebtoken`, `mongoose`, and `nodemon`, but the main working Node backend is inside `projj/backend`. |
| `package-lock.json` | Lockfile for the root Node dependencies. |
| `PROJECT_OVERVIEW.md` | This documentation file. |

## `Gec_Server_C`: Action Backend and MCP Proxy

`Gec_Server_C` is the blockchain/action side of the project. It exposes FastAPI routes for certificate registry operations, marketplace operations, and audit logging. It also contains an MCP proxy server that reads `openapi.json` and dynamically exposes API operations as MCP-style tools.

### Important Files

| File | Role |
| --- | --- |
| `Gec_Server_C/backend/app.py` | Main FastAPI action backend. Provides `/`, `/chat`, and includes all blockchain routes from `chain_api.py`. |
| `Gec_Server_C/backend/agent.py` | Parses natural language user messages and decides whether to answer normally or call an MCP tool. |
| `Gec_Server_C/backend/chain_api.py` | Defines actual REST endpoints for certificates, marketplace, and audit actions. |
| `Gec_Server_C/backend/aptos_client.py` | Low-level Aptos client wrapper for signing and submitting transactions and calling view functions. |
| `Gec_Server_C/backend/config.py` | Loads environment variables, normalizes addresses/private keys, and sets default Aptos/module values. |
| `Gec_Server_C/backend/mcp_client.py` | Sends tool invocation requests to the MCP proxy server. |
| `Gec_Server_C/mcp_server.py` | OpenAPI-driven MCP proxy. Reads `openapi.json`, maps `operationId` values to REST calls, and exposes `/mcp/invoke` and `/mcp/tools`. |
| `Gec_Server_C/openapi.json` | OpenAPI specification for GEC certificate, marketplace, audit, and agent operations. |
| `Gec_Server_C/frontend/` | A simpler standalone chat frontend that talks directly to the FastAPI `/chat` endpoint. |
| `Gec_Server_C/backend/requirements.txt` | Python dependencies for FastAPI, LangChain, OpenAI, HTTP clients, dotenv, and Aptos SDK. |
| `Gec_Server_C/pyproject.toml` | Minimal Python project metadata. Currently only lists `fastmcp`. |

### `backend/app.py`

This is the main FastAPI application for action handling.

Key behavior:

- Loads `.env` using `python-dotenv`.
- Creates a FastAPI app named `GEC Backend API`.
- Enables permissive CORS using `allow_origins=["*"]`.
- Includes blockchain/action routes from `backend.chain_api`.
- Defines `POST /chat`, which accepts a message and sends it to `decide_and_respond`.

If the agent returns:

- `type: "answer"`: backend returns a normal chat answer.
- `type: "action"`: backend extracts `tool_name` and `arguments`, invokes the MCP proxy, normalizes the MCP response, and returns it as `mcp_result`.

The `normalize_mcp_response` function is important because MCP responses can arrive in nested shapes. It converts different response formats into one stable shape:

```json
{
  "ok": true,
  "status_code": 200,
  "body": {}
}
```

### `backend/agent.py`

This file is the natural-language action parser.

It uses:

- `ChatOpenAI` for fallback question answering.
- A dummy retriever right now, meaning it does not load real documents inside `Gec_Server_C`.
- Regex helpers to extract numbers, certificate IDs, Aptos addresses, energy source, and location.

Supported action intents include:

| User intent | Tool selected |
| --- | --- |
| `init registry` | `cert_init` |
| `add issuer` / `whitelist issuer` | `cert_add_issuer` |
| `remove issuer` | `cert_remove_issuer` |
| `issue`, `mint`, `create certificate`, `create gec` | `cert_create` |
| `transfer cert` | `cert_transfer` |
| `claim` / `retire` | `cert_claim` |
| `cancel certificate` / `void` | `cert_cancel` |
| `init marketplace` | `market_init` |
| `list ... market/sale` | `market_list` |
| `cancel listing` | `market_cancel` |
| `buy listing` / `request buy` | `market_request_buy` |
| `accept buy` | `market_accept_buy` |
| `market stats` | `market_stats` |
| `audit init` | `audit_init` |
| `audit log` / `audit record` | `audit_log` |

If required values are missing, it returns a helpful missing-fields message instead of attempting a transaction.

Example issue command:

```text
issue 50 solar certificate location Lahore
```

The agent should parse:

- `energy_amount`: `50`
- `energy_source`: `solar`
- `location`: `Lahore`
- `registry_addr`: default registry address from env/config

Then it builds an MCP request for `cert_create`.

### `backend/chain_api.py`

This file contains the actual REST API operations that call Aptos Move functions.

Certificate endpoints:

| Endpoint | Operation ID | Move function |
| --- | --- | --- |
| `POST /certificates/init` | `cert_init` | `gec_certificate::init` |
| `POST /certificates/add-issuer` | `cert_add_issuer` | `gec_certificate::add_issuer` |
| `POST /certificates/remove-issuer` | `cert_remove_issuer` | `gec_certificate::remove_issuer` |
| `POST /certificates/create` | `cert_create` | `gec_certificate::create_certificate_simple` |
| `POST /certificates/transfer` | `cert_transfer` | `gec_certificate::transfer_certificate` |
| `POST /certificates/claim` | `cert_claim` | `gec_certificate::claim_certificate` |
| `POST /certificates/cancel` | `cert_cancel` | `gec_certificate::cancel_certificate` |

Marketplace endpoints:

| Endpoint | Operation ID | Move function |
| --- | --- | --- |
| `POST /marketplace/init` | `market_init` | `gec_marketplace::initialize_marketplace` |
| `POST /marketplace/list` | `market_list` | `gec_marketplace::list_certificate` |
| `POST /marketplace/cancel` | `market_cancel` | `gec_marketplace::cancel_listing` |
| `POST /marketplace/request-buy` | `market_request_buy` | `gec_marketplace::request_buy` |
| `POST /marketplace/accept-buy` | `market_accept_buy` | `gec_marketplace::accept_buy_request` |
| `GET /marketplace/{market_addr}/stats` | `market_stats` | Aptos view functions for listing count, trades, and volume |

Audit endpoints:

| Endpoint | Operation ID | Move function |
| --- | --- | --- |
| `POST /audit/init` | `audit_init` | `gec_audit::init` |
| `POST /audit/log` | `audit_log` | `gec_audit::log` |

All transaction endpoints return a `TxResponse` containing:

- `tx_hash`
- `success`
- `vm_status`
- `explorer_url`

### `backend/aptos_client.py`

This is the Aptos transaction utility layer.

Responsibilities:

- Clean private key values.
- Normalize Aptos addresses.
- Convert arguments into Aptos BCS transaction arguments.
- Create an Aptos account from a private key.
- Build an `EntryFunction`.
- Sign and submit BCS transactions.
- Wait for transaction confirmation.
- Build Aptos Explorer URLs.
- Call Aptos view functions through the fullnode `/view` endpoint.

Important helper functions:

| Function | Purpose |
| --- | --- |
| `arg_u64` | Converts a Python integer into a `u64` transaction argument. |
| `arg_address` | Converts a string address into an Aptos address argument. |
| `arg_string` | Converts a Python string into an Aptos string argument. |
| `arg_bytes` | Converts bytes into a transaction argument. |
| `submit_entry_function` | Signs and submits a Move entry function call. |
| `view_function` | Calls a read-only Aptos view function. |

### `backend/config.py`

This file loads configuration from `Gec_Server_C/backend/.env`.

Important environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Used by LangChain/OpenAI chat model. |
| `MCP_SERVER_URL` | URL for MCP invocation, default `http://localhost:8001/mcp/invoke`. |
| `APTOS_NODE_URL` | Aptos fullnode URL, default testnet fullnode. |
| `APTOS_EXPLORER_NETWORK` or `APTOS_NETWORK` | Explorer network name, default `testnet`. |
| `MODULE_ADDRESS` or `GECCHAIN_ADDRESS` | Address where Move modules are deployed. |
| `CERT_REGISTRY_ADDR` or `DEFAULT_REGISTRY_ADDR` | Default registry resource address. |
| `MARKET_ADDR`, `MARKETPLACE_ADDR`, or `DEFAULT_MARKET_ADDR` | Default marketplace resource address. |
| `APTOS_SENDER_ADDRESS` | Sender account address for transactions. |
| `APTOS_SENDER_PRIVATE_KEY_HEX` or `APTOS_PRIVATE_KEY_HEX` | Sender private key for signing Aptos transactions. |

The config file also prints loaded config status at import time. This helps debugging, but be careful not to print secret values.

### `mcp_server.py`

The MCP proxy dynamically maps OpenAPI operations to tool calls.

Startup behavior:

1. Reads `openapi.json`.
2. Loops through every path and method.
3. Uses each operation's `operationId` as the `tool_name`.
4. Stores method/path metadata in `operation_map`.

Endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /mcp/invoke` | Invoke a tool by `tool_name` and `arguments`. |
| `GET /mcp/tools` | List all tool names loaded from OpenAPI. |

Important detail: `OPENAPI_PATH = Path("openapi.json")`, so the MCP server should be started from the `Gec_Server_C` directory unless this path is changed.

### `Gec_Server_C/frontend`

This is a simpler frontend prototype:

- `index.html` contains a chat UI.
- `app.js` posts user messages to `http://localhost:8000/chat`.
- `styles.css` contains a green/white chat design.

This frontend is useful for testing the FastAPI action backend directly, but the richer frontend is in `projj/`.

## `projj`: Main EnergyCert Bot App

`projj` is the larger application. It includes:

- Main browser UI.
- Node.js backend router.
- MongoDB-backed authentication.
- OTP email verification.
- Session registry and marketplace UI.
- Python RAG service and FAISS index.

### Important Frontend Files

| File | Role |
| --- | --- |
| `projj/index.html` | Main EnergyCert Bot page. Contains sidebar, chat area, marketplace button, registry button, settings menu, theme toggle, and script imports. |
| `projj/styles.css` | Main app styling for chat, sidebar, marketplace, registry, light/dark mode, and layout. |
| `projj/app-config.js` | Global state, API URLs, localStorage helpers, markdown rendering, user state, and JSON POST helper. |
| `projj/app-init.js` | Runs on `DOMContentLoaded`, restores state, wires buttons/input handlers, and calls `renderAll()`. |
| `projj/app-chat.js` | Chat rendering, history sidebar, pinned chats, message actions, topbar, and main chat view logic. |
| `projj/app-marketplace.js` | Marketplace UI, dynamic opportunities, filters, stats, and demo fallback listings. |
| `projj/app-registry.js` | Local registry activity state, transaction history, rejected commands, and response parsing from MCP/blockchain results. |
| `projj/login.html`, `projj/register.html` | Authentication pages. |
| `projj/auth_login.js`, `projj/auth_register.js`, `projj/app-login.js` | Login/register frontend logic. |
| `projj/landing.html` | Landing page. |

### Frontend State Model

The main state is defined in `app-config.js`.

Important state fields:

| Field | Meaning |
| --- | --- |
| `conversations` | Chat history list. |
| `currentId` | Active conversation ID. |
| `view` | Current screen: `chat`, `market`, or `registry`. |
| `user` | Logged-in user object. |
| `token` | JWT token. |
| `registry.accounts` | Session-level account balances and totals. |
| `registry.txs` | Session-level transaction history. |
| `registry.rejected` | Failed/rejected commands. |
| `marketplace` | Marketplace filters, tabs, listings, and selected opportunity. |

The app saves local UI/chat/registry state to browser `localStorage` using:

- `gec_chat_state_v2`
- `gecUser_plain`
- `gecToken_plain`

### Frontend Chat Flow

When the user sends a message:

1. `app-init.js` captures the Enter key or send button click.
2. It calls `handleSend(...)` from the chat logic.
3. The frontend sends a JSON request to `API_URL`.
4. `API_URL` is defined as `http://127.0.0.1:3000/api/chat`.
5. The Node backend decides whether the message is a question or an action.
6. The frontend renders either a normal answer or an MCP/blockchain result.
7. `app-registry.js` tries to update the local registry state from the response.

### Registry UI

`app-registry.js` maintains a local/session view of registry activity. It is not the full source of truth for blockchain state. Instead, it gives the user an immediate UI representation of actions.

It tracks:

- Issued certificates.
- Transfers.
- Retirements/claims/cancellations.
- Failed transactions.
- Proof data such as `tx_hash`, `metadata_hash`, `onchain_id`, and `explorer_url`.

It supports multiple response formats:

- New nested MCP responses.
- Older custom MCP responses.
- Direct blockchain transaction responses.

### Marketplace UI

`app-marketplace.js` builds marketplace opportunities from:

- Session registry transactions.
- Manual listings.
- Manual demands.
- Demo fallback opportunities if no real data exists.

Marketplace tabs:

- `all`
- `buy`
- `sell`

Filters:

- Minimum volume.
- Energy source.
- Status.

The marketplace is currently partly session-driven. Some endpoints proxy real action backend calls, while the UI can also generate demo/session listings from local registry activity.

## `projj/backend`: Node Router Backend

This backend is the central HTTP router for the main frontend.

### Important Files

| File | Role |
| --- | --- |
| `projj/backend/server.js` | Express server, chat routing, auth mounting, marketplace proxy routes. |
| `projj/backend/routes/auth.js` | Registration, login, OTP verification, resend OTP, and current user endpoint. |
| `projj/backend/config/db.js` | MongoDB connection helper. |
| `projj/backend/models/User.js` | User schema with bcrypt password hashing. |
| `projj/backend/models/Otp.js` | OTP schema with hashed codes, expiry, attempts, and consumed state. |
| `projj/backend/models/TrustedDevice.js` | Trusted device tokens for skipping OTP on known devices. |
| `projj/backend/middleware/requireAuth.js` | JWT authentication middleware. |
| `projj/backend/utils/mailer.js` | Nodemailer Gmail OTP email sender. |
| `projj/backend/aptos_service.js` | Placeholder/demo Aptos service functions. |

### `server.js`

The Express app runs on `PORT`, default `3000`.

Main routes:

| Route | Purpose |
| --- | --- |
| `GET /` | Health/status response. |
| `POST /api/chat` | Main chat router. Sends question-like messages to RAG and action-like messages to action backend. |
| `/api/auth/*` | Auth routes from `routes/auth.js`. |
| `GET /api/market/stats` | Proxies marketplace stats to action backend. |
| `POST /api/market/list` | Proxies list certificate request. |
| `POST /api/market/request-buy` | Proxies request-buy request. |
| `POST /api/market/accept-buy` | Proxies accept-buy request. |
| `POST /api/market/cancel` | Proxies cancel-listing request. |
| `POST /api/market/session-listings` | Builds temporary marketplace listings from session registry transactions. |

Important backend URLs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8000` | Python RAG service base URL. |
| `ACTION_BACKEND_URL` | `http://127.0.0.1:8001` | FastAPI action backend base URL. |
| `DEFAULT_MARKET_ADDR` | hardcoded module address | Default marketplace address. |

### Chat Routing Logic

The Node backend uses lightweight intent detection:

- Procedure/question/help words route to RAG.
- Concrete action commands route to the action backend.

Question-like examples:

```text
What is a GEC?
How do I transfer a certificate?
Explain the registry workflow.
```

Action-like examples:

```text
issue 50 solar certificate location Lahore
transfer cert 1 to 0xabc...
claim cert 2
list cert 3 price 100
```

This design is useful because it prevents the system from accidentally executing blockchain actions when the user is only asking for an explanation.

### Authentication Flow

The auth system uses MongoDB, bcrypt, JWT, OTP, and trusted device tokens.

Registration flow:

1. User submits first name, last name, email, password, and confirmation password.
2. Backend validates fields and password length.
3. Password is hashed using bcrypt in `User.js`.
4. OTP is generated and stored as a hash in MongoDB.
5. OTP email is sent using Gmail/Nodemailer.
6. User verifies OTP.
7. Account is marked `verified`.
8. JWT and trusted device token are returned.

Login flow:

1. User submits email/password.
2. Backend verifies bcrypt password.
3. If account is unverified, it sends registration OTP again.
4. If trusted device token is valid, login succeeds immediately.
5. Otherwise, backend sends login OTP.
6. After OTP verification, JWT and new trusted device token are returned.

Important auth environment variables:

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string. |
| `JWT_SECRET` | Secret for signing JWTs. |
| `GMAIL_USER` | Gmail address for OTP emails. |
| `GMAIL_APP_PASSWORD` | Gmail app password. |
| `OTP_EXPIRY_MINUTES` | OTP expiry time, default `10`. |
| `DEVICE_TRUST_DAYS` | Trusted device expiry, default `30`. |
| `MAIL_FROM_NAME` | Display name for outgoing email. |

## `projj`: Python RAG Service

The RAG system indexes project files and answers project-related questions.

### Important Files

| File | Role |
| --- | --- |
| `projj/rag_service.py` | FastAPI service exposing `/`, `/chat`, and `/build-index`. |
| `projj/rag_index.py` | Builds and loads FAISS vector index from repository files. |
| `projj/rag_main.py` | RAG answer generation logic and scope/greeting handling. |
| `projj/rag_retrieval.py` | Evidence retrieval with score conversion, keyword boost, threshold, and per-file diversity. |
| `projj/llm_clients.py` | Creates OpenAI chat and embedding clients. |
| `projj/config.py` | RAG config: repo path, index path, models, chunk sizes, extensions, API key. |
| `projj/build_rag_index.py` | CLI script to rebuild the FAISS index. |
| `projj/gec_rag_index/` | Saved FAISS index files. |
| `projj/rag_audit_log.jsonl` | JSONL audit log for retrieval/index/answer events. |
| `projj/requirements.txt` | Python dependencies for LangChain, Chroma/FAISS-related ecosystem, dotenv, and Streamlit. |

### RAG Service Flow

At startup:

1. `rag_service.py` calls `load_index()`.
2. If the FAISS index exists, it is loaded into global `VS`.
3. If loading fails, the service still starts but says the index is not loaded.

At `/chat`:

1. Reads `message` or `question`.
2. Checks that an index is loaded.
3. Calls `answer_question(question, VS)`.
4. Returns the answer in frontend-compatible shape:

```json
{
  "success": true,
  "reply": {
    "type": "answer",
    "text": "..."
  }
}
```

### RAG Indexing

`rag_index.py`:

- Walks the configured repository folder.
- Ignores heavy folders like `.git`, `node_modules`, `venv`, `.venv`, `dist`, `build`, and `gec_rag_index`.
- Reads allowed file types such as `.py`, `.js`, `.html`, `.css`, `.json`, `.md`, `.txt`, `.move`, and `.toml`.
- Splits documents into chunks.
- Generates embeddings using OpenAI embeddings.
- Stores vectors in FAISS.

Important RAG environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEC_REPO_PATH` | `C:/Users/one/OneDrive/Desktop/projj` | Folder to index. This default is Windows-specific and should be changed on this machine. |
| `GEC_INDEX_PATH` | `gec_rag_index` | FAISS index folder. |
| `GEC_EMBED_MODEL` | `text-embedding-3-small` | Embedding model. |
| `GEC_CHAT_MODEL` | `gpt-4o-mini` | Chat model. |
| `GEC_MAX_CHARS` | `1500` | Chunk size. |
| `GEC_OVERLAP_CHARS` | `200` | Chunk overlap. |
| `GEC_RAG_SIMILARITY_THRESHOLD` | `0.30` | Retrieval score threshold. |
| `OPENAI_API_KEY` | empty | Required for OpenAI models. |

### RAG Answer Logic

`rag_main.py` includes:

- Greeting detection.
- Scope detection for GEC-related questions.
- Retrieval from FAISS.
- Prompting the LLM with retrieved context.
- Helpful fallback if no evidence is found.

The assistant is optimized for questions about:

- GEC concepts.
- Certificate issuance.
- Transfers.
- Retirement/claiming.
- Audit/proof.
- Aptos.
- MCP.
- Marketplace.
- Registry/account/device flows.

## Data and Generated Files

| Path | Meaning |
| --- | --- |
| `projj/data/gec_index.json` | Appears to be a JSON data/index file for GEC content. |
| `projj/gec_rag_index/index.faiss` | FAISS vector data. |
| `projj/gec_rag_index/index.pkl` | FAISS metadata/docstore pickle. |
| `projj/rag_audit_log.jsonl` | Audit trail for RAG events. |
| `projj/backend/db.json` | Local JSON data file; MongoDB is the real auth database path in current backend code. |
| `Gec_Server_C/req_temp.txt`, `Gec_Server_C/req_clean.txt` | Requirement/helper text files. |

## How to Run the Project Locally

The exact ports must be aligned carefully because the repo has multiple services with overlapping defaults.

### 1. Run the RAG service

From `projj/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="your-key"
export GEC_REPO_PATH="/Users/umarfarooq/Github/FYP/projj"
python build_rag_index.py
uvicorn rag_service:app --host 127.0.0.1 --port 8000
```

The Node router expects RAG at:

```text
http://127.0.0.1:8000
```

### 2. Run the action backend

From `Gec_Server_C/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Important: `projj/backend/server.js` defaults `ACTION_BACKEND_URL` to `http://127.0.0.1:8001`, so running action backend on port `8001` matches the Node router.

### 3. Run the MCP proxy, if using the `/chat` MCP flow in `Gec_Server_C`

From `Gec_Server_C/`:

```bash
uvicorn mcp_server:app --host 127.0.0.1 --port 8002
```

Then set:

```bash
export MCP_SERVER_URL="http://127.0.0.1:8002/mcp/invoke"
export UNDERLYING_REST_BASE="http://127.0.0.1:8001"
```

This avoids a port conflict where the action backend and MCP proxy both try to use the same port.

### 4. Run the Node router backend

From `projj/backend/`:

```bash
npm install
export PORT=3000
export MONGO_URI="your-mongodb-uri"
export JWT_SECRET="your-jwt-secret"
export RAG_SERVICE_URL="http://127.0.0.1:8000"
export ACTION_BACKEND_URL="http://127.0.0.1:8001"
npm run dev
```

If you want OTP emails to work, also set:

```bash
export GMAIL_USER="your-gmail"
export GMAIL_APP_PASSWORD="your-gmail-app-password"
```

### 5. Open the frontend

Open `projj/index.html` in a browser or serve the `projj/` folder with a static server.

The frontend expects:

```text
http://127.0.0.1:3000/api/chat
```

## Example End-to-End Flows

### Question Answering Flow

User asks:

```text
What is a Green Energy Certificate?
```

Flow:

1. Frontend posts to `POST /api/chat`.
2. Node router detects a question/procedure intent.
3. Node calls RAG service `POST /chat`.
4. RAG retrieves project context from FAISS.
5. LLM generates an answer.
6. Frontend displays the response.

### Certificate Issue Flow

User says:

```text
issue 50 solar certificate location Lahore
```

Flow:

1. Frontend posts to Node router.
2. Node router detects a concrete action command.
3. Node forwards to action backend `/chat`.
4. Action agent extracts amount, source, and location.
5. Agent builds tool request for `cert_create`.
6. MCP/action layer calls certificate create endpoint.
7. `chain_api.py` submits `gec_certificate::create_certificate_simple` on Aptos.
8. Transaction result returns with `tx_hash`, `success`, and Explorer URL.
9. Frontend updates registry activity view.

### Marketplace Stats Flow

Frontend requests marketplace stats:

1. Browser calls `GET /api/market/stats`.
2. Node router calls action backend `GET /marketplace/{market_addr}/stats`.
3. FastAPI calls Aptos view functions.
4. Node returns stats to frontend.

## Current Gaps and Things to Fix

These are not necessarily errors in the idea of the project, but they are important implementation details noticed during exploration.

| Area | Current issue |
| --- | --- |
| Port alignment | `projj` expects RAG on `8000` and action backend on `8001`. `Gec_Server_C/frontend/app.js` expects FastAPI `/chat` on `8000`. `Gec_Server_C/config.py` default `MCP_SERVER_URL` also points to `8001/mcp/invoke`, which can conflict if the action backend is on `8001`. |
| MCP proxy path | `mcp_server.py` loads `openapi.json` from the current working directory. It should be started from `Gec_Server_C` or changed to an absolute path based on `__file__`. |
| RAG default path | `projj/config.py` defaults `GEC_REPO_PATH` to a Windows path. On this machine, set it to `/Users/umarfarooq/Github/FYP/projj` or the full repo root. |
| Dummy retriever in action agent | `Gec_Server_C/backend/agent.py` uses `DummyRetriever`, so non-action questions there do not use the real `projj` RAG index. The main Node router solves this by sending question-like messages to `projj/rag_service.py`. |
| `projj/package.json` main file | It points to `index.js`, but this file was not present in the explored file list. The real backend entry appears to be `projj/backend/server.js`. |
| Root `package.json` | Root-level dependencies overlap with backend dependencies but do not define scripts. It may be leftover or partial setup. |
| `aptos_service.js` | Currently returns demo values and is not the main Aptos integration. Real Aptos calls are in `Gec_Server_C/backend/aptos_client.py`. |
| Frontend auth endpoint | `AUTH_SSI_URL` points to `/api/auth/ssi-login`, but no `ssi-login` route was found in `auth.js`. |
| Secrets | Private keys, JWT secrets, Gmail app passwords, MongoDB URI, and OpenAI keys must stay in `.env` files and should not be committed. |

## Recommended Cleanup Plan

1. Decide final service ports and document them in one `.env.example`.
2. Make `mcp_server.py` read `openapi.json` relative to its own file.
3. Update `projj/config.py` default `GEC_REPO_PATH` to a portable value or rely only on environment variables.
4. Add npm scripts at the correct levels for frontend/backend startup.
5. Remove or document duplicate/legacy files so future developers know which frontend/backend is primary.
6. Add `.env.example` files for `projj/backend`, `projj`, and `Gec_Server_C/backend`.
7. Add basic health checks for RAG, Node router, action backend, and MCP proxy.
8. Add tests for intent routing and action parsing before connecting to real blockchain calls.

## Suggested Final Mental Model

Think of the project as four cooperating services:

| Service | Main responsibility |
| --- | --- |
| Frontend | User interface for chat, marketplace, registry, login, and settings. |
| Node router | Central traffic controller. It decides RAG vs action and handles auth. |
| RAG service | Answers knowledge/procedure questions using indexed project context. |
| Action backend | Converts concrete commands into Aptos certificate/marketplace/audit transactions. |

This separation is good for an FYP because it clearly demonstrates:

- AI assistant behavior.
- Retrieval over project/domain documentation.
- Natural-language command routing.
- Blockchain-backed certificate actions.
- Marketplace and registry concepts.
- Authentication and session management.
- Auditability through transaction hashes and RAG audit logs.
