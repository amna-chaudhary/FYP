# EnergyCert Bot / GEC Platform

EnergyCert Bot is a Final Year Project for a Green Energy Certificate (GEC) platform. It includes a browser chat UI, a Node.js router backend, a Python RAG service, and a FastAPI/Aptos action backend for certificate, marketplace, and audit operations.

## What This Project Does

The project supports two main flows:

1. **Ask questions about GEC**

   Example:

   ```text
   What is a Green Energy Certificate?
   How does certificate transfer work?
   Explain the marketplace workflow.
   ```

   These requests go to the Python RAG service.

2. **Run concrete blockchain actions**

   Example:

   ```text
   issue 50 solar certificate location Lahore
   transfer cert 1 to 0xabc...
   claim cert 2
   list cert 3 price 100
   ```

   These requests go to the FastAPI action backend and Aptos transaction layer.

## Project Structure

```text
.
├── apps/
│   ├── Gec_Server_C/
│   └── projj/
├── docs/
│   ├── AGENT_SKILLS.md
│   ├── PROJECT_OVERVIEW.md
│   └── README.md
└── README.md
```

Canonical locations live under `apps/`. Use `apps/projj` and `apps/Gec_Server_C` for all commands, env files, and IDE workspace references.

## Main Services

| Service             | Folder                | Default URL             | Purpose                                            |
| ------------------- | --------------------- | ----------------------- | -------------------------------------------------- |
| Frontend            | `apps/projj/`         | Browser/static file     | Main EnergyCert Bot UI                             |
| Node router backend | `apps/projj/backend/` | `http://127.0.0.1:3000` | Routes chat to RAG or action backend, handles auth |
| RAG service         | `apps/projj/`         | `http://127.0.0.1:8000` | Answers GEC/project questions                      |
| Action backend      | `apps/Gec_Server_C/`  | `http://127.0.0.1:8001` | Executes certificate/marketplace/audit actions     |
| MCP proxy           | `apps/Gec_Server_C/`  | `http://127.0.0.1:8002` | Optional OpenAPI-to-tool proxy                     |

## Prerequisites

Install these first:

- Python 3.11+
- Node.js 18+
- npm
- MongoDB database, local or cloud
- OpenAI API key for RAG and LLM responses
- Aptos testnet account/private key if you want real blockchain transactions

## Install Modules (Dependencies)

Install dependencies once before running services.

### 1) Node Backend (`apps/projj/backend`)

```bash
cd ./apps/projj/backend
npm install
```

### 2) RAG Python Service (`apps/projj`)

```bash
cd ./apps/projj
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m pip install faiss-cpu
```

Why `faiss-cpu`:

- RAG index loading uses FAISS; without it, startup fails with `No module named 'faiss'`.

### 3) Action Backend Python Service (`apps/Gec_Server_C`)

```bash
cd ./apps/Gec_Server_C
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r backend/requirements.txt
```

### 4) Optional Root Node Dependencies

Only needed if you use scripts depending on root `package.json`:

```bash
npm install
```

## Environment Variables

### RAG Service Environment

The RAG service is inside `apps/projj/`.

Create `apps/projj/.env` or export these variables in your terminal:

```bash
OPENAI_API_KEY="your-openai-api-key"
GEC_REPO_PATH="./apps/projj"
GEC_INDEX_PATH="rag/index_store/gec_rag_index"
GEC_EMBED_MODEL="text-embedding-3-small"
GEC_CHAT_MODEL="gpt-4o-mini"
```

Important: `GEC_REPO_PATH` should point to the folder you want the RAG index to read. On this machine, use:

```bash
GEC_REPO_PATH="./apps/projj"
```

### Node Backend Environment

The Node backend is inside `apps/projj/backend/`.

Create `apps/projj/backend/.env`:

```bash
PORT=3000
MONGO_URI="your-mongodb-uri"
JWT_SECRET="your-long-random-secret"

RAG_SERVICE_URL="http://127.0.0.1:8000"
ACTION_BACKEND_URL="http://127.0.0.1:8001"

GMAIL_USER="your-gmail-address"
GMAIL_APP_PASSWORD="your-gmail-app-password"
OTP_EXPIRY_MINUTES=10
DEVICE_TRUST_DAYS=30
MAIL_FROM_NAME="EnergyCert Bot"
```

Email variables are only required if you want registration/login OTP email to work.

### Action Backend Environment

The action backend is inside `apps/Gec_Server_C/backend/`.

Create `apps/Gec_Server_C/backend/.env`:

```bash
OPENAI_API_KEY="your-openai-api-key"

APTOS_NODE_URL="https://fullnode.testnet.aptoslabs.com/v1"
APTOS_EXPLORER_NETWORK="testnet"

MODULE_ADDRESS="0x_your_deployed_module_address"
CERT_REGISTRY_ADDR="0x_your_registry_address"
MARKET_ADDR="0x_your_marketplace_address"

APTOS_SENDER_ADDRESS="0x_your_sender_address"
APTOS_SENDER_PRIVATE_KEY_HEX="your_private_key_without_or_with_0x"

MCP_SERVER_URL="http://127.0.0.1:8002/mcp/invoke"
```

