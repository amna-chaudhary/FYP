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
├── README.md
├── PROJECT_OVERVIEW.md
├── Gec_Server_C/
│   ├── backend/
│   │   ├── app.py
│   │   ├── agent.py
│   │   ├── chain_api.py
│   │   ├── aptos_client.py
│   │   └── config.py
│   ├── frontend/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   ├── mcp_server.py
│   └── openapi.json
└── projj/
    ├── index.html
    ├── app-config.js
    ├── app-init.js
    ├── app-chat.js
    ├── app-marketplace.js
    ├── app-registry.js
    ├── rag_service.py
    ├── rag_index.py
    ├── rag_main.py
    └── backend/
        ├── server.js
        ├── routes/auth.js
        ├── models/
        └── config/db.js
```

## Main Services

| Service | Folder | Default URL | Purpose |
| --- | --- | --- | --- |
| Frontend | `projj/` | Browser/static file | Main EnergyCert Bot UI |
| Node router backend | `projj/backend/` | `http://127.0.0.1:3000` | Routes chat to RAG or action backend, handles auth |
| RAG service | `projj/` | `http://127.0.0.1:8000` | Answers GEC/project questions |
| Action backend | `Gec_Server_C/` | `http://127.0.0.1:8001` | Executes certificate/marketplace/audit actions |
| MCP proxy | `Gec_Server_C/` | `http://127.0.0.1:8002` | Optional OpenAPI-to-tool proxy |

## Prerequisites

Install these first:

- Python 3.11+
- Node.js 18+
- npm
- MongoDB database, local or cloud
- OpenAI API key for RAG and LLM responses
- Aptos testnet account/private key if you want real blockchain transactions

## Environment Variables

### RAG Service Environment

The RAG service is inside `projj/`.

Create `projj/.env` or export these variables in your terminal:

```bash
OPENAI_API_KEY="your-openai-api-key"
GEC_REPO_PATH="/Users/umarfarooq/Github/FYP/projj"
GEC_INDEX_PATH="gec_rag_index"
GEC_EMBED_MODEL="text-embedding-3-small"
GEC_CHAT_MODEL="gpt-4o-mini"
```

Important: `GEC_REPO_PATH` should point to the folder you want the RAG index to read. On this machine, use:

```bash
GEC_REPO_PATH="/Users/umarfarooq/Github/FYP/projj"
```

### Node Backend Environment

The Node backend is inside `projj/backend/`.

Create `projj/backend/.env`:

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

The action backend is inside `Gec_Server_C/backend/`.

Create `Gec_Server_C/backend/.env`:

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

## How to Run the Project

Run each service in a separate terminal.

### Terminal 1: Start the RAG Service

```bash
cd /Users/umarfarooq/Github/FYP/projj
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="your-openai-api-key"
export GEC_REPO_PATH="/Users/umarfarooq/Github/FYP/projj"
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
cd /Users/umarfarooq/Github/FYP/Gec_Server_C
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
cd /Users/umarfarooq/Github/FYP/Gec_Server_C
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
cd /Users/umarfarooq/Github/FYP/projj/backend
npm install
npm run dev
```

Check it:

```bash
curl http://127.0.0.1:3000/
```

Expected result: JSON response from `projj-node-backend`.

### Terminal 5: Open the Frontend

The main frontend is:

```text
/Users/umarfarooq/Github/FYP/projj/index.html
```

You can open it directly in the browser, or serve it with a local static server.

Option A: open directly:

```bash
open /Users/umarfarooq/Github/FYP/projj/index.html
```

Option B: serve with Python:

```bash
cd /Users/umarfarooq/Github/FYP/projj
python -m http.server 5500
```

Then open:

```text
http://127.0.0.1:5500/index.html
```

The frontend sends chat requests to:

```text
http://127.0.0.1:3000/api/chat
```

## Quick Test Messages

After all services are running, try these in the frontend chat.

### RAG Question Test

```text
What is a Green Energy Certificate?
```

Expected behavior:

- Frontend sends request to Node backend.
- Node routes it to RAG service.
- RAG service returns an explanation.

### Action Test

```text
issue 50 solar certificate location Lahore
```

Expected behavior:

- Frontend sends request to Node backend.
- Node routes it to action backend.
- Action backend parses it as `cert_create`.
- MCP/action backend attempts an Aptos transaction.

This requires correct Aptos environment variables and a funded testnet sender account.

### Marketplace Test

