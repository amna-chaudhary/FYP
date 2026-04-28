# 🤖 GEC Agent — Implementation Guide

## 📌 What Is This Agent?

The GEC Agent is the **brain of the entire platform**. It sits between the user and the blockchain. The user types a plain English command (e.g., _"Issue a certificate for 500 kWh solar energy"_), and the agent figures out what to do, calls the right backend function, and returns a human-readable response.

The agent is built on three technologies working together:

| Technology                               | Role                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| **LLM (Large Language Model)**           | Understands the user's natural language intent                                      |
| **RAG (Retrieval-Augmented Generation)** | Looks up domain knowledge (EnergyTag standards, certificate rules) before answering |
| **MCP (Model Context Protocol)**         | Structured bridge between the LLM and backend tools/APIs                            |

The agent does **not** build a UI. It does **not** touch the blockchain directly. It calls **tools** (Python functions), and those tools talk to the blockchain and registry.

---

## 🏗️ System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                           │
│                  Types natural language commands                │
└─────────────────────────┬───────────────────────────────────────┘
                          │  HTTP / WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CHATBOT FRONTEND (UI)                        │
│         HTML + CSS + JS   ──   Sends messages to backend        │
└─────────────────────────┬───────────────────────────────────────┘
                          │  REST API call
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT BACKEND (Python)                      │
│                                                                 │
│   ┌─────────────┐   ┌───────────┐   ┌───────────────────────┐  │
│   │  LLM Core   │──▶│    RAG    │   │   MCP Tool Registry   │  │
│   │ (LangChain) │   │  Engine   │   │  (available actions)  │  │
│   └──────┬──────┘   └─────┬─────┘   └──────────┬────────────┘  │
│          │                │                     │               │
│          └────────────────▼─────────────────────▼               │
│                     AGENT DECISION LOOP                         │
│              (decides which tool to call + args)                │
└────────────────────────────┬────────────────────────────────────┘
                             │  Tool calls
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐  ┌──────────┐  ┌─────────────────┐
    │  EnergyTag   │  │ Registry │  │  Aptos Blockchain│
    │  GEC API     │  │   DB     │  │  Move Contracts  │
    └──────────────┘  └──────────┘  └─────────────────┘
```

---

## 🔄 Agent Flow — Step by Step

Every single user interaction follows this exact flow. Learn this flow before writing any code.

### Step 1 — User Sends a Message

The user types a command in the chatbot UI. Examples:

- _"Create a certificate for 200 kWh wind energy generated on 2025-04-20 at 14:00 in Lahore."_
- _"Transfer certificate #GEC-4821 to account 0xabc123."_
- _"Retire certificate #GEC-3310."_
- _"Show me my certificates."_
- _"List my certificate #GEC-4821 for sale at 50 PKR."_

---

### Step 2 — Auth Check (Every Request)

Before the agent does anything, it must confirm the user is authenticated via SSI.

```
User message arrives
        │
        ▼
Is there a valid session token?
        │
   YES ─┤──────────────────────────────────► Proceed to Step 3
        │
   NO ──┤──────────────────────────────────► Return: "Please log in with your SSI wallet first."
        │                                    Trigger: show QR code login flow
        ▼
      STOP
```

---

### Step 3 — Intent Recognition (LLM)

The LLM reads the user's message and classifies it into one of the known intents:

| Intent ID       | Intent Name                | Example Trigger Phrase                                |
| --------------- | -------------------------- | ----------------------------------------------------- |
| `AUTH_LOGIN`    | SSI Login / Authentication | "login", "connect wallet", "sign in"                  |
| `CERT_CREATE`   | Create a Certificate       | "create", "issue", "generate certificate"             |
| `CERT_TRANSFER` | Transfer a Certificate     | "transfer", "send certificate to"                     |
| `CERT_RETIRE`   | Retire a Certificate       | "retire", "burn", "mark as used"                      |
| `CERT_VIEW`     | View Certificate Details   | "show", "view", "details of certificate"              |
| `CERT_SEARCH`   | Search Registry            | "search", "find certificates", "list my certificates" |
| `MARKET_LIST`   | List for Sale              | "sell", "list for sale", "put on market"              |
| `MARKET_BUY`    | Buy a Certificate          | "buy", "purchase from marketplace"                    |
| `AUDIT_CHECK`   | Compliance Check           | "check compliance", "audit", "verify"                 |
| `REPORT_GEN`    | Generate Report            | "generate report", "export history"                   |
| `METADATA_VIEW` | View Metadata              | "metadata", "certificate info", "timestamp"           |
| `NOTIFY_VIEW`   | View Notifications         | "notifications", "alerts", "activity"                 |
| `UNKNOWN`       | Unrecognized               | Anything else → ask for clarification                 |

> **Agent rule:** If intent confidence is below threshold, ask a clarifying question. Never guess and execute a destructive action (transfer/retire) without confirmation.

---

### Step 4 — Slot Filling (Extract Parameters)

After identifying intent, the agent extracts the required parameters. If any required slot is missing, the agent asks the user for it.

**Example — `CERT_CREATE` requires:**

```
Required slots:
  ✅ energy_amount     → "200 kWh"
  ✅ energy_source     → "wind" / "solar" / "hydro"
  ✅ timestamp         → ISO 8601 datetime (hourly granularity)
  ✅ location          → City or GPS coordinates
  ❌ missing slot      → Agent asks: "What energy source was used?"
```

**Slot filling loop:**

```
Extract slots from message
        │