Do not commit `.env` files. `.gitignore` already ignores `.env`.

## How to Run the Project (for Mac or Linux) // windows instructions are below

Run each service in a separate terminal.

### Terminal 1: Start the RAG Service

```bash
cd ./apps/projj
python -m venv .venv
source .venv/bin/activate //for linux and mac
.\.venv\Scripts\Activate.ps1 //for windows
pip install -r requirements.txt
export OPENAI_API_KEY="your-openai-api-key"
export GEC_REPO_PATH="./apps/projj"
export GEC_INDEX_PATH="rag/index_store/gec_rag_index"
python build_rag_index.py
uvicorn rag_service:app --host 127.0.0.1 --port 8000
```

Check it:

```bash
curl http://127.0.0.1:8000/
```

Expected result: JSON response saying the GEC RAG service is running.

### Terminal 2: Start the Action Backend

```bash
cd ./apps/Gec_Server_C
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Check it:

```bash
curl http://127.0.0.1:8001/
```

Expected result:

```json
{
  "ok": true,
  "service": "gec-action-backend"
}
```

### Terminal 3: Start the MCP Proxy

This is optional, but required if the action backend `/chat` flow is using MCP tool invocation.

```bash
cd ./apps/Gec_Server_C
source .venv/bin/activate
export UNDERLYING_REST_BASE="http://127.0.0.1:8001"
uvicorn mcp_server:app --host 127.0.0.1 --port 8002
```

Check loaded tools:

```bash
curl http://127.0.0.1:8002/mcp/tools
```

Expected result: JSON list of tools such as `cert_create`, `cert_transfer`, `market_list`, and `audit_log`.

### Terminal 4: Start the Node Router Backend

```bash
cd ./apps/projj/backend
npm install
npm run dev
```

Check it:

```bash
curl http://127.0.0.1:3000/
```

Expected result: JSON response from `projj-node-backend`.

If port `3000` is already used on your machine:

```bash
PORT=3010 node server.js
```

Then use `http://127.0.0.1:3010/api/chat` in frontend config.

### Terminal 5: Open the Frontend

The main frontend is:

```text
./apps/projj/frontend/pages/index.html
```

Compatibility entrypoint also exists:

```text
./apps/projj/index.html
```

You can open it directly in the browser, or serve it with a local static server.

Option A: open directly:

```bash
open ./apps/projj/frontend/pages/index.html
```

Option B: serve with Python:

```bash
cd ./apps/projj
python -m http.server 5500
```

Here’s your Windows setup rewritten in the same clean, structured format as your original doc:

---

## Project Setup (Windows)

Follow these steps to run the full system locally.

---

## Prerequisites

Make sure the following are installed:

- Python 3.10+
- Node.js (v18+)
- MongoDB Atlas (or local MongoDB)
- Git

---

## 🔹 1. Start RAG Service

```bash
cd C:\FYP\apps\projj

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Set environment variables
$env:OPENAI_API_KEY="your-openai-api-key"
$env:GEC_REPO_PATH="C:\FYP\apps\projj"
$env:GEC_INDEX_PATH="rag\index_store\gec_rag_index"

# Run service
uvicorn rag_service:app --host 127.0.0.1 --port 8000
```

### Check:

```bash
curl http://127.0.0.1:8000/
```

---

## 🔹 2. Start Action Backend

```bash
cd C:\FYP\apps\Gec_Server_C

.\.venv\Scripts\Activate.ps1

uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

### Check:

```bash
curl http://127.0.0.1:8001/
```

---

## 🔹 3. Start MCP Proxy

```bash
cd C:\FYP\apps\Gec_Server_C

.\.venv\Scripts\Activate.ps1

$env:UNDERLYING_REST_BASE="http://127.0.0.1:8001"

uvicorn mcp_server:app --host 127.0.0.1 --port 8002
```

### Check:

```bash
curl http://127.0.0.1:8002/mcp/tools
```

---

## 🔹 4. Start Node Backend

```bash
cd C:\FYP\apps\projj\backend

# Fix DNS issue (Windows) //run these 2 commands only if you get an dns error
//$env:NODE_OPTIONS="--dns-result-order=ipv4first"
//npm install

npm run dev
```

### Check:

```bash
curl http://127.0.0.1:3000/
```

---

## 🔹 5. Start Frontend

```bash
//cd C:\FYP\apps\projj

./apps/projj/frontend/pages/index.html
```

### Open in browser:

```text
http://127.0.0.1:5500/frontend/landing.html
http://127.0.0.1:5500/frontend/pages/index.html
```

---

## Run Order

Start services in this order:

1. RAG Service → `8000`
2. Action Backend → `8001`
3. MCP Proxy → `8002`
4. Node Backend → `3000`
5. Frontend → `5500`

---