```text
list cert 1 price 100
```

Expected behavior:

- Node routes to action backend.
- Action backend parses it as marketplace listing action.
- Backend attempts `market_list`.

## API Endpoints

### Node Backend

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/api/chat` | Main chat route |
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login user |
| `POST` | `/api/auth/verify-otp` | Verify OTP |
| `POST` | `/api/auth/resend-otp` | Resend OTP |
| `GET` | `/api/auth/me` | Get logged-in user |
| `GET` | `/api/market/stats` | Marketplace stats |
| `POST` | `/api/market/list` | Create listing |
| `POST` | `/api/market/request-buy` | Request buy |
| `POST` | `/api/market/accept-buy` | Accept buy |
| `POST` | `/api/market/cancel` | Cancel listing |

### RAG Service

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/chat` | Ask project/GEC question |
| `POST` | `/build-index` | Rebuild FAISS index |

### Action Backend

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/chat` | Natural-language action handler |
| `POST` | `/certificates/init` | Initialize certificate registry |
| `POST` | `/certificates/add-issuer` | Add issuer |
| `POST` | `/certificates/remove-issuer` | Remove issuer |
| `POST` | `/certificates/create` | Create certificate |
| `POST` | `/certificates/transfer` | Transfer certificate |
| `POST` | `/certificates/claim` | Claim/retire certificate |
| `POST` | `/certificates/cancel` | Cancel certificate |
| `POST` | `/marketplace/init` | Initialize marketplace |
| `POST` | `/marketplace/list` | List certificate |
| `POST` | `/marketplace/cancel` | Cancel listing |
| `POST` | `/marketplace/request-buy` | Request buy |
| `POST` | `/marketplace/accept-buy` | Accept buy request |
| `GET` | `/marketplace/{market_addr}/stats` | Get marketplace stats |
| `POST` | `/audit/init` | Initialize audit module |
| `POST` | `/audit/log` | Add audit log |

### MCP Proxy

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/mcp/tools` | List OpenAPI tools |
| `POST` | `/mcp/invoke` | Invoke a tool by `tool_name` |

## Common Problems

### RAG says index is not loaded

Run:

```bash
cd /Users/umarfarooq/Github/FYP/projj
source .venv/bin/activate
export OPENAI_API_KEY="your-openai-api-key"
export GEC_REPO_PATH="/Users/umarfarooq/Github/FYP/projj"
python build_rag_index.py
```

Then restart:

```bash
uvicorn rag_service:app --host 127.0.0.1 --port 8000
```

### Node backend cannot connect to MongoDB

Check `projj/backend/.env`:

```bash
MONGO_URI="your-mongodb-uri"
```

Also make sure MongoDB is running or your cloud MongoDB connection string allows your IP.

### OTP email does not send

Check:

```bash
GMAIL_USER="your-gmail-address"
GMAIL_APP_PASSWORD="your-gmail-app-password"
```

Use a Gmail App Password, not your normal Gmail password.

### Action backend cannot reach MCP server

Make sure MCP proxy is running on `8002`:

```bash
curl http://127.0.0.1:8002/mcp/tools
```

Also make sure action backend env contains:

```bash
MCP_SERVER_URL="http://127.0.0.1:8002/mcp/invoke"
```

### MCP proxy cannot find `openapi.json`

Start it from `Gec_Server_C`:

```bash
cd /Users/umarfarooq/Github/FYP/Gec_Server_C
uvicorn mcp_server:app --host 127.0.0.1 --port 8002
```

### Blockchain transaction fails

Check:

- `APTOS_SENDER_PRIVATE_KEY_HEX` is correct.
- `APTOS_SENDER_ADDRESS` matches the private key.
- Sender account has Aptos testnet funds.
- `MODULE_ADDRESS` points to deployed Move modules.
- `CERT_REGISTRY_ADDR` and `MARKET_ADDR` are correct.
- The registry/marketplace has been initialized before calling dependent actions.

## Recommended Run Order

Use this order for fewer errors:

1. Start RAG service on `8000`.
2. Start action backend on `8001`.
3. Start MCP proxy on `8002`.
4. Start Node router on `3000`.
5. Open `projj/index.html`.

## More Detailed Documentation

For a full file-by-file explanation of the project, read:

```text
PROJECT_OVERVIEW.md
```

For AI-agent capabilities, ownership, maturity levels, and upgrade priorities, read:

```text
AGENT_SKILLS.md
```