All required slots filled?
        │
   YES ─┼──────────────────────────────────► Step 5
        │
   NO ──┼──────────────────────────────────► Ask for missing slot
        │                                    Wait for next user message
        │                                    Re-run slot extraction
        ▼
     (loop until all slots filled OR user cancels)
```

---

### Step 5 — RAG Lookup (Context Enrichment)

Before calling any tool, the agent queries the RAG knowledge base to:

- Validate that the submitted data conforms to **EnergyTag GEC standard**
- Retrieve relevant rules (e.g., "certificates must use hourly timestamps")
- Check for any known constraints or policies

```python
# RAG query example
context = rag_engine.query(
    question=user_message,
    filters={"domain": "energytag_gec_standard"}
)
# Context is injected into the LLM prompt before tool call
```

If RAG returns a validation warning (e.g., invalid timestamp format), the agent rejects the operation and explains why to the user.

---

### Step 6 — Tool Selection via MCP

The agent selects the correct tool from the MCP Tool Registry and calls it with the extracted parameters.

```
Intent: CERT_CREATE
Parameters: {energy_amount: 200, unit: "kWh", source: "wind", timestamp: "2025-04-20T14:00:00Z", location: "Lahore"}
        │
        ▼
MCP Tool: create_certificate(params)
        │
        ▼
Backend Python function → calls EnergyTag API + Aptos Move contract
        │
        ▼
Returns: {certificate_id: "GEC-5001", tx_hash: "0xabc...", status: "Active"}
```

---

### Step 7 — Blockchain Execution

The backend tool (called by the agent) interacts with the Aptos blockchain:

1. Builds the Move transaction payload
2. Signs it using the user's account credentials
3. Submits to Aptos network
4. Waits for transaction confirmation
5. Returns `tx_hash` and new `certificate_id` (or updated state)

---

### Step 8 — Registry Update

After blockchain confirmation:

1. Store certificate metadata in the local **Registry DB**
2. Write an **audit log entry** (who did what, when, tx_hash)
3. Update the user's certificate list

---

### Step 9 — Response Generation

The LLM formats a friendly, plain-English response with the result.

```
Tool result: {certificate_id: "GEC-5001", tx_hash: "0xabc...", status: "Active"}
        │
        ▼
LLM formats response:
"✅ Certificate GEC-5001 has been successfully issued!
 Energy: 200 kWh (Wind) | Location: Lahore | Time: 20 Apr 2025, 14:00
 Transaction Hash: 0xabc...
 Your certificate is now Active and stored on the Aptos blockchain."
```

---

### Step 10 — Notification Dispatch

The system fires a notification for the completed event:

- Saved to the user's notification feed in the DB
- Displayed in the dashboard notification bell
- (Optional) Sent via email/webhook if configured

---

## 📋 Full TODO List

Work through these in order. Do **not** skip ahead — each section depends on the one before it.

---

### 🔐 TODO-1: Authentication Module (SSI Login)

- [x] **TODO-1.1** — Set up SSI wallet integration library (e.g., Veramo or Hyperledger Aries)
- [x] **TODO-1.2** — Implement DID document generation for new users
- [x] **TODO-1.3** — Build QR code generation endpoint for login challenge
- [x] **TODO-1.4** — Build DID signature verification endpoint
- [x] **TODO-1.5** — Create session token system (JWT or equivalent) after successful DID verification
- [x] **TODO-1.6** — Write auth middleware — every API route must validate session token
- [x] **TODO-1.7** — Handle error cases: invalid DID, expired session, rejected wallet auth
- [x] **TODO-1.8** — Write unit tests for all auth flows (valid DID, invalid DID, expired token)

**Current implementation status (2026-04-26):**

- Added SSI wallet registration + challenge storage in Node backend using `User` + `SsiChallenge` models
- Added DID document generation helper and Ed25519 signature verification for `did:gec:*` identities
- Added `POST /api/auth/ssi-login`, `POST /api/auth/ssi-login/challenge`, `GET /api/auth/ssi-login/challenge/:challengeId`, `POST /api/auth/ssi-login/verify`, and `POST /api/auth/ssi/wallet/register`
- Added QR payload generation for SSI login challenges
- Added browser-based demo SSI wallet flow on the login page so challenge issuance and approval can be tested end-to-end without an external wallet app
- Added backend SSI library integration using `did-jwt` and `did-resolver` so JWT-style wallet credentials can be parsed and DID documents can be resolved through a real DID-tooling layer rather than only custom helpers
- JWT session issuance and existing `requireAuth` middleware now support SSI-authenticated users
- Expanded unit coverage for the SSI lifecycle in `apps/projj/backend/tests/ssi-auth.test.js`: valid DID signature, invalid DID document, challenge creation, invalid signature rejection, expired challenge handling, successful verification, and expired JWT middleware rejection

**✅ Done when:** A user can scan a QR code, approve in their SSI wallet, and receive a valid session token that unlocks the rest of the platform through the current library-backed SSI flow.

---

### 🧠 TODO-2: AI Agent Core Setup

- [x] **TODO-2.1** — Install and configure LangChain (Python)
- [x] **TODO-2.2** — Connect to an LLM provider (OpenAI GPT / local model)
- [x] **TODO-2.3** — Write the **system prompt** — defines agent identity, rules, tone, and constraints
- [x] **TODO-2.4** — Implement the intent classification prompt and parser
- [x] **TODO-2.5** — Implement the slot filling loop with per-intent slot schemas
- [x] **TODO-2.6** — Add confirmation step for destructive actions (transfer, retire) — agent must ask "Are you sure?" before proceeding
- [x] **TODO-2.7** — Build conversation memory (store last N messages for context)
- [x] **TODO-2.8** — Implement UNKNOWN intent handler — returns clarification request
- [x] **TODO-2.9** — Write unit tests for intent classification with 10+ sample messages per intent

**Current implementation status (2026-04-26):**

- Replaced the old regex-only action router with an agent loop that uses explicit intent schemas, missing-slot tracking, and follow-up prompts
- Added agent-level system prompt and classifier prompt, with heuristic classification plus optional LLM refinement when confidence is low
- Added per-user conversation memory in the action backend and used `userId` from the chat request to preserve multi-turn state
- Added slot filling across turns so users can provide missing fields like location or recipient in a follow-up message
- Added destructive action confirmation flow for transfer, retire/claim, certificate cancel, marketplace cancel, and marketplace accept-buy actions
- Added explicit UNKNOWN / clarification handling when the user request is ambiguous
- Added initial Python unit tests for slot filling, confirmation flow, and UNKNOWN handling
- Added an intent-classification matrix in `apps/Gec_Server_C/tests/test_agent.py` with 10 sample messages per supported user-flow intent plus UNKNOWN coverage, all running in a deterministic heuristic-only test mode

**✅ Done when:** The agent correctly classifies any of the 12 intents from plain English, extracts all required parameters, and handles missing parameters by asking follow-up questions with test coverage that matches the full intent matrix.

---

### 📚 TODO-3: RAG Engine

- [x] **TODO-3.1** — Collect all reference documents: EnergyTag GEC standard PDF, platform rules, timestamp format specs
- [x] **TODO-3.2** — Chunk documents into segments (500–800 tokens each with overlap)
- [x] **TODO-3.3** — Generate embeddings for all chunks using an embedding model
- [x] **TODO-3.4** — Store embeddings in a vector database (e.g., Chroma, Pinecone, or FAISS)
- [x] **TODO-3.5** — Build the RAG query function — takes a user query, returns top-K relevant chunks
- [x] **TODO-3.6** — Inject RAG context into LLM prompt before every tool call
- [x] **TODO-3.7** — Add a validation layer — if RAG returns a rule violation, block the operation and explain
- [x] **TODO-3.8** — Test RAG retrieval accuracy for 10+ GEC-specific queries

**Current implementation status (2026-04-26):**

- The repo already had chunking, embeddings, and a FAISS-backed index in the Python RAG service
- Added structured retrieval support so the RAG service can now return evidence/context directly, not just a final answer
- Added `POST /validate-action` in the RAG service for action-aware policy checks before blockchain execution
- Added preflight RAG validation in the action backend so tool execution can be blocked before MCP invocation when a rule check fails
- Threaded `prod_start` and `prod_end` through certificate creation so timestamp validation has real fields to inspect
- Added timestamp validation for certificate issuance: invalid ISO 8601 / non-hourly timestamps are blocked, while missing timestamps are currently returned as warnings
- Added unit tests for RAG validation rules and kept action-backend tests green after integration
- Added local reference documents under `apps/projj/rag/reference_docs/` for the EnergyTag GC Scheme Standard V2, GC Registry API Specification V2, platform rules, and timestamp format rules
- Added retrieval-accuracy tests in `apps/projj/tests/test_rag_retrieval_accuracy.py` covering 10 GEC-specific queries and expected reference-source matches

**✅ Done when:** The agent can answer "What format should the timestamp be in?" correctly by retrieving EnergyTag rules, and rejects a certificate with an invalid timestamp citing the specific standard from the finalized reference set.

---

### 🔧 TODO-4: MCP Tool Registry

- [x] **TODO-4.1** — Define the MCP tool schema (name, description, input parameters, output format) for each tool
- [x] **TODO-4.2** — Register all tools in the MCP Tool Registry so the LLM knows what's available
- [x] **TODO-4.3** — Implement tool routing — agent receives tool name + args, dispatches to correct Python function
- [x] **TODO-4.4** — Add error handling for tool failures — blockchain timeout, API error, invalid response
- [x] **TODO-4.5** — Log every tool call with timestamp, user, params, and result

**Tools to register:**

| Tool Name              | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `create_certificate`   | Issues a new GEC on the blockchain                    |
| `transfer_certificate` | Transfers ownership of a certificate                  |
| `retire_certificate`   | Permanently retires a certificate                     |
| `view_certificate`     | Fetches certificate metadata and history              |
| `search_certificates`  | Searches the registry by filters                      |
| `list_on_marketplace`  | Creates a sell listing on the DEX                     |
| `buy_from_marketplace` | Executes a purchase on the DEX                        |
| `check_compliance`     | Runs EnergyTag compliance check on a certificate      |
| `generate_report`      | Compiles and returns a certificate/transaction report |
| `get_notifications`    | Returns user's notification feed                      |

**Current implementation status (2026-04-26):**

- The OpenAPI-driven MCP proxy now loads all `operationId` values from `openapi.json` as tool registrations
- `/mcp/tools` now exposes richer registry metadata including input schema and output schema per tool
- The action backend already routes agent-selected `tool_name` + `arguments` through the MCP client and normalizes the response into a stable shape
- Tool failures are handled through HTTP exception wrapping, normalized response handling, and upstream request error capture
- Added persistent JSONL tool-call logging at `apps/Gec_Server_C/logs/mcp_tool_calls.jsonl`
- Added unit tests covering registry loading, request construction, and schema exposure

**✅ Done when:** Each tool is callable by the agent with correct parameters and returns a structured JSON response or a clear error, with registry metadata and audit logging available for inspection.

---

### ⛓️ TODO-5: Move Smart Contracts (Blockchain Layer)

- [x] **TODO-5.1** — Set up Aptos development environment (Aptos CLI, Move compiler)
- [x] **TODO-5.2** — Create the `GECertificate` Move struct with fields: `id`, `owner`, `energy_source`, `energy_amount`, `timestamp`, `location`, `status` (Active/Retired), `created_at`
- [x] **TODO-5.3** — Write `create_certificate` Move function — mints a new GEC and assigns to caller's account
- [x] **TODO-5.4** — Write `transfer_certificate` Move function — verifies ownership, updates owner field
- [x] **TODO-5.5** — Write `retire_certificate` Move function — sets status to Retired, prevents future transfers
- [x] **TODO-5.6** — Write `get_certificate` Move view function — returns certificate struct as JSON. Must include all fields needed by **TODO-12.1**: `id`, `owner`, `previous_owner`, `device_id`, `device_name`, `energy_source`, `energy_amount`, `prod_start`, `prod_end`, `location`, `status`, `created_at`, `issuer`
- [x] **TODO-5.7** — Write DEX functions: `list_for_sale`, `buy_certificate`, `cancel_listing`
- [x] **TODO-5.8** — Add ownership guards — every write function must verify `signer == certificate.owner`
- [x] **TODO-5.9** — Add duplicate prevention — reject create if same energy record already exists
- [ ] **TODO-5.10** — Deploy all contracts to Aptos **testnet** and run manual tests
- [x] **TODO-5.11** — Write a Python wrapper (`aptos_client.py`) that calls each Move function via Aptos REST API
- [x] **TODO-5.12** — Write unit tests for every Move function (valid case + error case)

**Current implementation status (2026-04-26):**

- Added a Move package at `apps/Gec_Server_C/blockchain/Move.toml`
- Added `apps/Gec_Server_C/blockchain/contracts/GECertificate.move` with registry init, issuer management, certificate create/transfer/retire/cancel, duplicate prevention, ownership guards, and view helpers
- Added `apps/Gec_Server_C/blockchain/contracts/Marketplace.move` with marketplace init, list/cancel/request-buy/accept-buy, plus stats view functions
- Kept function names aligned to the existing Python API layer in `apps/Gec_Server_C/backend/chain_api.py`
- The Python wrapper in `apps/Gec_Server_C/backend/aptos_client.py` already existed and now lines up with the new contract package
- Installed the Aptos CLI locally (`aptos 9.2.0`) so Move compilation/testing can run from this workspace without the earlier missing-tool blocker
- Added contract-level test functions inside the Move modules for create/retire, add/remove issuer, transfer, cancel, duplicate prevention, non-owner failure, marketplace list/accept, cancel, pending buy, and non-owner marketplace failure; execution is now blocked by dependency resolution/network access for the Aptos framework rather than by a missing CLI

**Remaining gap before TODO-5 is fully done:** compile the package with all dependencies resolved, run the full Move test suite, and deploy / manually verify the contracts on Aptos testnet.

**✅ Done when:** All 5 certificate operations + 3 DEX operations work correctly on Aptos testnet, with Python wrapper returning clean JSON results and the Move package compiled/tested in a real Aptos environment.

---

### 🗄️ TODO-6: Registry Database

- [x] **TODO-6.1** — Choose and set up database (PostgreSQL recommended)
- [x] **TODO-6.2** — Design schema for `certificates` table (mirrors blockchain data + metadata)
- [x] **TODO-6.3** — Design schema for `transactions` table (audit log: who, what, when, tx_hash)
- [x] **TODO-6.4** — Design schema for `users` table (DID, account address, profile info)
- [x] **TODO-6.5** — Design schema for `marketplace_listings` table
- [x] **TODO-6.6** — Design schema for `notifications` table
- [x] **TODO-6.7** — Build registry sync function — after every blockchain transaction, write result to DB
- [x] **TODO-6.8** — Build search/filter API on registry (filter by status, owner, date range, energy source)
- [x] **TODO-6.9** — Write audit log writer — called after every certificate operation
- [x] **TODO-6.10** — Write migration scripts to set up/reset DB schema

**Database Schema (simplified):**

```sql
-- certificates
id VARCHAR PRIMARY KEY,        -- GEC-5001
owner_did VARCHAR,             -- User's DID
energy_source VARCHAR,         -- wind / solar / hydro
energy_amount DECIMAL,         -- kWh
timestamp TIMESTAMPTZ,         -- ISO 8601 hourly
location VARCHAR,
status VARCHAR,                -- Active / Retired / Listed
tx_hash VARCHAR,               -- Aptos transaction hash
created_at TIMESTAMPTZ

-- transactions (audit log)
id SERIAL PRIMARY KEY,
certificate_id VARCHAR,
operation VARCHAR,             -- CREATE / TRANSFER / RETIRE / TRADE
actor_did VARCHAR,
recipient_did VARCHAR,
tx_hash VARCHAR,
occurred_at TIMESTAMPTZ

-- marketplace_listings
certificate_id VARCHAR,
seller_did VARCHAR,
price DECIMAL,
currency VARCHAR,
listed_at TIMESTAMPTZ,
status VARCHAR                 -- Open / Sold / Cancelled
```

**Implementation status:** A working local registry database now lives under `apps/Gec_Server_C/db/` using SQLite for development (`registry.py`, `models.py`, `migrations/001_registry_schema.sql`). The schema covers `users`, `certificates`, `transactions`, `marketplace_listings`, and `notifications`, and successful blockchain/MCP actions are now synced into the registry automatically from `backend/app.py`. Audit log entries are written through the shared transaction writer, and the search/filter API is now exposed through the protected FastAPI `GET /certificates` endpoint with filters for status, owner session, date range, and energy source.

**✅ Done when:** Registry correctly reflects blockchain state. Every operation creates a corresponding audit log entry. Search works by all filters.

---

### 🌐 TODO-7: Backend API Server

- [x] **TODO-7.1** — Set up FastAPI (Python) or Express (Node.js) server
- [x] **TODO-7.2** — Create `POST /chat` endpoint — receives user message, returns agent response
- [x] **TODO-7.3** — Create `POST /auth/login` endpoint — initiates SSI login flow
- [x] **TODO-7.4** — Create `GET /certificates` endpoint — returns user's certificate list
- [x] **TODO-7.5** — Create `GET /certificates/:id` endpoint — returns single certificate detail. Response shape must satisfy **TODO-12.2** so the certificate document template can render every field in `image.png` without additional calls
- [x] **TODO-7.6** — Create `GET /marketplace` endpoint — returns active listings
- [x] **TODO-7.7** — Create `GET /notifications` endpoint — returns user's notification feed
- [x] **TODO-7.8** — Create `GET /reports` endpoint — triggers report generation
- [x] **TODO-7.9** — Apply auth middleware (from TODO-1.6) to all endpoints except `/auth/login`
- [x] **TODO-7.10** — Add request validation and error response formatting
- [x] **TODO-7.11** — Write API integration tests for all endpoints

**Implementation status:** The FastAPI backend in `apps/Gec_Server_C/backend/app.py` now exposes a protected API surface on top of the local registry database: `POST /auth/login`, `POST /chat`, `GET /certificates`, `GET /certificates/{id}`, `GET /marketplace`, `GET /notifications`, and `GET /reports`. JWT bearer auth is enforced on every endpoint except `/auth/login`, request validation failures and HTTP exceptions are returned in a consistent error shape, and the certificate detail response includes both certificate metadata and transaction history for downstream rendering. Integration coverage in `tests/test_api_server.py` verifies login, auth rejection, certificate list/detail, marketplace feed, notifications, reports, validation formatting, and authenticated chat behavior.

**✅ Done when:** All endpoints return correct responses with valid session tokens and reject requests with missing/invalid tokens.

---

### 🖥️ TODO-8: Frontend (Chatbot UI)

- [x] **TODO-8.1** — Build Login Page — QR code display, SSI wallet instruction, session handling
- [x] **TODO-8.2** — Build Chatbot Interface — message input, message bubbles (user vs agent), typing indicator
- [x] **TODO-8.3** — Build Certificate Registry Page — table of user's certificates, filter/search controls
- [x] **TODO-8.4** — Build Certificate Detail Page — all metadata fields, transaction history, action buttons. Page must visually match `image.png` (the reference certificate at the bottom of this document); see **TODO-12.6**–**TODO-12.18** for the printable certificate template, render function, and export controls
- [x] **TODO-8.5** — Build Marketplace Page — listing cards with price, buy button, my listings tab
- [x] **TODO-8.6** — Build Notification Panel — bell icon, dropdown with recent events
- [x] **TODO-8.7** — Build Report Download UI — select report type, date range, download button
- [x] **TODO-8.8** — Connect all pages to backend API (TODO-7 endpoints)
- [x] **TODO-8.9** — Handle error states — API timeout, auth error, blockchain error — show user-friendly messages
- [x] **TODO-8.10** — Responsive design — must work on desktop and tablet
- [x] **TODO-8.11** — Test all UI flows end-to-end in browser

**Implementation status:** A canonical frontend now exists under `apps/Gec_Server_C/frontend/` using the documented structure: `index.html`, `chat.html`, `registry.html`, `marketplace.html`, `certificate.html`, plus shared assets in `frontend/static/style.css`, `frontend/static/certificate.css`, `frontend/static/app.js`, and `frontend/static/certificate-view.js`. The login page provides SSI instructions, local QR challenge preview, and session storage; the chat page supports authenticated messaging, typing state, notifications, and report download; the registry page supports filtering and certificate detail loading; the marketplace page supports listing feed tabs and action-to-chat drafts; and the certificate page now renders a print-friendly green/cream certificate document with full metadata, transaction history, and action controls based on the `image.png` reference. Browser-driven smoke coverage now exists in `apps/Gec_Server_C/tests/frontend_smoke.mjs`, and it was executed successfully against the live frontend/backend pair with Playwright.

**✅ Done when:** A user can log in, chat with the agent to create/transfer/retire certificates, view them in the registry, and trade on the marketplace — all without leaving the browser.

---

### 🧪 TODO-9: Testing

- [ ] **TODO-9.1** — Write unit tests for all Python agent functions (intent classifier, slot filler, tool router)
- [ ] **TODO-9.2** — Write unit tests for all Move smart contract functions
- [ ] **TODO-9.3** — Write unit tests for all registry DB operations
- [ ] **TODO-9.4** — Write integration tests: chatbot message → agent → blockchain → registry → response
- [ ] **TODO-9.5** — Test all 9 use cases (UC-001 through UC-009) against their formal requirements
- [ ] **TODO-9.6** — Test all alternate flows (invalid DID, already retired certificate, insufficient balance, etc.)
- [ ] **TODO-9.7** — Run EnergyTag compliance validation on 10 sample certificates
- [ ] **TODO-9.8** — Security test: attempt to transfer a certificate you don't own — must be blocked
- [ ] **TODO-9.9** — Security test: attempt to retire an already-retired certificate — must be blocked
- [ ] **TODO-9.10** — Fix all bugs found in testing
- [ ] **TODO-9.11** — Document all test results in the Test Summary Report

**✅ Done when:** All 23 formal requirements are verified. All alternate flows are handled. No security bypass is possible.

---

### 🚀 TODO-10: Deployment

- [ ] **TODO-10.1** — Deploy Move contracts to Aptos testnet (already done in TODO-5.10 — now do final deployment)
- [ ] **TODO-10.2** — Deploy backend API server to production host (e.g., AWS EC2, DigitalOcean, or Railway)
- [ ] **TODO-10.3** — Set all environment variables: LLM API key, Aptos node URL, DB connection string
- [ ] **TODO-10.4** — Configure final RAG knowledge base on production server
- [ ] **TODO-10.5** — Deploy frontend to static host (e.g., Vercel, Netlify, or Nginx)
- [ ] **TODO-10.6** — Run smoke tests on production — all 9 use cases must pass
- [ ] **TODO-10.7** — Set up basic monitoring (uptime, error rate, response time)
- [ ] **TODO-10.8** — Write runbook — how to restart services, how to roll back, how to debug common errors

**✅ Done when:** The full platform is live, accessible in a browser, connected to Aptos testnet, and all smoke tests pass.

---

### 📄 TODO-11: Final Documentation

- [ ] **TODO-11.1** — Write/finalize User Manual (registration, login, all chatbot commands, marketplace guide)
- [ ] **TODO-11.2** — Write Technical Manual (architecture, API reference, DB schema, deployment guide)
- [ ] **TODO-11.3** — Complete final project report (all chapters aligned with completed implementation)
- [ ] **TODO-11.4** — Record demo video showing all 9 use case flows
- [ ] **TODO-11.5** — Prepare final presentation slides

---

### 🪪 TODO-12: Dynamic Certificate Document Rendering

The reference design lives at the bottom of this file (`image.png`). Every issued GEC must be displayable as a single-page printable document that matches that layout exactly. This section is **required** to call the project visually complete.

**Reference fields the document must show (13 total):**

| Block | Field | Source |
| --- | --- | --- |
| Top bar | Certificate ID (`GEC-YYYY-NNNNNN`) | Backend (formatted from `cert_id` + year) |
| Top bar | Status (`ACTIVE` / `RETIRED` / `LISTED`) | Move view |
| Top bar | Issue Date | `created_at` from chain |
| Energy | Energy Source | Move view |
| Energy | Energy Generated (kWh) | Move view |
| Energy | Generation Time (date + hour range) | `prod_start` / `prod_end` |
| Energy | Location | Move view |
| Ownership | Generated By | `device_name` / `issuer` |
| Ownership | Current Owner | Move view |
| Ownership | Previous Owner | Transfer history |
| Blockchain | Network (Aptos) | Backend config |
| Blockchain | Transaction Hash | `TxResponse.tx_hash` |
| Blockchain | Smart Contract ID | `MODULE_ADDRESS` |

#### Backend data layer

- [x] **TODO-12.1** — Extend the `gec_certificate::get_certificate` Move view function (see **TODO-5.6**) to return the full record: `id`, `owner`, `previous_owner`, `device_id`, `device_name`, `energy_source`, `energy_amount`, `prod_start`, `prod_end`, `location`, `status`, `created_at`, `issuer`
- [x] **TODO-12.2** — Add REST route `GET /certificates/{cert_id}` in `apps/Gec_Server_C/backend/chain_api.py` that calls the view function via `aptos_client.view_function` and returns a flat JSON record with all 13 display fields
- [x] **TODO-12.3** — Extend `CreateCertificateRequest` and `TxResponse` in `chain_api.py` so `cert_create` accepts `prod_start`, `prod_end`, `device_name` and returns `created_at`, `module_address`, and a formatted `display_id` like `GEC-2026-000123`
- [x] **TODO-12.4** — Track `previous_owner` on every `transfer_certificate` Move call (store the prior owner in the certificate struct on transfer) and surface it in the view function and REST response
- [x] **TODO-12.5** — Register the new endpoint as MCP tool `cert_view` in `apps/Gec_Server_C/openapi.json` so the chat agent can invoke it as part of `CERT_VIEW` intent

#### Node router proxy

- [x] **TODO-12.6** — Add `GET /api/certificates/:id` in `apps/projj/backend/server.js` that proxies to `${ACTION_BACKEND_URL}/certificates/{id}` with auth middleware applied

#### Frontend template + assets

- [x] **TODO-12.7** — Create `apps/projj/frontend/pages/certificate.html` — single-page certificate document mirroring `image.png` (header, top info bar, three section cards, footer with badge + signature)
- [x] **TODO-12.8** — Create `apps/projj/frontend/styles/certificate.css` — green/cream palette, decorative double border with corner ornaments, serif title, monospace for hashes/IDs, `@media print` rules for clean PDF output
- [x] **TODO-12.9** — Add design assets in `apps/projj/assets/certificate/`: `logo.svg`, `corner-ornament.svg` (used in all 4 corners), `authority-badge.svg`, `signature.svg`

#### Frontend render layer

- [x] **TODO-12.10** — Create `apps/projj/frontend/scripts/certificate-view.js` exporting `renderCertificate(container, cert)` that fills every slot in the template from a normalized certificate object
- [x] **TODO-12.11** — Add `normalizeCertificate(raw)` helper that maps three input shapes into one canonical object: (a) `cert_create` `TxResponse`, (b) `GET /certificates/:id` response, (c) the existing session-registry tx record format from `app-registry.js`
- [x] **TODO-12.12** — Add formatting helpers: `formatCertId(year, id)`, `formatDateRange(prodStart, prodEnd)`, `shortenHash(hash, 4, 6)`, `formatLocation(city, country)`, `humanStatus(rawStatus)`

#### Wiring into existing UI

- [x] **TODO-12.13** — Refactor `renderRegistry()` in `apps/projj/frontend/scripts/app-registry.js` from an account-balance grid into a two-pane layout: left = filterable certificate list; right = preview of the selected certificate via `renderCertificate(...)`
- [x] **TODO-12.14** — In `apps/projj/frontend/scripts/app-chat.js`, when a chat response includes a successful `cert_create` result, append a "View certificate" action that opens the certificate inline in a modal
- [x] **TODO-12.15** — Support deep links: `pages/certificate.html?id=GEC-2026-000123` should fetch via `GET /api/certificates/:id` and render the same template, suitable for sharing

#### Export and sharing

- [x] **TODO-12.16** — Add `Download PDF` button using `window.print()` driven by the print stylesheet (zero new dependencies); optional later upgrade to `html2pdf.js` for direct file save
- [x] **TODO-12.17** — Add `Download PNG` button using `html-to-image` or `dom-to-image` for social/email sharing
- [x] **TODO-12.18** — Add `Copy share link` and `View on Aptos Explorer` buttons (the explorer URL is already returned as `TxResponse.explorer_url`)

#### QA and acceptance

- [ ] **TODO-12.19** — Visual fidelity check: render a fixture certificate side-by-side with `image.png` and confirm header, top bar, three section cards, footer, and decorative border all match
- [ ] **TODO-12.20** — End-to-end: chat command `"issue 100 solar certificate location Punjab"` must produce a viewable certificate with all 13 fields populated
- [ ] **TODO-12.21** — Status transitions: after `claim cert {id}` the same certificate must reload with `STATUS = RETIRED` and the retire date visible
- [ ] **TODO-12.22** — Ownership transitions: after `transfer cert {id} to 0x...` the certificate must show the new `Current Owner` and the prior account in `Previous Owner`
- [ ] **TODO-12.23** — Print output: `Download PDF` produces a one-page A4/Letter PDF with no clipped borders or missing assets

**✅ Done when:** Any issued certificate can be opened from the registry list, from the chat success message, or from a shared deep link, and renders pixel-faithfully to `image.png` with all 13 fields populated from real on-chain data, and can be exported as PDF and PNG.

---

## 🗺️ How to Proceed — Step-by-Step Execution Plan

Follow this order. Parallel tracks are marked explicitly.

```
WEEK 1–2   ─── T1: Brainstorming + T2: Proposal Review
WEEK 3     ─── T3: Project Defence
WEEK 4–5   ─── T4: Requirement Gathering  (parallel: Amna starts Aptos env setup)
WEEK 6–7   ─── T5: Requirement Analysis
WEEK 8–9   ─── T6: Feasibility Report
WEEK 10–11 ─── T7: SRS + Design Document
               ├── Gul-e-Sakeena: UML diagrams, sequence diagrams, domain model
               └── Amina Bibi: Wireframes, site maps, storyboards

WEEK 12–14 ─── T8: Frontend Design (Amina Bibi)
               PARALLEL: TODO-5 Move Smart Contracts (Amna Bibi)

WEEK 15–18 ─── T9: Backend Development  ← BIGGEST CHUNK (28 days)
               ├── Amna Bibi: aptos_client.py, Registry DB, Backend API
               └── Gul-e-Sakeena: LangChain agent, RAG engine, MCP tools

WEEK 19–20 ─── T10: Testing (All Members)
WEEK 21–22 ─── T11: Implementation / Deployment (All Members)
WEEK 23    ─── T12: Final Documentation
```

---

## ⚙️ Agent Configuration — System Prompt Template

Use this as the starting point for the agent's system prompt (TODO-2.3):

```
You are the GEC Management Agent — an intelligent assistant for managing
Granular Energy Certificates (GECs) on the Aptos blockchain.

Your job:
- Help users create, transfer, retire, view, and trade GECs.
- Understand natural language commands and translate them into tool calls.
- Always verify the user is authenticated before any action.
- Always confirm destructive actions (transfer, retire) with the user before executing.
- Explain results in clear, simple language.
- Reject invalid requests with a helpful explanation citing the relevant EnergyTag rule.

You have access to the following tools:
[TOOL LIST INJECTED BY MCP]

Rules you must always follow:
1. Never execute a transfer or retirement without explicit user confirmation ("Yes, proceed.").
2. Never invent certificate IDs or transaction hashes — only return real data from tools.
3. If a tool fails, tell the user what went wrong and suggest what to try next.
4. Always include the transaction hash in success responses.
5. Use the EnergyTag standard (from RAG context) to validate all certificate data before creation.
```

---

## 🚨 Error Handling Reference

Every tool call can fail. Handle these cases explicitly:

| Error Scenario                   | Agent Response                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| User not authenticated           | "Please log in with your SSI wallet first." + show QR                                                                  |
| Invalid DID signature            | "Authentication failed. Please try scanning the QR code again."                                                        |
| Certificate ID not found         | "I couldn't find certificate [ID]. Please check the ID and try again."                                                 |
| User doesn't own the certificate | "You don't own certificate [ID], so this action cannot be performed."                                                  |
| Certificate already retired      | "Certificate [ID] has already been retired and cannot be modified."                                                    |
| Invalid timestamp format         | "The timestamp must use hourly granularity in ISO 8601 format (e.g., 2025-04-20T14:00:00Z)."                           |
| Blockchain transaction failure   | "The blockchain transaction failed. Please try again in a moment. If this persists, check your Aptos account balance." |
| Insufficient marketplace balance | "You don't have enough balance to complete this purchase."                                                             |
| RAG validation failure           | "Your request doesn't meet EnergyTag standards: [specific rule]. Please correct and try again."                        |
| Tool timeout                     | "The request took too long. Please try again."                                                                         |

---

## 📦 Key Files to Create

```
gec-platform/
├── agent/
│   ├── agent.py              ← Main agent class (LangChain)
│   ├── intents.py            ← Intent definitions and slot schemas
│   ├── slots.py              ← Slot filling logic
│   ├── prompts.py            ← System prompt + intent prompt templates
│   └── memory.py             ← Conversation memory manager
│
├── rag/
│   ├── rag_engine.py         ← RAG query function
│   ├── chunker.py            ← Document chunker
│   ├── embedder.py           ← Embedding generator
│   └── vector_store.py       ← Vector DB interface
│
├── tools/
│   ├── registry.py           ← MCP tool registry
│   ├── cert_tools.py         ← create, transfer, retire, view, search
│   ├── market_tools.py       ← list, buy, cancel
│   ├── report_tools.py       ← generate_report
│   └── notify_tools.py       ← get_notifications
│
├── blockchain/
│   ├── aptos_client.py       ← Python wrapper for Aptos REST API
│   └── contracts/
│       ├── GECertificate.move
│       └── Marketplace.move
│
├── api/
│   ├── main.py               ← FastAPI app entry point
│   ├── routes/
│   │   ├── chat.py           ← POST /chat
│   │   ├── auth.py           ← POST /auth/login
│   │   ├── certificates.py   ← GET /certificates, GET /certificates/:id
│   │   ├── marketplace.py    ← GET /marketplace
│   │   ├── reports.py        ← GET /reports
│   │   └── notifications.py  ← GET /notifications
│   └── middleware/
│       └── auth_middleware.py ← Session token validator
│
├── db/
│   ├── models.py             ← SQLAlchemy models
│   ├── registry.py           ← DB read/write functions
│   └── migrations/           ← DB migration scripts
│
├── frontend/
│   ├── index.html            ← Login page
│   ├── chat.html             ← Chatbot UI
│   ├── registry.html         ← Certificate registry
│   ├── marketplace.html      ← DEX marketplace
│   ├── certificate.html      ← Printable certificate document (TODO-12.7)
│   ├── static/
│   │   ├── style.css
│   │   ├── certificate.css   ← Certificate styles + print rules (TODO-12.8)
│   │   ├── app.js
│   │   └── certificate-view.js ← renderCertificate + normalizers (TODO-12.10/11/12)
│   └── assets/certificate/   ← logo.svg, corner-ornament.svg, authority-badge.svg, signature.svg (TODO-12.9)
│
├── tests/
│   ├── test_agent.py
│   ├── test_tools.py
│   ├── test_blockchain.py
│   ├── test_api.py
│   └── test_use_cases.py     ← UC-001 through UC-009
│
├── docs/
│   ├── GEC_AGENT.md          ← This file
│   └── API_REFERENCE.md
│
├── .env.example              ← Environment variable template
└── requirements.txt          ← Python dependencies
```

---

## 🔑 Environment Variables (.env)

```bash
# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o

# RAG / Vector DB
VECTOR_DB_PATH=./rag/vector_store
EMBEDDING_MODEL=text-embedding-3-small

# Blockchain
APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
APTOS_PRIVATE_KEY=0x...
APTOS_CONTRACT_ADDRESS=0x...

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/gec_db

# Auth
JWT_SECRET=your-secret-key-here
SESSION_EXPIRY_HOURS=24

# App
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=true
```

---

## ✅ Definition of Done — Full Project

The project is complete when:

- [ ] All 12 TODO sections above are 100% checked off
- [ ] All 9 use cases (UC-001 → UC-009) pass end-to-end in production
- [ ] All 23 formal "shall" requirements are verified with test evidence
- [ ] The agent correctly handles all error scenarios in the Error Handling table
- [ ] Every issued certificate renders as a single-page document matching `image.png` (TODO-12)
- [ ] The platform is deployed and accessible via a browser
- [ ] Final documentation package is submitted

---

> _This document is the single source of truth for agent implementation. Update TODOs as work progresses. Every team member should read this before writing any code._

---

_GEC Management Platform · Department of Software Engineering · University of Gujrat · 2025–2026_

![alt text](image.png)
